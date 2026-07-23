const EVENT_TYPES = new Set(['aprovacao', 'rejeicao', 'revogacao', 'publicacao', 'invalidacao']);

export function editorialEvent({ tipo, responsavel, motivo = null, hash = null, versao = null, ocorrido_em = new Date().toISOString() }) {
  return { tipo, ocorrido_em, responsavel, motivo, hash, versao };
}

export function appendEditorialEvent(record, event) {
  const history = Array.isArray(record.historico_editorial) ? [...record.historico_editorial] : [];
  const next = editorialEvent(event);
  history.push(next);
  history.sort((left, right) => Date.parse(left.ocorrido_em) - Date.parse(right.ocorrido_em));
  record.historico_editorial = history;
  return next;
}

export function inspectEditorialHistory(record) {
  const errors = [];
  const warnings = [];
  const informational = [];
  const history = record.historico_editorial;
  if (history === undefined) {
    informational.push(`${record.id}: registro legado sem historico_editorial.`);
    return { errors, warnings, informational };
  }
  if (!Array.isArray(history)) return { errors: [`${record.id}: historico_editorial deve ser array.`], warnings, informational };
  let previous = -Infinity;
  const seen = new Set();
  let hasApproval = false;
  for (const [index, event] of history.entries()) {
    const label = `${record.id}: historico_editorial[${index}]`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) { errors.push(`${label} deve ser objeto.`); continue; }
    if (!EVENT_TYPES.has(event.tipo)) errors.push(`${label}: tipo inválido.`);
    const timestamp = Date.parse(event.ocorrido_em ?? '');
    if (!Number.isFinite(timestamp)) errors.push(`${label}: ocorrido_em inválido.`);
    else if (timestamp < previous) errors.push(`${label}: eventos fora de ordem cronológica.`);
    previous = Math.max(previous, timestamp);
    if (typeof event.responsavel !== 'string' || !event.responsavel.trim()) errors.push(`${label}: responsável obrigatório.`);
    if (['rejeicao', 'revogacao', 'invalidacao'].includes(event.tipo) && (typeof event.motivo !== 'string' || !event.motivo.trim())) errors.push(`${label}: motivo obrigatório.`);
    if (event.hash != null && !/^[a-f0-9]{64}$/.test(event.hash)) errors.push(`${label}: hash inválido.`);
    if (event.versao != null && (typeof event.versao !== 'string' || !event.versao.trim())) errors.push(`${label}: versão inválida.`);
    const signature = JSON.stringify(event);
    if (seen.has(signature)) warnings.push(`${label}: evento duplicado evidente.`); else seen.add(signature);
    if (event.tipo === 'aprovacao') hasApproval = true;
    if (event.tipo === 'revogacao' && !hasApproval) errors.push(`${label}: revogação sem aprovação anterior.`);
  }
  const last = history.at(-1);
  if (record.publicacao?.status === 'publicado' && !history.some((event) => event.tipo === 'publicacao')) errors.push(`${record.id}: publicação sem evento de publicação.`);
  if (record.aprovacao_humana?.status === 'aprovado' && !history.some((event) => event.tipo === 'aprovacao')) errors.push(`${record.id}: aprovação ativa sem evento de aprovação.`);
  if (record.aprovacao_humana?.status === 'rejeitado' && last?.tipo !== 'rejeicao') warnings.push(`${record.id}: estado rejeitado diverge do último evento editorial.`);
  if (record.aprovacao_humana?.status === 'revogado' && !['revogacao', 'invalidacao'].includes(last?.tipo)) warnings.push(`${record.id}: estado revogado diverge do último evento editorial.`);
  return { errors, warnings, informational };
}