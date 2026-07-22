import type { NivelConfianca, StatusPublicacao } from '../types/selo';

export const displayValue = (value: unknown, fallback = 'Não informado') => value === null || value === undefined || value === '' ? fallback : String(value);
export const formatFaceValue = (value: number | string, unit: string) => `${value} ${unit}`;
export const formatYear = (year?: number | null) => year ? String(year) : 'Ano pendente';
export const formatDate = (date?: string | null) => date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : 'Data pendente';
export const formatDimensions = (dimensions?: { largura?: number | null; altura?: number | null } | null) => dimensions?.largura && dimensions?.altura ? `${dimensions.largura} × ${dimensions.altura} mm` : 'Não informadas';
export const catalogName = (name: string) => ({ Yvert_et_Tellier: 'Yvert et Tellier', Stanley_Gibbons: 'Stanley Gibbons' }[name] ?? name);
export const formatConfidence = (value?: NivelConfianca | null) => {
  if (!value) return 'Informação pendente';
  const normalized = String(value).toLowerCase();
  if (normalized === 'confirmado' || normalized.startsWith('confirmado por')) return 'Confirmado';
  if (normalized.includes('diverg')) return 'Fontes divergentes';
  if (normalized.includes('prov')) return 'Provável';
  if (normalized.includes('alta confiança') || normalized === 'alta_confianca') return 'Alta confiança';
  if (normalized.includes('pend')) return 'Informação pendente';
  return String(value);
};
export const formatStatus = (value: StatusPublicacao) => {
  const labels: Partial<Record<StatusPublicacao, string>> = { em_pesquisa: 'Em pesquisa', identificacao_parcial: 'Identificação parcial', aguardando_revisao: 'Aguardando revisão', homologacao: 'Homologação', revisao_necessaria: 'Revisão necessária' };
  return labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
};
export const isConfirmed = (value?: string | null) => !!value && (value === 'confirmado' || value.startsWith('confirmado por'));

