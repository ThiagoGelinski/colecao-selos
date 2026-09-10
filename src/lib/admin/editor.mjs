import { jsonDigest } from '../catalogo/digest.mjs';
import { updateRecordAtomic } from '../catalogo/io.mjs';
import { dataPath } from '../catalogo/records.mjs';
import { revokeApproval, appendEditorialEvent } from '../catalogo/history.mjs';
import { validateSeloData } from '../selo-validation.mjs';
const EDITABLE = new Set(['titulo','descricao_curta','identificacao','emissao','tecnica','catalogos','exemplar','historico','fontes','seo','relacionamentos','imagens']);
export const operationError = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function merge(target, source) {
  const result = structuredClone(target ?? {});
  for (const [key,value] of Object.entries(source)) {
    if (['__proto__','prototype','constructor'].includes(key)) throw operationError('INVALID_FIELD','Campo inválido.',422);
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key],value) : structuredClone(value);
  }
  return result;
}
export function editCandidate(record, changes, user, occurredAt = new Date().toISOString()) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw operationError('INVALID_CHANGES','Informe os campos a editar.',422);
  for (const key of Object.keys(changes)) if (!EDITABLE.has(key)) throw operationError('PROTECTED_FIELD','Identidade e aprovação são controladas pelo fluxo editorial.',422);
  if (changes.imagens && Object.keys(changes.imagens).some(key => key !== 'alt')) throw operationError('PROTECTED_FIELD','Fotografias devem ser enviadas pelo formulário de imagens.',422);
  if (changes.seo?.canonical_path !== undefined && changes.seo.canonical_path !== record.seo.canonical_path) throw operationError('PROTECTED_FIELD','O endereço publicado deve ser preservado.',422);
  let candidate = merge(record,changes);
  if (jsonDigest(candidate) === jsonDigest(record)) return record;
  const reason = 'Conteúdo editado no painel; nova revisão humana necessária';
  if (record.aprovacao_humana?.status === 'aprovado') candidate = revokeApproval(candidate,{reviewer:user.username,reason,type:'invalidacao',occurredAt});
  else {
    candidate.publicacao = { ...candidate.publicacao, status:'revisao_necessaria', apto_para_publicacao:false, motivo:reason };
    appendEditorialEvent(candidate,{tipo:'rejeicao',responsavel:user.username,motivo:reason,ocorrido_em:occurredAt,versao:record.auditoria.versao});
  }
  candidate.auditoria.ultima_revisao = occurredAt.slice(0,10);
  candidate.auditoria.versao = record.auditoria.versao + '+edicao.' + Date.parse(occurredAt);
  const validation = validateSeloData(candidate);
  if (!validation.valid) throw operationError('VALIDATION_ERROR',validation.errors.map(e => e.instancePath + ': ' + e.message).join('; '),422);
  return candidate;
}
export async function editRecord(id, expectedDigest, changes, user) {
  if (!['administrador','catalogador'].includes(user?.role)) throw operationError('FORBIDDEN','Perfil sem permissão de edição.',403);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) throw operationError('DIGEST_REQUIRED','Recarregue a ficha antes de editar.',422);
  const record = await updateRecordAtomic(dataPath(id), current => {
    if (jsonDigest(current) !== expectedDigest) throw operationError('RECORD_CONFLICT','O registro mudou. Recarregue antes de editar.');
    return editCandidate(current,changes,user);
  });
  return { registro:record, record_digest:jsonDigest(record) };
}
