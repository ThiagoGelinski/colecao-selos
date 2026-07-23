const EVENT_TYPES = new Set(['aprovacao', 'rejeicao', 'revogacao', 'publicacao', 'invalidacao']);
const REVIEW_EVENTS = new Set(['rejeicao', 'revogacao', 'invalidacao']);
export function editorialEvent({ tipo, responsavel, motivo = null, hash = null, versao = null, ocorrido_em = new Date().toISOString() }) { return { tipo, ocorrido_em, responsavel, motivo, hash, versao }; }
export function appendEditorialEvent(record, event) { const history = Array.isArray(record.historico_editorial) ? [...record.historico_editorial] : []; const next = editorialEvent(event); history.push(next); history.sort((left, right) => Date.parse(left.ocorrido_em) - Date.parse(right.ocorrido_em)); record.historico_editorial = history; return next; }
export function revokeApproval(record, { reviewer, reason, type = 'revogacao', currentHash = null, occurredAt = new Date().toISOString() }) {
  if (!['revogacao', 'invalidacao'].includes(type)) throw new Error(`Tipo de revogação inválido: ${type}.`);
  const candidate = structuredClone(record); const approval = candidate.aprovacao_humana;
  approval.status = 'revogado'; approval.decisao = 'pendente'; approval.revogado_por = reviewer; approval.revogado_em = occurredAt; approval.motivo_revogacao = reason;
  if (type === 'invalidacao') { approval.invalidado_em = occurredAt; approval.motivo_invalidacao = reason; }
  candidate.publicacao.status = 'revisao_necessaria'; candidate.publicacao.apto_para_publicacao = false; candidate.publicacao.motivo = reason;
  appendEditorialEvent(candidate, { tipo: type, responsavel: reviewer, motivo: reason, hash: currentHash, versao: candidate.auditoria?.versao ?? null, ocorrido_em: occurredAt });
  return candidate;
}
export function inspectEditorialHistory(record) {
  const errors = []; const warnings = []; const informational = []; const history = record.historico_editorial;
  if (history === undefined) { informational.push(`${record.id}: registro legado sem historico_editorial.`); return { errors, warnings, informational }; }
  if (!Array.isArray(history)) return { errors: [`${record.id}: historico_editorial deve ser array.`], warnings, informational };
  let previous = -Infinity; let hasApproval = false; const seen = new Set();
  for (const [index, event] of history.entries()) {
    const label = `${record.id}: historico_editorial[${index}]`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) { errors.push(`${label} deve ser objeto.`); continue; }
    if (!EVENT_TYPES.has(event.tipo)) errors.push(`${label}: tipo inválido.`);
    const timestamp = Date.parse(event.ocorrido_em ?? ''); if (!Number.isFinite(timestamp)) errors.push(`${label}: ocorrido_em inválido.`); else if (timestamp < previous) errors.push(`${label}: eventos fora de ordem cronológica.`); previous = Math.max(previous, timestamp);
    if (typeof event.responsavel !== 'string' || !event.responsavel.trim()) errors.push(`${label}: responsável obrigatório.`);
    if (REVIEW_EVENTS.has(event.tipo) && (typeof event.motivo !== 'string' || !event.motivo.trim())) errors.push(`${label}: motivo obrigatório.`);
    if (event.hash != null && !/^[a-f0-9]{64}$/.test(event.hash)) errors.push(`${label}: hash inválido.`);
    if (event.versao != null && (typeof event.versao !== 'string' || !event.versao.trim())) errors.push(`${label}: versão inválida.`);
    const signature = JSON.stringify(event); if (seen.has(signature)) warnings.push(`${label}: evento duplicado evidente.`); else seen.add(signature);
    const prior = history[index - 1];
    if (event.tipo === 'aprovacao') { if (prior?.tipo === 'aprovacao') errors.push(`${label}: aprovações consecutivas sem transição.`); hasApproval = true; }
    if (event.tipo === 'publicacao') { if (!hasApproval) errors.push(`${label}: publicação sem aprovação anterior.`); if (prior?.tipo === 'publicacao') errors.push(`${label}: publicações consecutivas duplicadas.`); }
    if (event.tipo === 'revogacao' && !hasApproval) errors.push(`${label}: revogação sem aprovação anterior.`);
    if (event.tipo === 'invalidacao' && !hasApproval) errors.push(`${label}: invalidação sem aprovação anterior.`);
    if (prior?.tipo === 'publicacao' && !REVIEW_EVENTS.has(event.tipo) && event.tipo !== 'aprovacao') warnings.push(`${label}: publicação seguida por evento incompatível.`);
  }
  const last = history.at(-1); const publication = record.publicacao?.status; const approval = record.aprovacao_humana;
  if (publication === 'aprovado' && last?.tipo !== 'aprovacao') errors.push(`${record.id}: status aprovado exige último evento de aprovação.`);
  if (publication === 'publicado' && last?.tipo !== 'publicacao') errors.push(`${record.id}: status publicado exige último evento de publicação.`);
  if (publication === 'revisao_necessaria' && !REVIEW_EVENTS.has(last?.tipo)) errors.push(`${record.id}: revisão necessária exige rejeição, revogação ou invalidação como último evento.`);
  if (approval?.status === 'aprovado' && last?.tipo !== 'aprovacao' && publication !== 'publicado') errors.push(`${record.id}: aprovação ativa exige último evento de aprovação.`);
  if (approval?.status === 'aprovado' && last?.tipo === 'aprovacao' && approval.aprovado_por !== last.responsavel) warnings.push(`${record.id}: responsável da aprovação diverge do último evento.`);
  if (approval?.status === 'rejeitado' && last?.tipo === 'rejeicao' && approval.rejeitado_por !== last.responsavel) warnings.push(`${record.id}: responsável da rejeição diverge do último evento.`);
  if (approval?.status === 'revogado' && REVIEW_EVENTS.has(last?.tipo) && approval.revogado_por !== last.responsavel) warnings.push(`${record.id}: responsável da revogação diverge do último evento.`);
  return { errors, warnings, informational };
}