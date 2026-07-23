import path from 'node:path';
import { formatValidationIssue, validateSeloEditorial, validateSeloSchema, validateSeloSemantics } from '../selo-validation.mjs';
import { assetErrors, validateAssets } from './assets.mjs';
import { inspectEditorialHistory } from './history.mjs';
import { exists, readJson, writeJsonAtomic } from './io.mjs';
import { inspectManifest } from './manifest.mjs';
import { operationalResidues, diagnoseLock } from './maintenance.mjs';
import { ASSET_DIR, ID_MANIFEST, LOCK_STALE_MS, REPORT_DIR, ROOT } from './paths.mjs';
import { inspectRecordFiles, normalizeSlug, resolveRecord, validateFileIdentity } from './records.mjs';

const now = () => new Date().toISOString();
const formatLayerErrors = (label, layer) => layer.errors.map((error) => `${label}: ${formatValidationIssue(error)}`);
export function uniqueFindings(values) { return [...new Set(values)]; }
export function statusCounts(records, statuses) { return Object.fromEntries(statuses.map((status) => [status, records.filter(({ record }) => record.publicacao.status === status).length])); }
export function validateRecord(record, filePath) {
  const label = path.relative(ROOT, filePath); const structural = validateSeloSchema(record); const semantic = validateSeloSemantics(record); const editorial = structural.valid ? validateSeloEditorial(record) : { valid: false, errors: [] }; const fileErrors = validateFileIdentity(record, filePath);
  const errors = [...formatLayerErrors(label, structural), ...formatLayerErrors(label, semantic), ...formatLayerErrors(label, editorial), ...fileErrors];
  const warnings = !record?.aprovacao_humana && record?.publicacao?.status !== 'rascunho' ? [`${label}: registro legado sem bloco aprovacao_humana.`] : [];
  return { errors, warnings, structural_errors: structural.errors, semantic_errors: semantic.errors, editorial_errors: editorial.errors, file_errors: fileErrors };
}
export async function auditOne(reference) {
  const { path: filePath, record } = await resolveRecord(reference); const validation = validateRecord(record, filePath); const history = inspectEditorialHistory(record); const assets = await validateAssets(record); const errors = [...validation.errors, ...history.errors, ...assetErrors(assets)];
  const report = { generated_at: now(), id: record.id, slug: record.slug, valid: errors.length === 0, publication_blocked: errors.some((error) => /publica|aprova|hash/i.test(error)), errors, warnings: [...validation.warnings, ...history.warnings], informational: history.informational, validation: { structural_errors: validation.structural_errors, semantic_errors: validation.semantic_errors, editorial_errors: validation.editorial_errors, file_errors: validation.file_errors }, assets };
  await writeJsonAtomic(path.join(REPORT_DIR, `${record.id}-auditoria.json`), report); return report;
}
export async function auditCatalog() {
  const errors = []; const warnings = []; const informational = []; const files = await inspectRecordFiles(); const records = []; const ids = new Set(); const slugs = new Set(); const results = [];
  for (const file of files) {
    if (!/^SEL-[0-9]{6}\.json$/.test(file.name)) errors.push(`Arquivo fora do padrão SEL-XXXXXX.json: ${file.name}.`);
    if (file.parse_error) { errors.push(`${file.name}: JSON ilegível (${file.parse_error}).`); continue; }
    records.push({ path: file.path, record: file.record }); const validation = validateRecord(file.record, file.path); const history = inspectEditorialHistory(file.record); validation.errors.push(...history.errors); validation.warnings.push(...history.warnings); informational.push(...history.informational);
    if (ids.has(file.record.id)) validation.errors.push(`ID duplicado: ${file.record.id}`); else ids.add(file.record.id); const normalizedSlug = normalizeSlug(file.record.slug); if (slugs.has(normalizedSlug)) validation.errors.push(`Slug duplicado: ${normalizedSlug}`); else slugs.add(normalizedSlug);
    const assets = await validateAssets(file.record); const recordErrors = [...validation.errors, ...assetErrors(assets)]; errors.push(...recordErrors); warnings.push(...validation.warnings); results.push({ id: file.record.id, slug: file.record.slug, file: file.name, errors: recordErrors, warnings: validation.warnings, informational: history.informational, validation: { structural_errors: validation.structural_errors, semantic_errors: validation.semantic_errors, editorial_errors: validation.editorial_errors, file_errors: validation.file_errors }, assets });
  }
  let manifest; try { manifest = await readJson(ID_MANIFEST); } catch (error) { errors.push(`Manifesto ilegível: ${error.message}.`); }
  if (manifest) {
    const inspection = inspectManifest(manifest, records); errors.push(...inspection.errors); warnings.push(...inspection.warnings); informational.push(...inspection.informational); const filesById = new Map(records.map((item) => [item.record.id, item]));
    for (const reservation of Array.isArray(manifest.reserved) ? manifest.reserved : []) { if (!reservation?.id) continue; const fileEntry = filesById.get(reservation.id); const hasFile = Boolean(fileEntry); const hasAssetDirectory = await exists(path.join(ASSET_DIR, reservation.id)); if (reservation.status === 'criado' && !hasFile) errors.push(`Reserva criada sem JSON: ${reservation.id}.`); else if (['reservado', 'criando'].includes(reservation.status) && !hasFile) warnings.push(`Reserva ${reservation.status} sem JSON: ${reservation.id}.`); else if (['falha_na_criacao', 'cancelado_sem_reuso'].includes(reservation.status) && !hasFile) informational.push(`Reserva ${reservation.status} preservada sem JSON: ${reservation.id}.`); if (reservation.status === 'falha_na_criacao' && hasFile) errors.push(`falha_na_criacao com JSON existente: ${reservation.id}.`); if (reservation.status === 'cancelado_sem_reuso' && hasFile) errors.push(`cancelado_sem_reuso com JSON existente: ${reservation.id}.`); if (reservation.status === 'criado' && !hasAssetDirectory) errors.push(`Reserva criada sem pasta de assets: ${reservation.id}.`); if (fileEntry && normalizeSlug(reservation.slug) !== normalizeSlug(fileEntry.record.slug)) errors.push(`Slug da reserva difere do JSON em ${reservation.id}: ${reservation.slug} != ${fileEntry.record.slug}.`); }
  }
  const operational = await operationalResidues();
  for (const item of operational.asset_directories) { if (item.orphan) errors.push(`Diretório de assets órfão: ${item.id}.`); if (item.without_reservation) errors.push(`Diretório de assets sem reserva: ${item.id}.`); if (item.empty && !item.orphan) warnings.push(`Reserva criada com pasta de assets vazia: ${item.id}.`); for (const name of item.webp_outside_pattern) errors.push(`Arquivo WebP fora do padrão: ${item.id}/${name}.`); }
  for (const residue of operational.residues) (residue.safe_to_clean ? warnings : informational).push(`${residue.kind} ${residue.safe_to_clean ? 'antigo' : 'recente'}: ${residue.path}.`);
  for (const item of operational.invalid_reports) errors.push(`Relatório JSON ilegível: ${item.path} (${item.error}).`);
  for (const item of operational.invalid_log_lines) errors.push(`Log JSONL ilegível na linha ${item.line}: ${item.error}.`);
  for (const item of operational.unfinished_transactions) warnings.push(`Transação sem evento final: ${item.transaction_id} (${item.command ?? 'comando desconhecido'}).`);
  const lock = await diagnoseLock(); if (lock.active && lock.age_ms > LOCK_STALE_MS) warnings.push('Lock ativo há tempo excessivo.'); if (lock.stale) errors.push('Lock obsoleto pendente.');
  const report = { generated_at: now(), total: records.length, valid: errors.length === 0, errors: uniqueFindings(errors), warnings: uniqueFindings(warnings), informational: uniqueFindings(informational), records: results };
  await writeJsonAtomic(path.join(REPORT_DIR, 'catalogo-auditoria.json'), report); return report;
}