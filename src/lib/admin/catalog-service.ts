import type { Selo } from '../../types/selo';
import { validateRecordOperational } from '../catalogo/audit.mjs';
import { dataPath, loadRecords } from '../catalogo/records.mjs';
import { dashboardStats, listAdminRecords, toAdminRecord } from './catalog-domain.mjs';
interface ListOptions { q?: string; status?: string; sort?: string; direction?: string; page?: number; pageSize?: number; }

async function getRecords(): Promise<Selo[]> {
  const loaded = await loadRecords();
  return loaded.map(f => f.record as Selo).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getAdminStamp(id: string) {
  let record: Selo | null = null;
  try {
    const { readJson } = await import('../catalogo/io.mjs');
    record = await readJson(dataPath(id)) as Selo;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const validation = await validateRecordOperational(record, dataPath(id));
  return { resumo: toAdminRecord(record, validation), registro: record, historico: record.historico_editorial ?? [], validacao: validation };
}

export async function getAdminDashboard() {
  const records = await getRecords();
  const validations = new Map(await Promise.all(records.map(async (record) => [record.id, await validateRecordOperational(record, dataPath(record.id))] as const)));
  return dashboardStats(records, validations);
}

export async function getAdminStamps(options: ListOptions) {
  const records = await getRecords();
  const validations = new Map(await Promise.all(records.map(async (record) => [record.id, await validateRecordOperational(record, dataPath(record.id))] as const)));
  return listAdminRecords(records.map((record) => toAdminRecord(record, validations.get(record.id)!)), options);
}

export function getAdminConfigurationStatus(env = process.env) { return { site_url_configurada: Boolean(env.SITE_URL), autenticacao_configurada: Boolean(env.ADMIN_SESSION_SECRET), persistencia_credenciais: '@netlify/blobs', bootstrap_uso_unico: true, role_padrao: env.ADMIN_ROLE || 'administrador', duracao_sessao_segundos: Number(env.ADMIN_SESSION_TTL_SECONDS || 28800) }; }
