import { link, mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { formatValidationIssue, recordHash, validateSeloEditorial, validateSeloSchema, validateSeloSemantics } from '../selo-validation.mjs';
import path from 'node:path';
import process from 'node:process';
import { appendEditorialEvent, inspectEditorialHistory } from './history.mjs';
import { REQUIRED_ASSETS, assetErrors, validateAssets } from './assets.mjs';
import { fileIdentity, sameFileIdentity, isProcessActive, readLockSnapshot, readSnapshotAt, removeStaleLock, removeVerifiedFile, withIdLock } from './lock.mjs';
import { statusCounts, uniqueFindings } from './audit.mjs';
import { exists, readJson, writeJsonAtomic } from './io.mjs';
import { reservationSummary } from './manifest.mjs';
import { dataPath, normalizeSlug, sequenceFromId } from './records.mjs';
import { transactionIdFor } from './transactions.mjs';
import { ASSET_DIR, DATA_DIR, ID_LOCK, ID_MANIFEST, ID_PATTERN, LOCK_STALE_MS, LOG_DIR, REPORT_DIR, RESERVATION_STATUSES, ROOT, TEMPLATE } from './paths.mjs';

let command;
let transactionId = null;

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) { parsed._.push(token); continue; }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

let args = { _: [] };
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
async function appendLog(event, details = {}) {
  await mkdir(LOG_DIR, { recursive: true });
  const line = JSON.stringify({ timestamp: now(), command, event, pid: process.pid, transaction_id: transactionId, ...details });
  await writeFile(path.join(LOG_DIR, 'pipeline.jsonl'), `${line}\n`, { encoding: 'utf8', flag: 'a' });
}
async function inspectRecordFiles() {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => {
    const filePath = path.join(DATA_DIR, name);
    try { return { name, path: filePath, record: await readJson(filePath), parse_error: null }; }
    catch (error) { return { name, path: filePath, record: null, parse_error: error.message }; }
  }));
}

async function loadRecords() {
  const files = await inspectRecordFiles();
  const invalid = files.filter((item) => item.parse_error || !/^SEL-[0-9]{6}\.json$/.test(item.name));
  if (invalid.length) throw new Error(`Integridade dos arquivos inválida: ${invalid.map((item) => `${item.name}${item.parse_error ? ` (${item.parse_error})` : ''}`).join(', ')}`);
  return files.map(({ path: filePath, record }) => ({ path: filePath, record }));
}

function assertGlobalRecordIntegrity(records) {
  const ids = new Map();
  const slugs = new Map();
  const errors = [];
  for (const { path: filePath, record } of records) {
    const label = path.relative(ROOT, filePath);
    if (ids.has(record.id)) errors.push(`ID duplicado ${record.id}: ${ids.get(record.id)} e ${label}.`); else ids.set(record.id, label);
    const normalized = normalizeSlug(record.slug);
    if (!normalized) errors.push(`${label}: slug inválido.`);
    else if (slugs.has(normalized)) errors.push(`Slug duplicado ${normalized}: ${slugs.get(normalized)} e ${label}.`); else slugs.set(normalized, label);
  }
  if (errors.length) throw new Error(`Integridade global inválida:\n${errors.join('\n')}`);
}

async function resolveRecord(reference) {
  if (!reference) throw new Error('Informe um ID ou slug.');
  const records = await loadRecords();
  const byId = typeof reference === 'string' && reference.startsWith('SEL-');
  const searched = byId ? reference : normalizeSlug(reference);
  if (!searched) throw new Error(`Referência inválida: ${reference}`);
  const matches = records.filter(({ record }) => byId ? record.id === searched : normalizeSlug(record.slug) === searched);
  if (matches.length === 0) throw new Error(`${byId ? 'ID' : 'Slug'} não encontrado: ${searched}`);
  if (matches.length > 1) throw new Error(`ERRO DE INTEGRIDADE: ${byId ? 'ID' : 'slug'} ambíguo (${searched}) em ${matches.length} registros.`);
  return matches[0];
}

function validDate(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function inspectManifest(manifest, records = []) {
  const errors = [];
  const warnings = [];
  const informational = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { errors: ['Manifesto deve ser um objeto.'], warnings, informational };
  if (manifest.schema_version !== '2.0.0') errors.push('Manifesto: schema_version deve ser 2.0.0.');
  if (manifest.prefix !== 'SEL') errors.push('Manifesto: prefix deve ser "SEL".');
  if (manifest.digits !== 6) errors.push('Manifesto: digits deve ser 6.');
  if (!Number.isInteger(manifest.next_sequence) || manifest.next_sequence < 1) errors.push('Manifesto: next_sequence deve ser inteiro positivo.');
  if (!Array.isArray(manifest.reserved)) return { errors: [...errors, 'Manifesto: reserved deve ser array.'], warnings, informational };

  const ids = new Set();
  const sequences = new Set();
  let maximum = 0;
  for (const [index, reservation] of manifest.reserved.entries()) {
    const label = `Manifesto reserved[${index}]`;
    if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) { errors.push(`${label}: reserva deve ser objeto.`); continue; }
    for (const field of ['id', 'sequence', 'reserved_at', 'source', 'status', 'slug']) if (reservation[field] === undefined || reservation[field] === null || reservation[field] === '') errors.push(`${label}: ${field} obrigatório.`);
    if (!ID_PATTERN.test(reservation.id ?? '')) errors.push(`${label}: ID inválido (${reservation.id ?? 'ausente'}).`);
    if (ids.has(reservation.id)) errors.push(`${label}: ID duplicado (${reservation.id}).`); else ids.add(reservation.id);
    if (!Number.isInteger(reservation.sequence) || reservation.sequence < 1) errors.push(`${label}: sequence inválida.`);
    else {
      maximum = Math.max(maximum, reservation.sequence);
      if (sequences.has(reservation.sequence)) errors.push(`${label}: sequence duplicada (${reservation.sequence}).`); else sequences.add(reservation.sequence);
      const expected = sequenceFromId(reservation.id);
      if (expected !== null && expected !== reservation.sequence) errors.push(`${label}: id e sequence inconsistentes.`);
    }
    if (!validDate(reservation.reserved_at)) errors.push(`${label}: reserved_at inválido.`);
    if (typeof reservation.source !== 'string' || !reservation.source.trim()) errors.push(`${label}: source inválido.`);
    if (typeof reservation.slug !== 'string' || !normalizeSlug(reservation.slug)) errors.push(`${label}: slug inválido.`);
    if (!RESERVATION_STATUSES.has(reservation.status)) errors.push(`${label}: status inválido (${reservation.status ?? 'ausente'}).`);
    for (const field of ['created_at', 'completed_at', 'failed_at', 'cancelado_em']) if (reservation[field] != null && !validDate(reservation[field])) errors.push(`${label}: ${field} inválido.`);

    if (reservation.status === 'criado') {
      if (!validDate(reservation.created_at)) errors.push(`${label}: criado exige created_at.`);
      if (!validDate(reservation.completed_at)) errors.push(`${label}: criado exige completed_at.`);
      if (reservation.failed_at != null || reservation.failure_reason != null) errors.push(`${label}: criado não pode ter failed_at ou failure_reason.`);
      if (reservation.cancelado_em != null || reservation.cancellation_reason != null) errors.push(`${label}: criado não pode ter dados de cancelamento.`);
    } else if (reservation.status === 'falha_na_criacao') {
      if (!validDate(reservation.failed_at)) errors.push(`${label}: falha_na_criacao exige failed_at.`);
      if (typeof reservation.failure_reason !== 'string' || !reservation.failure_reason.trim()) errors.push(`${label}: falha_na_criacao exige failure_reason.`);
      if (reservation.completed_at != null) errors.push(`${label}: falha_na_criacao não pode ter completed_at.`);
      if (reservation.cancelado_em != null || reservation.cancellation_reason != null) errors.push(`${label}: falha_na_criacao não pode ter dados de cancelamento.`);
    } else if (reservation.status === 'cancelado_sem_reuso') {
      if (!validDate(reservation.cancelado_em)) errors.push(`${label}: cancelado_sem_reuso exige cancelado_em.`);
      if (typeof reservation.cancellation_reason !== 'string' || !reservation.cancellation_reason.trim()) errors.push(`${label}: cancelado_sem_reuso exige cancellation_reason.`);
      if (reservation.completed_at != null || reservation.failed_at != null || reservation.failure_reason != null) errors.push(`${label}: cancelado_sem_reuso possui campos incompatíveis.`);
      informational.push(`${label}: ID cancelado preservado sem reuso (${reservation.id}).`);
    } else if (['reservado', 'criando'].includes(reservation.status)) {
      if (reservation.completed_at != null || reservation.failed_at != null || reservation.failure_reason != null || reservation.cancelado_em != null || reservation.cancellation_reason != null) errors.push(`${label}: ${reservation.status} possui campos incompatíveis.`);
    }
    if (reservation.status === 'criando' && validDate(reservation.reserved_at) && Date.now() - Date.parse(reservation.reserved_at) > LOCK_STALE_MS) warnings.push(`${label}: reserva em criação antiga (${reservation.id}).`);
  }
  if (Number.isInteger(manifest.next_sequence) && manifest.next_sequence <= maximum) errors.push(`Manifesto: next_sequence (${manifest.next_sequence}) deve ser maior que a maior sequence (${maximum}).`);
  if (Number.isInteger(manifest.next_sequence)) {
    const gaps = [];
    for (let sequence = 1; sequence < manifest.next_sequence; sequence += 1) if (!sequences.has(sequence)) gaps.push(sequence);
    if (gaps.length) informational.push(`Manifesto: lacunas permitidas e não reutilizáveis: ${gaps.join(', ')}.`);
  }
  for (const { record, path: filePath } of records) if (record?.id && !ids.has(record.id)) errors.push(`${path.relative(ROOT, filePath)}: arquivo sem reserva no manifesto (${record.id}).`);
  return { errors, warnings, informational };
}
function assertManifestValid(manifest, records) {
  const inspection = inspectManifest(manifest, records);
  if (inspection.errors.length) throw new Error(`Manifesto inválido:\n${inspection.errors.join('\n')}`);
  return inspection;
}
function formatLayerErrors(label, layer) {
  return layer.errors.map((error) => `${label}: ${formatValidationIssue(error)}`);
}

function validateRecord(record, filePath) {
  const label = path.relative(ROOT, filePath);
  const structural = validateSeloSchema(record);
  const semantic = validateSeloSemantics(record);
  const editorial = structural.valid ? validateSeloEditorial(record) : { valid: false, errors: [] };
  const fileErrors = [];
  const fileId = path.basename(filePath, '.json');
  if (fileId !== record?.id) fileErrors.push(`${label}: nome do arquivo (${fileId}) difere do ID interno (${record?.id ?? 'ausente'}).`);
  const structuralErrors = formatLayerErrors(label, structural);
  const semanticErrors = formatLayerErrors(label, semantic);
  const editorialErrors = formatLayerErrors(label, editorial);
  const errors = [...structuralErrors, ...semanticErrors, ...editorialErrors, ...fileErrors];
  const warnings = !record?.aprovacao_humana && record?.publicacao?.status !== 'rascunho' ? [`${label}: registro legado sem bloco aprovacao_humana.`] : [];
  return { errors, warnings, structural_errors: structural.errors, semantic_errors: semantic.errors, editorial_errors: editorial.errors, file_errors: fileErrors };
}
async function auditOne(reference) {
  const { path: filePath, record } = await resolveRecord(reference);
  const validation = validateRecord(record, filePath);
  const assets = await validateAssets(record);
  const errors = [...validation.errors, ...assetErrors(assets)];
  const report = {
    generated_at: now(), id: record.id, slug: record.slug,
    valid: errors.length === 0,
    publication_blocked: errors.some((error) => error.includes('publicação') || error.includes('aprova') || error.includes('hash')),
    errors,
    warnings: validation.warnings,
    validation: { structural_errors: validation.structural_errors, semantic_errors: validation.semantic_errors, editorial_errors: validation.editorial_errors, file_errors: validation.file_errors },
    assets
  };
  await writeJsonAtomic(path.join(REPORT_DIR, `${record.id}-auditoria.json`), report);
  return report;
}

async function writeJsonExclusiveAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await link(temporary, target);
    return await readSnapshotAt(target);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function removeVerifiedEmptyDirectory(target, identity, tokenHint) {
  const currentIdentity = fileIdentity(await stat(target).catch(() => null));
  if (!sameFileIdentity(currentIdentity, identity)) return false;
  const quarantine = `${target}.removal-${process.pid}-${tokenHint}-${randomUUID()}`;
  try { await rename(target, quarantine); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const movedIdentity = fileIdentity(await stat(quarantine).catch(() => null));
  if (!sameFileIdentity(movedIdentity, identity)) {
    await rename(quarantine, target).catch(() => {});
    return false;
  }
  try { await rmdir(quarantine); return true; }
  catch (error) {
    await rename(quarantine, target).catch(() => {});
    if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return false;
    throw error;
  }
}

function injectTransactionFailure(stage) {
  if (process.env.SELO_TEST_FAIL_STAGE === stage) throw new Error(`Falha de teste após ${stage}.`);
}

function assertSlugAvailable(records, slug) {
  const matches = records.filter(({ record }) => normalizeSlug(record.slug) === slug);
  if (matches.length) throw new Error(`Slug duplicado: ${slug}.`);
}

async function seloNovo() {
  const slug = normalizeSlug(args.slug);
  const title = typeof args.titulo === 'string' ? args.titulo.trim() : '';
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !title) throw new Error('Uso: npm run selo:novo -- --slug <slug válido> --titulo <título>');

  const initialRecords = await loadRecords();
  assertGlobalRecordIntegrity(initialRecords);
  assertSlugAvailable(initialRecords, slug);
  assertManifestValid(await readJson(ID_MANIFEST), initialRecords);

  let outcome;
  let transactionError;
  try {
    outcome = await withIdLock('selo:novo', async () => {
      const records = await loadRecords();
      assertGlobalRecordIntegrity(records);
      assertSlugAvailable(records, slug);
      const manifest = await readJson(ID_MANIFEST);
      assertManifestValid(manifest, records);

      const sequence = manifest.next_sequence;
      const id = `SEL-${String(sequence).padStart(6, '0')}`;
      const filePath = dataPath(id);
      const assetDirectory = path.join(ASSET_DIR, id);
      if (manifest.reserved.some((item) => item.id === id || item.sequence === sequence)) throw new Error(`ID ou sequence já consumido: ${id}.`);
      if (await exists(filePath)) throw new Error(`Criação bloqueada: JSON já existe para ${id}.`);
      if (await exists(assetDirectory)) throw new Error(`Criação bloqueada: pasta de assets já existe para ${id}.`);

      const reservation = {
        id, sequence, reserved_at: now(), source: 'selo:novo', status: 'reservado', slug,
        created_at: null, completed_at: null, failed_at: null, failure_reason: null,
        cancelado_em: null, cancellation_reason: null
      };
      manifest.reserved.push(reservation);
      manifest.next_sequence = sequence + 1;
      await writeJsonAtomic(ID_MANIFEST, manifest);

      let createdJsonSnapshot = null;
      let createdAssetIdentity = null;
      try {
        reservation.status = 'criando';
        await writeJsonAtomic(ID_MANIFEST, manifest);
        const raw = await readFile(TEMPLATE, 'utf8');
        const record = JSON.parse(raw.replaceAll('{{ID}}', id).replaceAll('{{SLUG}}', slug).replaceAll('{{TITULO}}', title).replaceAll('{{DATE}}', today()));
        const candidateValidation = validateRecord(record, filePath);
        if (candidateValidation.errors.length) throw new Error('TEMPLATE INVÁLIDO:\n' + candidateValidation.errors.join('\n'));
        createdJsonSnapshot = await writeJsonExclusiveAtomic(filePath, record);
        reservation.created_at = now();
        injectTransactionFailure('json');
        await mkdir(assetDirectory);
        createdAssetIdentity = fileIdentity(await stat(assetDirectory));
        injectTransactionFailure('assets');
        reservation.status = 'criado';
        reservation.completed_at = now();
        await writeJsonAtomic(ID_MANIFEST, manifest);
        return { id, slug };
      } catch (error) {
        const cleanupErrors = [];
        if (createdAssetIdentity) {
          try {
            const removed = await removeVerifiedEmptyDirectory(assetDirectory, createdAssetIdentity, id);
            if (!removed && await exists(assetDirectory)) cleanupErrors.push('pasta de assets não removida por divergência de identidade ou conteúdo');
          } catch (cleanupError) { cleanupErrors.push(`pasta: ${cleanupError.message}`); }
        }
        if (createdJsonSnapshot) {
          try {
            const removed = await removeVerifiedFile(filePath, createdJsonSnapshot, () => true, id);
            if (!removed && await exists(filePath)) cleanupErrors.push('JSON não removido por divergência de identidade');
          } catch (cleanupError) { cleanupErrors.push(`JSON: ${cleanupError.message}`); }
        }
        reservation.status = 'falha_na_criacao';
        reservation.completed_at = null;
        reservation.failed_at = now();
        reservation.failure_reason = cleanupErrors.length ? `${error.message} Compensação: ${cleanupErrors.join('; ')}.` : error.message;
        await writeJsonAtomic(ID_MANIFEST, manifest);
        throw error;
      }
    });
  } catch (error) {
    transactionError = error;
  }

  if (transactionError) {
    await appendLog('selo_novo_falha', { slug, message: transactionError.message });
    throw transactionError;
  }
  await appendLog('selo_novo', outcome);
  console.log(`${outcome.id} reservado e rascunho criado.`);
}

async function seloPreparar() {
  const { record } = await resolveRecord(args._[0]);
  const report = await auditOne(record.id);
  const output = { ...report, stage: 'preparacao', ready_for_review: report.errors.length === 0 && report.assets.every((asset) => asset.path_valid && asset.exists) };
  await writeJsonAtomic(path.join(REPORT_DIR, `${record.id}-preparacao.json`), output);
  await appendLog('selo_preparar', { id: record.id, ready: output.ready_for_review });
  console.log(JSON.stringify(output, null, 2));
  if (!output.ready_for_review) process.exitCode = 1;
}

async function seloValidar() {
  const targets = args._[0] ? [await resolveRecord(args._[0])] : await loadRecords();
  const results = [];
  for (const { path: filePath, record } of targets) {
    const validation = validateRecord(record, filePath);
    const assets = await validateAssets(record);
    const asset_errors = assetErrors(assets);
    results.push({
      id: record.id,
      valid: validation.errors.length === 0 && asset_errors.length === 0,
      structural_errors: validation.structural_errors,
      semantic_errors: validation.semantic_errors,
      editorial_errors: validation.editorial_errors,
      file_errors: validation.file_errors,
      asset_errors,
      errors: [...validation.errors, ...asset_errors],
      warnings: validation.warnings
    });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.valid)) process.exitCode = 1;
}
async function seloRevisao() {
  const { path: filePath, record } = await resolveRecord(args._[0]);
  if (record.publicacao.status === 'publicado') throw new Error('Registro publicado não pode retornar à revisão por este comando.');
  const candidate = structuredClone(record);
  candidate.aprovacao_humana = { status: 'pendente', decisao: 'pendente', aprovado_por: null, aprovado_em: null, hash_do_registro_aprovado: null, versao_aprovada: null, escopo: 'publicacao_catalogo', observacao: args.observacao || null };
  candidate.publicacao.status = 'aguardando_revisao';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = 'aguardando aprovação humana para publicação';
  candidate.auditoria.ultima_revisao = today();
  const validation = validateRecord(candidate, filePath);
  if (validation.errors.length) throw new Error(`REVISÃO BLOQUEADA:\n${validation.errors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_revisao', { id: candidate.id });
  console.log(`${candidate.id} encaminhado para revisão humana.`);
}
async function seloAprovar() {
  const reviewer = typeof args.revisor === 'string' ? args.revisor.trim() : '';
  if (!reviewer) throw new Error('Uso: npm run selo:aprovar -- <ID> --revisor <nome não vazio> [--observacao <texto>]');
  const { path: filePath, record } = await resolveRecord(args._[0]);
  if (record.publicacao.status === 'publicado') throw new Error('Registro já publicado.');

  const candidate = structuredClone(record);
  candidate.publicacao.status = 'aprovado';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = 'registro aprovado por revisão humana; validação técnica e publicação pendentes';
  candidate.auditoria.ultima_revisao = today();
  candidate.aprovacao_humana = {
    ...candidate.aprovacao_humana,
    status: 'aprovado', decisao: 'aprovado', aprovado_por: reviewer, aprovado_em: now(),
    hash_do_registro_aprovado: recordHash(candidate), versao_aprovada: candidate.auditoria.versao,
    escopo: 'publicacao_catalogo', observacao: args.observacao || null
  };
  appendEditorialEvent(candidate, { tipo: 'aprovacao', responsavel: reviewer, motivo: args.observacao || null, hash: candidate.aprovacao_humana.hash_do_registro_aprovado, versao: candidate.auditoria.versao });
  const errors = validateRecord(candidate, filePath).errors;
  if (errors.length) throw new Error(`APROVAÇÃO BLOQUEADA:\n${errors.join('\n')}`);

  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_aprovar', { id: candidate.id, aprovado_por: reviewer, hash: candidate.aprovacao_humana.hash_do_registro_aprovado });
  console.log(`${candidate.id} aprovado por ${reviewer}.`);
}

async function invalidateApproval(filePath, record, currentHash) {
  const candidate = structuredClone(record);
  candidate.aprovacao_humana.status = 'revogado';
  candidate.aprovacao_humana.decisao = 'pendente';
  candidate.aprovacao_humana.invalidado_em = now();
  candidate.aprovacao_humana.motivo_invalidacao = 'conteúdo alterado após aprovação';
  candidate.aprovacao_humana.revogado_por = 'pipeline';
  candidate.aprovacao_humana.revogado_em = candidate.aprovacao_humana.invalidado_em;
  candidate.aprovacao_humana.motivo_revogacao = candidate.aprovacao_humana.motivo_invalidacao;
  candidate.publicacao.status = 'revisao_necessaria';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = 'aprovação invalidada por divergência de hash';
  candidate.auditoria.ultima_revisao = today();
  appendEditorialEvent(candidate, { tipo: 'invalidacao', responsavel: 'pipeline', motivo: candidate.aprovacao_humana.motivo_invalidacao, hash: currentHash, versao: candidate.auditoria.versao });
  const validation = validateRecord(candidate, filePath);
  if (validation.errors.length) throw new Error(`INVALIDAÇÃO BLOQUEADA:\n${validation.errors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('aprovacao_invalidada', { id: candidate.id, hash_aprovado: candidate.aprovacao_humana.hash_do_registro_aprovado, hash_atual: currentHash });
}
async function seloPublicar() {
  const { path: filePath, record } = await resolveRecord(args._[0]);
  const approval = record.aprovacao_humana;
  const basicApprovalValid = approval?.status === 'aprovado' && approval?.decisao === 'aprovado' && approval?.aprovado_por && approval?.aprovado_em && approval?.hash_do_registro_aprovado && approval?.versao_aprovada;
  if (!basicApprovalValid) throw new Error('PUBLICAÇÃO BLOQUEADA: aprovação humana válida é obrigatória.');

  const currentHash = recordHash(record);
  if (currentHash !== approval.hash_do_registro_aprovado || record.auditoria?.versao !== approval.versao_aprovada) {
    await invalidateApproval(filePath, record, currentHash);
    throw new Error('PUBLICAÇÃO BLOQUEADA: conteúdo ou versão diverge da aprovação; aprovação invalidada.');
  }

  const assets = await validateAssets(record);
  const preflightErrors = [...validateRecord(record, filePath).errors, ...assetErrors(assets)];
  if (preflightErrors.length) throw new Error(`PUBLICAÇÃO BLOQUEADA:\n${preflightErrors.join('\n')}`);

  const candidate = structuredClone(record);
  candidate.publicacao.status = 'publicado';
  candidate.publicacao.apto_para_preview = true;
  candidate.publicacao.apto_para_publicacao = true;
  candidate.publicacao.motivo = 'registro homologado e aprovado para publicação';
  candidate.auditoria.ultima_revisao = today();
  appendEditorialEvent(candidate, { tipo: 'publicacao', responsavel: approval.aprovado_por, motivo: candidate.publicacao.motivo, hash: currentHash, versao: candidate.auditoria.versao });
  const finalErrors = validateRecord(candidate, filePath).errors;
  if (finalErrors.length) throw new Error(`PUBLICAÇÃO BLOQUEADA:\n${finalErrors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_publicar', { id: candidate.id, aprovado_por: approval.aprovado_por, hash: currentHash });
  console.log(`${candidate.id} marcado como publicado.`);
}

async function seloAuditoria() {
  const report = await auditOne(args._[0]);
  await appendLog('selo_auditoria', { id: report.id, valid: report.valid });
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

async function catalogoAuditoria() {
  const errors = [];
  const warnings = [];
  const informational = [];
  const files = await inspectRecordFiles();
  const records = [];
  const ids = new Set();
  const slugs = new Set();
  const results = [];

  for (const file of files) {
    if (!/^SEL-[0-9]{6}\.json$/.test(file.name)) errors.push(`Arquivo fora do padrão SEL-XXXXXX.json: ${file.name}.`);
    if (file.parse_error) { errors.push(`${file.name}: JSON ilegível (${file.parse_error}).`); continue; }
    records.push({ path: file.path, record: file.record });
    const validation = validateRecord(file.record, file.path);
    const editorialHistory = inspectEditorialHistory(file.record);
    validation.errors.push(...editorialHistory.errors);
    validation.warnings.push(...editorialHistory.warnings);
    informational.push(...editorialHistory.informational);
    if (ids.has(file.record.id)) validation.errors.push(`ID duplicado: ${file.record.id}`); else ids.add(file.record.id);
    const normalizedSlug = normalizeSlug(file.record.slug);
    if (slugs.has(normalizedSlug)) validation.errors.push(`Slug duplicado: ${normalizedSlug}`); else slugs.add(normalizedSlug);
    const assets = await validateAssets(file.record);
    const recordErrors = [...validation.errors, ...assetErrors(assets)];
    errors.push(...recordErrors);
    warnings.push(...validation.warnings);
    results.push({ id: file.record.id, slug: file.record.slug, file: file.name, errors: recordErrors, warnings: validation.warnings, informational: [], validation: { structural_errors: validation.structural_errors, semantic_errors: validation.semantic_errors, editorial_errors: validation.editorial_errors, file_errors: validation.file_errors }, assets });
  }

  let manifest;
  try { manifest = await readJson(ID_MANIFEST); }
  catch (error) { errors.push(`Manifesto ilegível: ${error.message}.`); }
  if (manifest) {
    const inspection = inspectManifest(manifest, records);
    errors.push(...inspection.errors);
    warnings.push(...inspection.warnings);
    informational.push(...inspection.informational);
    const filesById = new Map(records.map((item) => [item.record.id, item]));
    for (const reservation of Array.isArray(manifest.reserved) ? manifest.reserved : []) {
      if (!reservation?.id) continue;
      const fileEntry = filesById.get(reservation.id);
      const hasFile = Boolean(fileEntry);
      const hasAssetDirectory = await exists(path.join(ASSET_DIR, reservation.id));
      if (reservation.status === 'criado' && !hasFile) errors.push(`Reserva criada sem JSON: ${reservation.id}.`);
      else if (['reservado', 'criando'].includes(reservation.status) && !hasFile) warnings.push(`Reserva ${reservation.status} sem JSON: ${reservation.id}.`);
      else if (['falha_na_criacao', 'cancelado_sem_reuso'].includes(reservation.status) && !hasFile) informational.push(`Reserva ${reservation.status} preservada sem JSON: ${reservation.id}.`);
      if (reservation.status === 'falha_na_criacao' && hasFile) errors.push(`falha_na_criacao com JSON existente: ${reservation.id}.`);
      if (reservation.status === 'cancelado_sem_reuso' && hasFile) errors.push(`cancelado_sem_reuso com JSON existente: ${reservation.id}.`);
      if (reservation.status === 'criado' && !hasAssetDirectory) errors.push(`Reserva criada sem pasta de assets: ${reservation.id}.`);
      if (fileEntry && normalizeSlug(reservation.slug) !== normalizeSlug(fileEntry.record.slug)) errors.push(`Slug da reserva difere do JSON em ${reservation.id}: ${reservation.slug} != ${fileEntry.record.slug}.`);
    }
  }

  const recordIds = new Set(records.map((item) => item.record.id));
  const reservationIds = new Set(Array.isArray(manifest?.reserved) ? manifest.reserved.map((item) => item.id) : []);
  for (const directoryName of await readdir(ASSET_DIR).catch(() => [])) {
    const directoryPath = path.join(ASSET_DIR, directoryName);
    const details = await stat(directoryPath).catch(() => null);
    if (!details?.isDirectory()) continue;
    if (!recordIds.has(directoryName)) errors.push(`Diretório de assets órfão: ${directoryName}.`);
    if (!reservationIds.has(directoryName)) errors.push(`Diretório de assets sem reserva: ${directoryName}.`);
    const names = await readdir(directoryPath).catch(() => []);
    if (recordIds.has(directoryName) && names.length === 0) warnings.push(`Reserva criada com pasta de assets vazia: ${directoryName}.`);
    for (const name of names) if (name.toLowerCase().endsWith('.webp') && !new RegExp(`^${directoryName}-(frente|verso|card|thumb)\\.webp$`).test(name)) errors.push(`Arquivo WebP fora do padrão: ${directoryName}/${name}.`);
  }
  const residues = await operationalResidues();
  for (const residue of residues) (residue.safe_to_clean ? warnings : informational).push(`${residue.kind} ${residue.safe_to_clean ? 'antigo' : 'recente'}: ${residue.path}.`);
  const activeLock = await readLockSnapshot();
  if (activeLock) {
    const timestamp = Date.parse(activeLock.metadata?.timestamp ?? '');
    const age = Number.isFinite(timestamp) ? Date.now() - timestamp : null;
    if (isProcessActive(activeLock.metadata?.pid) && age !== null && age > LOCK_STALE_MS) warnings.push('Lock ativo há tempo excessivo.');
    if (!isProcessActive(activeLock.metadata?.pid) && age !== null && age > LOCK_STALE_MS) errors.push('Lock obsoleto pendente.');
  }
  const report = {
    generated_at: now(), total: records.length, valid: errors.length === 0,
    errors: uniqueFindings(errors), warnings: uniqueFindings(warnings), informational: uniqueFindings(informational), records: results
  };
  await writeJsonAtomic(path.join(REPORT_DIR, 'catalogo-auditoria.json'), report);
  await appendLog('catalogo_auditoria', { total: report.total, valid: report.valid, errors: report.errors.length, warnings: report.warnings.length });
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

function requiredNormalizedArg(name, usage) {
  const value = typeof args[name] === 'string' ? args[name].trim() : '';
  if (!value) throw Object.assign(new Error(usage), { code: 'CLI_USAGE', exitCode: 2, details: { missing: name } });
  return value;
}

async function seloRejeitar() {
  const reviewer = requiredNormalizedArg('revisor', 'Uso: npm run selo:rejeitar -- <ID> --revisor <nome> --motivo <motivo>');
  const reason = requiredNormalizedArg('motivo', 'Uso: npm run selo:rejeitar -- <ID> --revisor <nome> --motivo <motivo>');
  const { path: filePath, record } = await resolveRecord(args._[0]);
  const candidate = structuredClone(record);
  const occurredAt = now();
  candidate.aprovacao_humana = {
    ...(candidate.aprovacao_humana ?? {}), status: 'rejeitado', decisao: 'rejeitado',
    rejeitado_por: reviewer, rejeitado_em: occurredAt, motivo_rejeicao: reason,
    escopo: 'publicacao_catalogo', aprovado_por: candidate.aprovacao_humana?.aprovado_por ?? null,
    aprovado_em: candidate.aprovacao_humana?.aprovado_em ?? null,
    hash_do_registro_aprovado: candidate.aprovacao_humana?.hash_do_registro_aprovado ?? null,
    versao_aprovada: candidate.aprovacao_humana?.versao_aprovada ?? null
  };
  candidate.publicacao.status = 'revisao_necessaria';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = reason;
  candidate.auditoria.ultima_revisao = today();
  appendEditorialEvent(candidate, { tipo: 'rejeicao', responsavel: reviewer, motivo: reason, hash: recordHash(candidate), versao: candidate.auditoria.versao, ocorrido_em: occurredAt });
  const errors = validateRecord(candidate, filePath).errors;
  if (errors.length) throw new Error(`REJEIÇÃO BLOQUEADA:\n${errors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_rejeitar', { id: candidate.id, slug: candidate.slug, reviewer, status_anterior: record.publicacao.status, status_novo: candidate.publicacao.status, hash: recordHash(candidate), version: candidate.auditoria.versao });
  console.log(`${candidate.id} rejeitado por ${reviewer}.`);
}

async function seloRevogar() {
  const reviewer = requiredNormalizedArg('revisor', 'Uso: npm run selo:revogar -- <ID> --revisor <nome> --motivo <motivo>');
  const reason = requiredNormalizedArg('motivo', 'Uso: npm run selo:revogar -- <ID> --revisor <nome> --motivo <motivo>');
  const { path: filePath, record } = await resolveRecord(args._[0]);
  if (record.aprovacao_humana?.status !== 'aprovado' || record.aprovacao_humana?.decisao !== 'aprovado') throw new Error('REVOGAÇÃO BLOQUEADA: apenas aprovação ativa pode ser revogada.');
  const candidate = structuredClone(record);
  const occurredAt = now();
  candidate.aprovacao_humana.status = 'revogado';
  candidate.aprovacao_humana.decisao = 'pendente';
  candidate.aprovacao_humana.revogado_por = reviewer;
  candidate.aprovacao_humana.revogado_em = occurredAt;
  candidate.aprovacao_humana.motivo_revogacao = reason;
  candidate.publicacao.status = 'revisao_necessaria';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = reason;
  candidate.auditoria.ultima_revisao = today();
  appendEditorialEvent(candidate, { tipo: 'revogacao', responsavel: reviewer, motivo: reason, hash: recordHash(candidate), versao: candidate.auditoria.versao, ocorrido_em: occurredAt });
  const errors = validateRecord(candidate, filePath).errors;
  if (errors.length) throw new Error(`REVOGAÇÃO BLOQUEADA:\n${errors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_revogar', { id: candidate.id, slug: candidate.slug, reviewer, status_anterior: record.publicacao.status, status_novo: candidate.publicacao.status, hash: recordHash(candidate), version: candidate.auditoria.versao });
  console.log(`${candidate.id} teve a aprovação revogada por ${reviewer}.`);
}

async function seloStatus() {
  const { path: filePath, record } = await resolveRecord(args._[0]);
  const currentHash = recordHash(record);
  const assets = await validateAssets(record);
  const validation = validateRecord(record, filePath);
  let reservation = null;
  try { reservation = (await readJson(ID_MANIFEST)).reserved?.find((item) => item.id === record.id) ?? null; } catch {}
  const blockers = [...validation.errors, ...assetErrors(assets)];
  const data = {
    id: record.id, slug: record.slug, status_editorial: record.publicacao.status,
    estado_aprovacao: record.aprovacao_humana?.status ?? 'ausente',
    apto_para_preview: record.publicacao.apto_para_preview,
    apto_para_publicacao: record.publicacao.apto_para_publicacao,
    versao: record.auditoria.versao, hash_atual: currentHash,
    hash_aprovado: record.aprovacao_humana?.hash_do_registro_aprovado ?? null,
    divergencia_hash: Boolean(record.aprovacao_humana?.hash_do_registro_aprovado && record.aprovacao_humana.hash_do_registro_aprovado !== currentHash),
    assets_obrigatorios_presentes: assets.filter((asset) => REQUIRED_ASSETS.has(asset.kind)).every((asset) => asset.path_valid && asset.exists),
    reserva_no_manifesto: Boolean(reservation), status_reserva: reservation?.status ?? null,
    bloqueios: blockers, avisos: validation.warnings
  };
  console.log(JSON.stringify(data, null, 2));
  if (blockers.length) process.exitCode = 1;
}

async function operationalResidues() {
  const residues = [];
  const inspectDirectory = async (directory, matcher, kind) => {
    for (const name of await readdir(directory).catch(() => [])) {
      if (!matcher.test(name)) continue;
      const target = path.join(directory, name);
      const details = await stat(target).catch(() => null);
      if (!details) continue;
      residues.push({ kind, path: path.relative(ROOT, target), absolute: target, age_ms: Date.now() - details.mtimeMs, safe_to_clean: Date.now() - details.mtimeMs > LOCK_STALE_MS });
    }
  };
  await inspectDirectory(path.dirname(ID_LOCK), /^ids\.lock\.removal-/, 'lock_quarantine');
  await inspectDirectory(DATA_DIR, /\.tmp$|\.transaction-|\.removal-/, 'temporary');
  await inspectDirectory(path.dirname(ID_MANIFEST), /\.tmp$|\.transaction-/, 'temporary');
  return residues;
}

async function catalogoManutencao() {
  const lockSnapshot = await readLockSnapshot();
  const lockTimestamp = Date.parse(lockSnapshot?.metadata?.timestamp ?? '');
  const lock = lockSnapshot ? {
    exists: true, pid: lockSnapshot.metadata?.pid ?? null,
    active: isProcessActive(lockSnapshot.metadata?.pid),
    stale: Number.isFinite(lockTimestamp) && Date.now() - lockTimestamp > LOCK_STALE_MS && !isProcessActive(lockSnapshot.metadata?.pid),
    age_ms: Number.isFinite(lockTimestamp) ? Date.now() - lockTimestamp : null
  } : { exists: false, pid: null, active: false, stale: false, age_ms: null };
  const residues = await operationalResidues();
  const clean = args.limpar === true;
  const dryRun = args['dry-run'] === true || !clean;
  const removed = [];
  const blocked = [];
  if (clean && lock.active) blocked.push('Lock ativo não pode ser removido.');
  if (clean && !dryRun) {
    for (const residue of residues) {
      if (!residue.safe_to_clean) { blocked.push(`Artefato recente preservado: ${residue.path}.`); continue; }
      const snapshot = await readSnapshotAt(residue.absolute);
      if (snapshot && await removeVerifiedFile(residue.absolute, snapshot, () => true, 'maintenance')) removed.push(residue.path);
      else blocked.push(`Identidade não comprovada; preservado: ${residue.path}.`);
    }
    if (lock.stale) {
      const snapshot = await readLockSnapshot();
      if (await removeStaleLock(snapshot)) removed.push(path.relative(ROOT, ID_LOCK)); else blocked.push('Lock obsoleto não foi removido por divergência de identidade.');
    }
  }
  const data = { mode: args['dry-run'] === true ? 'dry-run' : (clean ? 'clean' : 'diagnostic'), lock, residues: residues.map(({ absolute: _absolute, ...item }) => item), removed, blocked };
  await appendLog('catalogo_manutencao', { mode: data.mode, removed: removed.length, blocked: blocked.length });
  console.log(JSON.stringify(data, null, 2));
  if (clean && blocked.length) process.exitCode = 3;
}

async function catalogoStatus() {
  const records = await loadRecords();
  const manifest = await readJson(ID_MANIFEST);
  const statuses = statusCounts(records, ['rascunho', 'aguardando_revisao', 'aprovado', 'publicado', 'revisao_necessaria']);
  const files = await inspectRecordFiles();
  const errors = [];
  const warnings = [];
  for (const file of files) {
    if (file.parse_error) { errors.push(`${file.name}: JSON ilegível.`); continue; }
    const validation = validateRecord(file.record, file.path);
    const history = inspectEditorialHistory(file.record);
    errors.push(...validation.errors, ...history.errors);
    warnings.push(...validation.warnings, ...history.warnings);
  }
  const residues = await operationalResidues();
  const lock = await readLockSnapshot();
  const data = {
    total_registros: records.length, ...statuses,
    ...reservationSummary(manifest),
    locks_ou_quarentenas_pendentes: residues.length + (lock ? 1 : 0),
    erros_auditoria: errors.length, warnings: warnings.length,
    proximo_id: `SEL-${String(manifest.next_sequence).padStart(6, '0')}`
  };
  console.log(JSON.stringify(data, null, 2));
  if (errors.length) process.exitCode = 1;
}
const commands = {
  'selo:novo': seloNovo,
  'selo:preparar': seloPreparar,
  'selo:validar': seloValidar,
  'selo:revisao': seloRevisao,
  'selo:aprovar': seloAprovar,
  'selo:rejeitar': seloRejeitar,
  'selo:revogar': seloRevogar,
  'selo:status': seloStatus,
  'selo:publicar': seloPublicar,
  'selo:auditoria': seloAuditoria,
  'catalogo:auditoria': catalogoAuditoria,
  'catalogo:status': catalogoStatus,
  'catalogo:manutencao': catalogoManutencao
};

export function availableCommands() {
  return Object.keys(commands);
}

export async function executeCommand(selectedCommand, argv = []) {
  command = selectedCommand;
  args = parseArgs(argv);
  transactionId = transactionIdFor(command);
  if (!commands[command]) throw Object.assign(new Error(`Comando inválido. Disponíveis: ${Object.keys(commands).join(', ')}`), { code: 'CLI_USAGE', exitCode: 2 });
  return commands[command]();
}

export { appendLog, parseArgs };
