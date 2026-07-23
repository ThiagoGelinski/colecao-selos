import type { Selo } from '../../types/selo';
import { validateRecordOperational } from '../catalogo/audit.mjs';
import { dataPath } from '../catalogo/records.mjs';
import { dashboardStats, listAdminRecords, toAdminRecord } from './catalog-domain.mjs';
interface ListOptions { q?: string; status?: string; sort?: string; direction?: string; page?: number; pageSize?: number; }
const modules = import.meta.glob<Selo>('../../data/selos/*.json', { eager: true, import: 'default' });
const records: Selo[] = Object.values(modules).sort((a, b) => a.id.localeCompare(b.id));
let validationCache: Promise<Map<string, Awaited<ReturnType<typeof validateRecordOperational>>>> | null = null;
function getValidations() {
  validationCache ??= Promise.all(records.map(async (record) => [record.id, await validateRecordOperational(record, dataPath(record.id))] as const)).then((entries) => new Map(entries));
  return validationCache;
}
export async function getAdminStamp(id: string) { const record = records.find((item) => item.id === id); if (!record) return null; const validations = await getValidations(); const validation = validations.get(record.id); return { resumo: toAdminRecord(record, validation), registro: record, historico: record.historico_editorial ?? [], validacao: validation }; }
export async function getAdminDashboard() { return dashboardStats(records, await getValidations()); }
export async function getAdminStamps(options: ListOptions) { const validations = await getValidations(); return listAdminRecords(records.map((record) => toAdminRecord(record, validations.get(record.id))), options); }
export function getAdminConfigurationStatus(env = process.env) { return { site_url_configurada: Boolean(env.SITE_URL), autenticacao_configurada: Boolean(env.ADMIN_SESSION_SECRET), persistencia_credenciais: '@netlify/blobs', bootstrap_uso_unico: true, role_padrao: env.ADMIN_ROLE || 'administrador', duracao_sessao_segundos: Number(env.ADMIN_SESSION_TTL_SECONDS || 28800) }; }
