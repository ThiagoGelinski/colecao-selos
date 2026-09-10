import sharp from 'sharp';
import { readJson, readMutableManifest, readAssetBinary, updateRecordAtomic, stageManifestBaseline } from '../catalogo/io.mjs';
import { dataPath } from '../catalogo/records.mjs';
import { ID_MANIFEST } from '../catalogo/paths.mjs';
import { validateAssetPath, ASSET_KINDS, REQUIRED_ASSETS } from '../catalogo/assets.mjs';
import { inspectManifest } from '../catalogo/manifest.mjs';
import { jsonDigest, binaryDigest } from '../catalogo/digest.mjs';
import { getMediaProvenance } from '../catalogo/media.mjs';
import { validateSeloData, recordHash } from '../selo-validation.mjs';
import { appendEditorialEvent, inspectEditorialHistory, revokeApproval } from '../catalogo/history.mjs';
import { operationError } from '../admin/editor.mjs';
import { createGithubClient } from './github.mjs';
import { createPublicationJournal } from './journal.mjs';
const jsonBytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const reviewKey = (id,hash) => `reviews/${id}/${hash}.json`;
const pullKey = (id,hash) => `pulls/${id}/${hash}.json`;
const requireRole = (user,roles) => { if (!user?.username || !roles.includes(user.role)) throw operationError('FORBIDDEN','Perfil sem permissão para esta etapa.',403); };
function assertValid(record) {
  const result = validateSeloData(record);
  const history = inspectEditorialHistory(record);
  if (!result.valid || history.errors.length) throw operationError('VALIDATION_ERROR','Registro inválido: '+[...result.errors.map(e => e.instancePath+': '+e.message),...history.errors].join('; '),422);
}
export function approvedRecord(record,user,at) {
  let candidate = structuredClone(record);
  if (candidate.aprovacao_humana?.status === 'aprovado') candidate = revokeApproval(candidate,{reviewer:user.username,reason:'Nova revisão humana do snapshot para publicação',type:'invalidacao',occurredAt:at});
  const hash = recordHash(candidate);
  candidate.auditoria.ultima_revisao = at.slice(0,10);
  candidate.aprovacao_humana = {status:'aprovado',decisao:'aprovado',aprovado_por:user.username,aprovado_em:at,hash_do_registro_aprovado:hash,versao_aprovada:candidate.auditoria.versao,escopo:'publicacao_catalogo',observacao:'Conteúdo e imagens do snapshot confirmados no painel por revisão humana.'};
  appendEditorialEvent(candidate,{tipo:'aprovacao',responsavel:user.username,hash,versao:candidate.auditoria.versao,ocorrido_em:at});
  candidate.publicacao = {status:'publicado',apto_para_preview:true,apto_para_publicacao:true,motivo:'Snapshot aprovado para inclusão no catálogo após testes e integração na main'};
  appendEditorialEvent(candidate,{tipo:'publicacao',responsavel:user.username,hash,versao:candidate.auditoria.versao,motivo:candidate.publicacao.motivo,ocorrido_em:at});
  assertValid(candidate);
  return candidate;
}
export function publicationManifest(remote,local,record) {
  for (const value of [remote,local]) if (inspectManifest(value).errors.length) throw operationError('MANIFEST_INVALID','Manifesto de IDs inválido.',422);
  const reservation = local.reserved.find(item => item.id === record.id);
  if (!reservation || reservation.status !== 'criado' || reservation.slug !== record.slug) throw operationError('RESERVATION_INVALID','A reserva do selo deve estar criada e corresponder à ficha.',422);
  const existing = remote.reserved.find(item => item.id === record.id);
  if (existing && (existing.slug !== record.slug || existing.status !== 'criado')) throw operationError('ID_COLLISION','O ID já possui outra reserva oficial.');
  if (remote.reserved.some(item => item.id !== record.id && item.slug === record.slug)) throw operationError('SLUG_COLLISION','O endereço pertence a outro selo.');
  // Preserve every official reservation. Other drafts remain private in Blobs.
  const result = structuredClone(remote);
  if (!existing) result.reserved.push(structuredClone(reservation));
  result.reserved.sort((a,b) => a.sequence-b.sequence);
  result.next_sequence = Math.max(remote.next_sequence,local.next_sequence,reservation.sequence+1);
  return result;
}
export function createPublicationService({github, journal, loadRecord, loadManifest, loadAsset, saveRecord, stageManifest, mediaProof, now = () => new Date().toISOString()}) {
  const assetsFor = async (record,base) => {
    const assets = [];
    for (const kind of ASSET_KINDS) {
      if (!record.imagens?.[kind] && !REQUIRED_ASSETS.has(kind)) continue;
      const checked = validateAssetPath(record.id,kind,record.imagens?.[kind]);
      if (!checked.valid) throw operationError('INVALID_ASSET','Caminho de fotografia inválido.',422);
      const bytes = Buffer.from(await loadAsset(checked.absolute));
      if (bytes.length > 6*1024*1024) throw operationError('INVALID_ASSET','Fotografia excede o limite de publicação.',422);
      const metadata = await sharp(bytes,{limitInputPixels:40000000}).metadata();
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1) throw operationError('INVALID_ASSET','A fotografia publicada deve ser WebP estática.',422);
      await sharp(bytes,{limitInputPixels:40000000}).stats();
      const file = 'public'+record.imagens[kind];
      const sha256 = binaryDigest(bytes);
      const official = await github.readFile(file,base);
      if (!official || binaryDigest(official) !== sha256) {
        const proof = await mediaProof(sha256);
        if (!proof || proof.derived_hash !== sha256) throw operationError('ORIGINAL_REQUIRED','Fotografia alterada sem original e receita técnica verificáveis. Envie o original pelo painel.',422);
      }
      assets.push({path:file,sha256,bytes});
    }
    return assets;
  };
  const snapshot = async id => {
    if (!/^SEL-\d{6}$/.test(id)) throw operationError('INVALID_ID','Identificador inválido.',400);
    const base_sha = await github.getMain();
    const record = await loadRecord(id); assertValid(record);
    if (record.id !== id) throw operationError('INVALID_ID','Identidade do registro inconsistente.',422);
    const localManifest = await loadManifest();
    const remoteBytes = await github.readFile('manifests/ids.json',base_sha);
    if (!remoteBytes) throw operationError('MANIFEST_INVALID','Manifesto oficial indisponível.');
    const officialRecord = await github.readFile(`src/data/selos/${id}.json`,base_sha);
    if (officialRecord && JSON.parse(officialRecord).slug !== record.slug) throw operationError('ID_COLLISION','A identidade oficial deve ser preservada.');
    const manifest = publicationManifest(JSON.parse(remoteBytes),localManifest,record);
    const assets = await assetsFor(record,base_sha);
    const record_digest = jsonDigest(record), manifest_digest = jsonDigest(localManifest);
    const summary = {id,base_sha,record_digest,manifest_digest,files:assets.map(({path,sha256}) => ({path,sha256}))};
    const snapshot_hash = jsonDigest(summary);
    return {...summary,snapshot_hash,configured:true,record,manifest,assets};
  };
  const prepare = async (id,user) => {
    requireRole(user,['administrador','catalogador','revisor','consulta']);
    const {record,manifest,assets,...summary} = await snapshot(id);
    return summary;
  };
  const filesFor = review => [
    {path:`src/data/selos/${review.id}.json`,bytes:jsonBytes(review.final_record)},
    {path:'manifests/ids.json',bytes:jsonBytes(review.manifest)},
    ...review.assets.map(asset => ({path:asset.path,bytes:Buffer.from(asset.base64,'base64')})),
  ];
  const approve = async (id,hash,confirm,user) => {
    requireRole(user,['administrador','revisor']);
    if (confirm !== true) throw operationError('HUMAN_CONFIRMATION_REQUIRED','Confirme a revisão humana do conteúdo e das fotografias.',422);
    const current = await snapshot(id);
    if (current.snapshot_hash !== hash) throw operationError('SNAPSHOT_CHANGED','Conteúdo, imagens ou main mudaram. Prepare novamente.');
    let review = await journal.get(reviewKey(id,hash));
    if (!review) {
      const approved_at = now();
      review = await journal.put(reviewKey(id,hash),{
        id,snapshot_hash:hash,base_sha:current.base_sha,record_digest:current.record_digest,manifest_digest:current.manifest_digest,
        approved_at,reviewer:user.username,final_record:approvedRecord(current.record,user,approved_at),manifest:current.manifest,
        assets:current.assets.map(({path,sha256,bytes}) => ({path,sha256,base64:bytes.toString('base64')})),
      });
    }
    let link = await journal.get(pullKey(id,hash));
    if (!link) {
      const pr = await github.createReview({...review,files:filesFor(review)});
      await github.verifyReview({pr,base_sha:review.base_sha,files:filesFor(review)});
      link = await journal.put(pullKey(id,hash),{number:pr.number,head_sha:pr.head.sha,pr_url:pr.html_url});
    }
    return status(id,user);
  };
  const status = async (id,user) => {
    requireRole(user,['administrador','catalogador','revisor','consulta']);
    const review = await journal.latest(id);
    if (!review) return {configured:true,state:'none',ci_passed:false,can_publish:false};
    const link = await journal.get(pullKey(id,review.snapshot_hash));
    if (!link) return {configured:true,state:'pending',snapshot_hash:review.snapshot_hash,ci_passed:false,can_publish:false};
    const result = await github.reviewStatus(link.number,link.head_sha);
    const baseCurrent = result.pr.merged || await github.getMain() === review.base_sha;
    return {configured:true,state:result.pr.merged?'merged':result.pr.state==='closed'?'closed':'review',...link,snapshot_hash:review.snapshot_hash,ci_passed:result.ci_passed,ci_url:result.ci_url,can_publish:!result.pr.merged && result.pr.state==='open' && !result.pr.draft && result.ci_passed && baseCurrent && user.role==='administrador',base_current:baseCurrent};
  };
  const publish = async (id,head,user) => {
    requireRole(user,['administrador']);
    const review = await journal.latest(id);
    if (!review) throw operationError('APPROVAL_REQUIRED','Aprovação humana não encontrada.');
    const link = await journal.get(pullKey(id,review.snapshot_hash));
    if (!link || head !== link.head_sha) throw operationError('REVIEW_CHANGED','A revisão mudou. Atualize o estado.');
    const checked = await github.reviewStatus(link.number,head);
    if (checked.pr.merged) return status(id,user);
    if (checked.pr.state !== 'open' || checked.pr.draft || !checked.ci_passed) throw operationError('CI_REQUIRED','A revisão precisa estar aberta e passar nos testes do GitHub.');
    if (await github.getMain() !== review.base_sha) throw operationError('BASE_CHANGED','A main avançou. Prepare e aprove novamente.');
    await github.verifyReview({pr:checked.pr,base_sha:review.base_sha,files:filesFor(review)});
    const current = await loadRecord(id);
    const digest = jsonDigest(current), finalDigest = jsonDigest(review.final_record);
    if (digest !== review.record_digest && digest !== finalDigest) throw operationError('SNAPSHOT_CHANGED','A ficha mudou após a aprovação.');
    const actualAssets = await assetsFor(current,review.base_sha);
    if (jsonDigest(actualAssets.map(({path,sha256}) => ({path,sha256}))) !== jsonDigest(review.assets.map(({path,sha256}) => ({path,sha256})))) throw operationError('SNAPSHOT_CHANGED','As fotografias mudaram após a aprovação.');
    if (jsonDigest(await loadManifest()) !== review.manifest_digest) throw operationError('SNAPSHOT_CHANGED','O manifesto mudou após a aprovação.');
    // Persist the exact approved build snapshot with CAS before advancing main.
    // A failed or uncertain Git request can be retried; newer drafts are never overwritten.
    await saveRecord(id,digest,review.final_record);
    await stageManifest(review.manifest_digest,review.manifest);
    await github.publish({head_sha:head,base_sha:review.base_sha});
    return {...await status(id,user),deployment:'Aguardando build e deploy Netlify da main'};
  };
  return {prepare,approve,status,publish};
}
export function runtimePublicationService() {
  return createPublicationService({
    github:createGithubClient(),journal:createPublicationJournal(),
    loadRecord:id => readJson(dataPath(id)),loadManifest:() => readMutableManifest(ID_MANIFEST),loadAsset:readAssetBinary,
    saveRecord:(id,expected,record) => updateRecordAtomic(dataPath(id),current => {
      if (jsonDigest(current) !== expected) throw operationError('RECORD_CONFLICT','Edição concorrente. Recarregue a ficha.');
      return record;
    }),stageManifest:stageManifestBaseline,mediaProof:getMediaProvenance,
  });
}