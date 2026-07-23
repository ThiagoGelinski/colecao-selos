const STATUS_GROUPS = {
  rascunhos: ['rascunho'],
  em_preparacao: ['em_pesquisa', 'identificacao_parcial'],
  aguardando_revisao: ['aguardando_revisao', 'homologacao'],
  aprovados: ['aprovado'],
  publicados: ['publicado'],
  rejeitados_ou_correcoes: ['revisao_necessaria'],
};
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
export function sanitizeSearch(value) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100); }
const layerSummary = (layer) => ({ valida: Boolean(layer?.valid), erros: layer?.errors?.length ?? 0 });
export function toAdminRecord(record, validation) {
  const assetItems = validation?.layers?.assets?.items ?? [];
  const assetByKind = new Map(assetItems.map((asset) => [asset.kind, asset]));
  const imageState = (kind) => {
    const asset = assetByKind.get(kind);
    return { informado: Boolean(record.imagens?.[kind]), caminho_valido: asset?.path_valid ?? null, existe: asset?.exists ?? null, valido: Boolean(asset?.path_valid && asset?.exists), erro: asset?.error ?? null };
  };
  return {
    id: record.id, slug: record.slug, titulo: record.titulo, pais: record.identificacao?.pais ?? null,
    ano: record.emissao?.ano ?? null, status: record.publicacao?.status ?? 'desconhecido',
    atualizado_em: record.auditoria?.ultima_revisao ?? null,
    imagens: { frente: imageState('frente'), verso: imageState('verso'), card: imageState('card'), thumb: imageState('thumb') },
    validacao: {
      valida: Boolean(validation?.valid), erros: validation?.errors?.length ?? 0,
      estrutural: layerSummary(validation?.layers?.structural), semantica: layerSummary(validation?.layers?.semantic), editorial: layerSummary(validation?.layers?.editorial), assets: layerSummary(validation?.layers?.assets),
    },
  };
}
export function dashboardStats(records, validations = new Map()) {
  const stats = { total: records.length, rascunhos: 0, em_preparacao: 0, aguardando_revisao: 0, aprovados: 0, publicados: 0, rejeitados_ou_correcoes: 0, com_erro: 0 };
  for (const record of records) {
    for (const [key, statuses] of Object.entries(STATUS_GROUPS)) if (statuses.includes(record.publicacao?.status)) stats[key] += 1;
    if (validations.get(record.id)?.valid === false) stats.com_erro += 1;
  }
  const activity = records.flatMap((record) => {
    const editorial = Array.isArray(record.historico_editorial) ? record.historico_editorial.map((event) => ({ id: record.id, titulo: record.titulo, tipo: event.tipo, ocorrido_em: event.ocorrido_em, responsavel: event.responsavel })) : [];
    if (editorial.length) return editorial;
    return record.auditoria?.ultima_revisao ? [{ id: record.id, titulo: record.titulo, tipo: 'revisao', ocorrido_em: record.auditoria.ultima_revisao, responsavel: null }] : [];
  }).filter((item) => Number.isFinite(Date.parse(item.ocorrido_em))).sort((a, b) => Date.parse(b.ocorrido_em) - Date.parse(a.ocorrido_em)).slice(0, 10);
  return { indicadores: stats, atividade_recente: activity };
}
export function listAdminRecords(records, { q = '', status = '', sort = 'id', direction = 'asc', page = 1, pageSize = 20 } = {}) {
  const query = normalize(sanitizeSearch(q));
  const allowedStatuses = new Set(records.map((record) => record.status));
  const selectedStatus = allowedStatuses.has(status) ? status : '';
  const filtered = records.filter((record) => (!query || normalize(`${record.id} ${record.titulo}`).includes(query)) && (!selectedStatus || record.status === selectedStatus));
  const sortKeys = new Set(['id', 'titulo', 'pais', 'ano', 'status', 'atualizado_em']);
  const key = sortKeys.has(sort) ? sort : 'id'; const factor = direction === 'desc' ? -1 : 1;
  filtered.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'pt-BR', { numeric: true }) * factor);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const pages = Math.max(1, Math.ceil(filtered.length / safePageSize)); const safePage = Math.min(pages, Math.max(1, Number(page) || 1));
  return { items: filtered.slice((safePage - 1) * safePageSize, safePage * safePageSize), meta: { total: filtered.length, page: safePage, pageSize: safePageSize, pages }, filters: { statuses: [...allowedStatuses].sort() } };
}
