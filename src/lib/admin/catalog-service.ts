import type { Selo } from '../../types/selo';
import { validateSeloData } from '../selo-validation.mjs';
import { dashboardStats, listAdminRecords, toAdminRecord } from './catalog-domain.mjs';
interface ListOptions { q?: string; status?: string; sort?: string; direction?: string; page?: number; pageSize?: number; }
const modules = import.meta.glob<Selo>('../../data/selos/*.json', { eager: true, import: 'default' });
const records: Selo[] = Object.values(modules).sort((a, b) => a.id.localeCompare(b.id));
const validations = new Map(records.map((record) => [record.id, validateSeloData(record)]));
export function getAdminStamp(id: string) { const record = records.find((item) => item.id === id); if (!record) return null; return { resumo: toAdminRecord(record, validations.get(record.id)), registro: record, historico: record.historico_editorial ?? [], validacao: validations.get(record.id) }; }
export function getAdminDashboard() { return dashboardStats(records, validations); }
export function getAdminStamps(options: ListOptions) { return listAdminRecords(records.map((record) => toAdminRecord(record, validations.get(record.id))), options); }
export function getAdminConfigurationStatus(env = process.env) { return { site_url_configurada: Boolean(env.SITE_URL), autenticacao_configurada: Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD_HASH && env.ADMIN_SESSION_SECRET), role_padrao: env.ADMIN_ROLE || 'administrador', duracao_sessao_segundos: Number(env.ADMIN_SESSION_TTL_SECONDS || 28800) }; }
