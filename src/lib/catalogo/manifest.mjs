import path from 'node:path';
import { ID_MANIFEST, LOCK_STALE_MS, RESERVATION_STATUSES, ROOT } from './paths.mjs';
import { readJson } from './io.mjs';
import { ManifestError } from './errors.mjs';
import { normalizeSlug, sequenceFromId } from './records.mjs';

export function validDate(value) { return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value)); }
export function inspectManifest(manifest, records = []) {
  const errors = []; const warnings = []; const informational = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { errors: ['Manifesto deve ser um objeto.'], warnings, informational };
  if (manifest.schema_version !== '2.0.0') errors.push('Manifesto: schema_version deve ser 2.0.0.');
  if (manifest.prefix !== 'SEL') errors.push('Manifesto: prefix deve ser "SEL".');
  if (manifest.digits !== 6) errors.push('Manifesto: digits deve ser 6.');
  if (!Number.isInteger(manifest.next_sequence) || manifest.next_sequence < 1) errors.push('Manifesto: next_sequence deve ser inteiro positivo.');
  if (!Array.isArray(manifest.reserved)) return { errors: [...errors, 'Manifesto: reserved deve ser array.'], warnings, informational };
  const ids = new Set(); const sequences = new Set(); let maximum = 0;
  for (const [index, reservation] of manifest.reserved.entries()) {
    const label = `Manifesto reserved[${index}]`;
    if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) { errors.push(`${label}: reserva deve ser objeto.`); continue; }
    for (const field of ['id', 'sequence', 'reserved_at', 'source', 'status', 'slug']) if (reservation[field] === undefined || reservation[field] === null || reservation[field] === '') errors.push(`${label}: ${field} obrigatório.`);
    if (!/^SEL-[0-9]{6}$/.test(reservation.id ?? '')) errors.push(`${label}: ID inválido (${reservation.id ?? 'ausente'}).`);
    if (ids.has(reservation.id)) errors.push(`${label}: ID duplicado (${reservation.id}).`); else ids.add(reservation.id);
    if (!Number.isInteger(reservation.sequence) || reservation.sequence < 1) errors.push(`${label}: sequence inválida.`); else { maximum = Math.max(maximum, reservation.sequence); if (sequences.has(reservation.sequence)) errors.push(`${label}: sequence duplicada (${reservation.sequence}).`); else sequences.add(reservation.sequence); const expected = sequenceFromId(reservation.id); if (expected !== null && expected !== reservation.sequence) errors.push(`${label}: id e sequence inconsistentes.`); }
    if (!validDate(reservation.reserved_at)) errors.push(`${label}: reserved_at inválido.`);
    if (typeof reservation.source !== 'string' || !reservation.source.trim()) errors.push(`${label}: source inválido.`);
    if (typeof reservation.slug !== 'string' || !normalizeSlug(reservation.slug)) errors.push(`${label}: slug inválido.`);
    if (!RESERVATION_STATUSES.has(reservation.status)) errors.push(`${label}: status inválido (${reservation.status ?? 'ausente'}).`);
    for (const field of ['created_at', 'completed_at', 'failed_at', 'cancelado_em']) if (reservation[field] != null && !validDate(reservation[field])) errors.push(`${label}: ${field} inválido.`);
    if (reservation.status === 'criado') { if (!validDate(reservation.created_at)) errors.push(`${label}: criado exige created_at.`); if (!validDate(reservation.completed_at)) errors.push(`${label}: criado exige completed_at.`); if (reservation.failed_at != null || reservation.failure_reason != null) errors.push(`${label}: criado não pode ter failed_at ou failure_reason.`); if (reservation.cancelado_em != null || reservation.cancellation_reason != null) errors.push(`${label}: criado não pode ter dados de cancelamento.`); }
    else if (reservation.status === 'falha_na_criacao') { if (!validDate(reservation.failed_at)) errors.push(`${label}: falha_na_criacao exige failed_at.`); if (typeof reservation.failure_reason !== 'string' || !reservation.failure_reason.trim()) errors.push(`${label}: falha_na_criacao exige failure_reason.`); if (reservation.completed_at != null) errors.push(`${label}: falha_na_criacao não pode ter completed_at.`); if (reservation.cancelado_em != null || reservation.cancellation_reason != null) errors.push(`${label}: falha_na_criacao não pode ter dados de cancelamento.`); }
    else if (reservation.status === 'cancelado_sem_reuso') { if (!validDate(reservation.cancelado_em)) errors.push(`${label}: cancelado_sem_reuso exige cancelado_em.`); if (typeof reservation.cancellation_reason !== 'string' || !reservation.cancellation_reason.trim()) errors.push(`${label}: cancelado_sem_reuso exige cancellation_reason.`); if (reservation.completed_at != null || reservation.failed_at != null || reservation.failure_reason != null) errors.push(`${label}: cancelado_sem_reuso possui campos incompatíveis.`); informational.push(`${label}: ID cancelado preservado sem reuso (${reservation.id}).`); }
    else if (['reservado', 'criando'].includes(reservation.status) && (reservation.completed_at != null || reservation.failed_at != null || reservation.failure_reason != null || reservation.cancelado_em != null || reservation.cancellation_reason != null)) errors.push(`${label}: ${reservation.status} possui campos incompatíveis.`);
    if (reservation.status === 'criando' && validDate(reservation.reserved_at) && Date.now() - Date.parse(reservation.reserved_at) > LOCK_STALE_MS) warnings.push(`${label}: reserva em criação antiga (${reservation.id}).`);
  }
  if (Number.isInteger(manifest.next_sequence) && manifest.next_sequence <= maximum) errors.push(`Manifesto: next_sequence (${manifest.next_sequence}) deve ser maior que a maior sequence (${maximum}).`);
  if (Number.isInteger(manifest.next_sequence)) { const gaps = []; for (let sequence = 1; sequence < manifest.next_sequence; sequence += 1) if (!sequences.has(sequence)) gaps.push(sequence); if (gaps.length) informational.push(`Manifesto: lacunas permitidas e não reutilizáveis: ${gaps.join(', ')}.`); }
  for (const { record, path: filePath } of records) if (record?.id && !ids.has(record.id)) errors.push(`${path.relative(ROOT, filePath)}: arquivo sem reserva no manifesto (${record.id}).`);
  return { errors, warnings, informational };
}
export function assertManifestValid(manifest, records = []) { const inspection = inspectManifest(manifest, records); if (inspection.errors.length) throw new ManifestError(`Manifesto inválido:\n${inspection.errors.join('\n')}`, { details: inspection }); return inspection; }
export async function readManifest(records = [], { validate = true } = {}) { const manifest = await readJson(ID_MANIFEST); if (validate) assertManifestValid(manifest, records); return manifest; }
export function reservationSummary(manifest) { const reservations = Array.isArray(manifest?.reserved) ? manifest.reserved : []; return { reservas: reservations.length, falhas_criacao: reservations.filter((item) => item.status === 'falha_na_criacao').length, cancelados: reservations.filter((item) => item.status === 'cancelado_sem_reuso').length }; }
export function findReservation(manifest, id) { return Array.isArray(manifest?.reserved) ? manifest.reserved.find((item) => item.id === id) ?? null : null; }