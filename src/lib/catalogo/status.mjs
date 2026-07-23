import { recordHash } from '../selo-validation.mjs';
import { REQUIRED_ASSETS, assetErrors, validateAssets } from './assets.mjs';
import { statusCounts, validateRecord } from './audit.mjs';
import { inspectEditorialHistory } from './history.mjs';
import { readManifest, findReservation, reservationSummary } from './manifest.mjs';
import { diagnoseLock, operationalResidues } from './maintenance.mjs';
import { inspectRecordFiles, loadRecords, resolveRecord } from './records.mjs';

export async function getStampStatus(reference) {
  const { path: filePath, record } = await resolveRecord(reference); const currentHash = recordHash(record); const assets = await validateAssets(record); const validation = validateRecord(record, filePath); const history = inspectEditorialHistory(record); let reservation = null; try { reservation = findReservation(await readManifest([], { validate: false }), record.id); } catch {}
  const blockers = [...validation.errors, ...history.errors, ...assetErrors(assets)];
  return { data: { id: record.id, slug: record.slug, status_editorial: record.publicacao.status, estado_aprovacao: record.aprovacao_humana?.status ?? 'ausente', apto_para_preview: record.publicacao.apto_para_preview, apto_para_publicacao: record.publicacao.apto_para_publicacao, versao: record.auditoria.versao, hash_atual: currentHash, hash_aprovado: record.aprovacao_humana?.hash_do_registro_aprovado ?? null, divergencia_hash: Boolean(record.aprovacao_humana?.hash_do_registro_aprovado && record.aprovacao_humana.hash_do_registro_aprovado !== currentHash), assets_obrigatorios_presentes: assets.filter((asset) => REQUIRED_ASSETS.has(asset.kind)).every((asset) => asset.path_valid && asset.exists), reserva_no_manifesto: Boolean(reservation), status_reserva: reservation?.status ?? null, bloqueios: blockers, avisos: [...validation.warnings, ...history.warnings] }, errors: blockers, warnings: [...validation.warnings, ...history.warnings] };
}
export async function getCatalogStatus() {
  const records = await loadRecords(); const manifest = await readManifest([], { validate: false }); const statuses = statusCounts(records, ['rascunho', 'aguardando_revisao', 'aprovado', 'publicado', 'revisao_necessaria']); const files = await inspectRecordFiles(); const errors = []; const warnings = [];
  for (const file of files) { if (file.parse_error) { errors.push(`${file.name}: JSON ilegível.`); continue; } const validation = validateRecord(file.record, file.path); const history = inspectEditorialHistory(file.record); errors.push(...validation.errors, ...history.errors); warnings.push(...validation.warnings, ...history.warnings); }
  const operational = await operationalResidues(); const lock = await diagnoseLock(); errors.push(...operational.invalid_reports.map((item) => `Relatório ilegível: ${item.path}.`), ...operational.invalid_log_lines.map((item) => `Log ilegível: linha ${item.line}.`));
  return { data: { total_registros: records.length, ...statuses, ...reservationSummary(manifest), locks_ou_quarentenas_pendentes: operational.residues.length + (lock.exists ? 1 : 0), erros_auditoria: errors.length, warnings: warnings.length, proximo_id: `SEL-${String(manifest.next_sequence).padStart(6, '0')}` }, errors, warnings };
}