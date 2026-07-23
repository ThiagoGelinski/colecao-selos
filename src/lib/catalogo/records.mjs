import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ID_PATTERN, ROOT } from './paths.mjs';
import { readJson } from './io.mjs';
import { IntegrityError, RecordNotFoundError, UsageError } from './errors.mjs';

export function dataPath(id) { return path.join(DATA_DIR, `${id}.json`); }
export function normalizeSlug(value) { if (typeof value !== 'string') return ''; return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
export function sequenceFromId(id) { return ID_PATTERN.test(id ?? '') ? Number.parseInt(id.slice(4), 10) : null; }
export async function inspectRecordFiles() {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => { const filePath = path.join(DATA_DIR, name); try { return { name, path: filePath, record: await readJson(filePath), parse_error: null }; } catch (error) { return { name, path: filePath, record: null, parse_error: error.message }; } }));
}
export async function loadRecords() {
  const files = await inspectRecordFiles();
  const invalid = files.filter((item) => item.parse_error || !/^SEL-[0-9]{6}\.json$/.test(item.name));
  if (invalid.length) throw new IntegrityError(`Integridade dos arquivos inválida: ${invalid.map((item) => `${item.name}${item.parse_error ? ` (${item.parse_error})` : ''}`).join(', ')}`);
  return files.map(({ path: filePath, record }) => ({ path: filePath, record }));
}
export function assertGlobalRecordIntegrity(records) {
  const ids = new Map(); const slugs = new Map(); const errors = [];
  for (const { path: filePath, record } of records) { const label = path.relative(ROOT, filePath); if (ids.has(record.id)) errors.push(`ID duplicado ${record.id}: ${ids.get(record.id)} e ${label}.`); else ids.set(record.id, label); const normalized = normalizeSlug(record.slug); if (!normalized) errors.push(`${label}: slug inválido.`); else if (slugs.has(normalized)) errors.push(`Slug duplicado ${normalized}: ${slugs.get(normalized)} e ${label}.`); else slugs.set(normalized, label); }
  if (errors.length) throw new IntegrityError(`Integridade global inválida:\n${errors.join('\n')}`, { details: { errors } });
}
export async function resolveRecord(reference) {
  if (!reference) throw new UsageError('Informe um ID ou slug.');
  const records = await loadRecords(); const byId = typeof reference === 'string' && reference.startsWith('SEL-'); const searched = byId ? reference : normalizeSlug(reference);
  if (!searched) throw new UsageError(`Referência inválida: ${reference}`);
  const matches = records.filter(({ record }) => byId ? record.id === searched : normalizeSlug(record.slug) === searched);
  if (!matches.length) throw new RecordNotFoundError(`${byId ? 'ID' : 'Slug'} não encontrado: ${searched}`);
  if (matches.length > 1) throw new IntegrityError(`ERRO DE INTEGRIDADE: ${byId ? 'ID' : 'slug'} ambíguo (${searched}) em ${matches.length} registros.`);
  return matches[0];
}
export function validateFileIdentity(record, filePath) { const fileId = path.basename(filePath, '.json'); return fileId === record?.id ? [] : [`${path.relative(ROOT, filePath)}: nome do arquivo (${fileId}) difere do ID interno (${record?.id ?? 'ausente'}).`]; }