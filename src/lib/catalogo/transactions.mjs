import { link, mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { ASSET_DIR, ID_MANIFEST, TEMPLATE } from './paths.mjs';
import { exists, readJson, writeJsonAtomic, readMutableManifest, updateMutableManifestAtomic, writeJsonExclusive } from './io.mjs';
import { fileIdentity, readSnapshotAt, removeVerifiedFile, sameFileIdentity, withIdLock } from './lock.mjs';
import { assertManifestValid } from './manifest.mjs';
import { assertGlobalRecordIntegrity, dataPath, loadRecords, normalizeSlug } from './records.mjs';
import { TransactionError } from './errors.mjs';
import { validateRecord } from './audit.mjs';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
export function transactionIdFor(command) { return /^(selo:(novo|revisao|aprovar|rejeitar|revogar|publicar)|catalogo:manutencao)$/.test(command) ? randomUUID() : null; }
export function injectTransactionFailure(stage) { if (process.env.SELO_TEST_FAIL_STAGE === stage) throw new TransactionError(`Falha de teste após ${stage}.`); }
export function assertSlugAvailable(records, slug) { if (records.some(({ record }) => normalizeSlug(record.slug) === slug)) throw new TransactionError(`Slug duplicado: ${slug}.`); }
async function writeJsonExclusiveAtomic(target, value) { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await link(temporary, target); return await readSnapshotAt(target); } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); } }
async function removeVerifiedEmptyDirectory(target, identity, tokenHint) { const currentIdentity = fileIdentity(await stat(target).catch(() => null)); if (!sameFileIdentity(currentIdentity, identity)) return false; const quarantine = `${target}.removal-${process.pid}-${tokenHint}-${randomUUID()}`; try { await rename(target, quarantine); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } const movedIdentity = fileIdentity(await stat(quarantine).catch(() => null)); if (!sameFileIdentity(movedIdentity, identity)) { await rename(quarantine, target).catch(() => { }); return false; } try { await rmdir(quarantine); return true; } catch (error) { await rename(quarantine, target).catch(() => { }); if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return false; throw error; } }

export async function createStampTransaction({ slug, title }) {
  const isServerless = process.env.NETLIFY === 'true' || globalThis.__MOCK_NETLIFY_ENV;

  const initialRecords = await loadRecords(); assertGlobalRecordIntegrity(initialRecords); assertSlugAvailable(initialRecords, slug);
  if (!isServerless) assertManifestValid(await readJson(ID_MANIFEST), initialRecords);

  const executeDomainTransaction = async (id, serverlessMode, localManifestDraft) => {
    const filePath = dataPath(id); const assetDirectory = path.join(ASSET_DIR, id);
    let createdJsonSnapshot = null; let createdAssetIdentity = null;

    const setStatus = async (status, errMessage = null) => {
      if (serverlessMode) {
        await updateMutableManifestAtomic(ID_MANIFEST, (draft) => {
          const res = draft.reserved.find((r) => r.id === id);
          if (res) {
            res.status = status;
            if (status === 'falha_na_criacao') { res.completed_at = null; res.failed_at = now(); res.failure_reason = errMessage; }
            if (status === 'criado') { res.completed_at = now(); }
          }
          return draft;
        });
      } else {
        const res = localManifestDraft.reserved.find((r) => r.id === id);
        if (res) {
          res.status = status;
          if (status === 'falha_na_criacao') { res.completed_at = null; res.failed_at = now(); res.failure_reason = errMessage; }
          if (status === 'criado') { res.completed_at = now(); }
        }
        await writeJsonAtomic(ID_MANIFEST, localManifestDraft);
      }
    };

    try {
      if (serverlessMode) {
        // Enforce physical constraints late in serverless to honor the atomic sequence lock achieved early
        if (await exists(filePath)) throw new TransactionError(`Criação bloqueada: JSON já existe para ${id}.`);
        if (await exists(assetDirectory)) throw new TransactionError(`Criação bloqueada: pasta de assets já existe para ${id}.`);
      }
      await setStatus('criando');

      const raw = await readFile(TEMPLATE, 'utf8'); const record = JSON.parse(raw.replaceAll('{{ID}}', id).replaceAll('{{SLUG}}', slug).replaceAll('{{TITULO}}', title).replaceAll('{{DATE}}', today()));
      const validation = validateRecord(record, filePath); if (validation.errors.length) throw new TransactionError(`TEMPLATE INVÁLIDO:\n${validation.errors.join('\n')}`, { details: validation });

      if (serverlessMode) {
        await writeJsonExclusive(filePath, record);
        await updateMutableManifestAtomic(ID_MANIFEST, (draft) => {
          const res = draft.reserved.find((r) => r.id === id);
          if (res) res.created_at = now();
          return draft;
        });
        injectTransactionFailure('json');

        // NO-OP virtual directory preparation for Serverless assets boundary
        await setStatus('criado');
        return { id, slug };

      } else {
        createdJsonSnapshot = await writeJsonExclusiveAtomic(filePath, record);
        const res = localManifestDraft.reserved.find((r) => r.id === id);
        if (res) res.created_at = now();
        injectTransactionFailure('json');
        await mkdir(assetDirectory); createdAssetIdentity = fileIdentity(await stat(assetDirectory)); injectTransactionFailure('assets');
        await setStatus('criado');
        return { id, slug };
      }
    } catch (error) {
      const cleanupErrors = [];
      if (!serverlessMode) {
        if (createdAssetIdentity) { try { const removed = await removeVerifiedEmptyDirectory(assetDirectory, createdAssetIdentity, id); if (!removed && await exists(assetDirectory)) cleanupErrors.push('pasta de assets não removida por divergência de identidade ou conteúdo'); } catch (cleanupError) { cleanupErrors.push(`pasta: ${cleanupError.message}`); } }
        if (createdJsonSnapshot) { try { const removed = await removeVerifiedFile(filePath, createdJsonSnapshot, () => true, id); if (!removed && await exists(filePath)) cleanupErrors.push('JSON não removido por divergência de identidade'); } catch (cleanupError) { cleanupErrors.push(`JSON: ${cleanupError.message}`); } }
      }
      let errMessage = cleanupErrors.length ? `${error.message} Compensação: ${cleanupErrors.join('; ')}.` : error.message;

      await setStatus('falha_na_criacao', errMessage);
      throw error;
    }
  };

  if (isServerless) {
    await readMutableManifest(ID_MANIFEST);
    let id, sequence;
    await updateMutableManifestAtomic(ID_MANIFEST, (draft) => {
      sequence = draft.next_sequence; id = `SEL-${String(sequence).padStart(6, '0')}`;
      if (draft.reserved.some((item) => item.id === id || item.sequence === sequence)) throw new TransactionError(`ID ou sequence já consumido: ${id}.`);
      draft.reserved.push({ id, sequence, reserved_at: now(), source: 'selo:novo', status: 'reservado', slug, created_at: null, completed_at: null, failed_at: null, failure_reason: null, cancelado_em: null, cancellation_reason: null });
      draft.next_sequence = sequence + 1;
      return draft;
    });
    return await executeDomainTransaction(id, true, null);
  } else {
    return withIdLock('selo:novo', async () => {
      const records = await loadRecords(); assertGlobalRecordIntegrity(records); assertSlugAvailable(records, slug);
      const manifest = await readJson(ID_MANIFEST); assertManifestValid(manifest, records);
      const sequence = manifest.next_sequence; const id = `SEL-${String(sequence).padStart(6, '0')}`; const filePath = dataPath(id); const assetDirectory = path.join(ASSET_DIR, id);
      if (manifest.reserved.some((item) => item.id === id || item.sequence === sequence)) throw new TransactionError(`ID ou sequence já consumido: ${id}.`);
      if (await exists(filePath)) throw new TransactionError(`Criação bloqueada: JSON já existe para ${id}.`);
      if (await exists(assetDirectory)) throw new TransactionError(`Criação bloqueada: pasta de assets já existe para ${id}.`);

      manifest.reserved.push({ id, sequence, reserved_at: now(), source: 'selo:novo', status: 'reservado', slug, created_at: null, completed_at: null, failed_at: null, failure_reason: null, cancelado_em: null, cancellation_reason: null });
      manifest.next_sequence = sequence + 1;
      await writeJsonAtomic(ID_MANIFEST, manifest);

      return await executeDomainTransaction(id, false, manifest);
    });
  }
}