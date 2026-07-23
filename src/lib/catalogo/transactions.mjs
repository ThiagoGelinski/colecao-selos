import { link, mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { ASSET_DIR, ID_MANIFEST, TEMPLATE } from './paths.mjs';
import { exists, readJson, writeJsonAtomic } from './io.mjs';
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
async function removeVerifiedEmptyDirectory(target, identity, tokenHint) { const currentIdentity = fileIdentity(await stat(target).catch(() => null)); if (!sameFileIdentity(currentIdentity, identity)) return false; const quarantine = `${target}.removal-${process.pid}-${tokenHint}-${randomUUID()}`; try { await rename(target, quarantine); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } const movedIdentity = fileIdentity(await stat(quarantine).catch(() => null)); if (!sameFileIdentity(movedIdentity, identity)) { await rename(quarantine, target).catch(() => {}); return false; } try { await rmdir(quarantine); return true; } catch (error) { await rename(quarantine, target).catch(() => {}); if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return false; throw error; } }

export async function createStampTransaction({ slug, title }) {
  const initialRecords = await loadRecords(); assertGlobalRecordIntegrity(initialRecords); assertSlugAvailable(initialRecords, slug); assertManifestValid(await readJson(ID_MANIFEST), initialRecords);
  return withIdLock('selo:novo', async () => {
    const records = await loadRecords(); assertGlobalRecordIntegrity(records); assertSlugAvailable(records, slug); const manifest = await readJson(ID_MANIFEST); assertManifestValid(manifest, records);
    const sequence = manifest.next_sequence; const id = `SEL-${String(sequence).padStart(6, '0')}`; const filePath = dataPath(id); const assetDirectory = path.join(ASSET_DIR, id);
    if (manifest.reserved.some((item) => item.id === id || item.sequence === sequence)) throw new TransactionError(`ID ou sequence já consumido: ${id}.`);
    if (await exists(filePath)) throw new TransactionError(`Criação bloqueada: JSON já existe para ${id}.`);
    if (await exists(assetDirectory)) throw new TransactionError(`Criação bloqueada: pasta de assets já existe para ${id}.`);
    const reservation = { id, sequence, reserved_at: now(), source: 'selo:novo', status: 'reservado', slug, created_at: null, completed_at: null, failed_at: null, failure_reason: null, cancelado_em: null, cancellation_reason: null };
    manifest.reserved.push(reservation); manifest.next_sequence = sequence + 1; await writeJsonAtomic(ID_MANIFEST, manifest);
    let createdJsonSnapshot = null; let createdAssetIdentity = null;
    try {
      reservation.status = 'criando'; await writeJsonAtomic(ID_MANIFEST, manifest);
      const raw = await readFile(TEMPLATE, 'utf8'); const record = JSON.parse(raw.replaceAll('{{ID}}', id).replaceAll('{{SLUG}}', slug).replaceAll('{{TITULO}}', title).replaceAll('{{DATE}}', today()));
      const validation = validateRecord(record, filePath); if (validation.errors.length) throw new TransactionError(`TEMPLATE INVÁLIDO:\n${validation.errors.join('\n')}`, { details: validation });
      createdJsonSnapshot = await writeJsonExclusiveAtomic(filePath, record); reservation.created_at = now(); injectTransactionFailure('json');
      await mkdir(assetDirectory); createdAssetIdentity = fileIdentity(await stat(assetDirectory)); injectTransactionFailure('assets');
      reservation.status = 'criado'; reservation.completed_at = now(); await writeJsonAtomic(ID_MANIFEST, manifest); return { id, slug };
    } catch (error) {
      const cleanupErrors = [];
      if (createdAssetIdentity) { try { const removed = await removeVerifiedEmptyDirectory(assetDirectory, createdAssetIdentity, id); if (!removed && await exists(assetDirectory)) cleanupErrors.push('pasta de assets não removida por divergência de identidade ou conteúdo'); } catch (cleanupError) { cleanupErrors.push(`pasta: ${cleanupError.message}`); } }
      if (createdJsonSnapshot) { try { const removed = await removeVerifiedFile(filePath, createdJsonSnapshot, () => true, id); if (!removed && await exists(filePath)) cleanupErrors.push('JSON não removido por divergência de identidade'); } catch (cleanupError) { cleanupErrors.push(`JSON: ${cleanupError.message}`); } }
      reservation.status = 'falha_na_criacao'; reservation.completed_at = null; reservation.failed_at = now(); reservation.failure_reason = cleanupErrors.length ? `${error.message} Compensação: ${cleanupErrors.join('; ')}.` : error.message; await writeJsonAtomic(ID_MANIFEST, manifest); throw error;
    }
  });
}