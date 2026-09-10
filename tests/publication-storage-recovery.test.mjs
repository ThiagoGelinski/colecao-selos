import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, readAssetBinary, readPublishedAssetBinary, beginAssetReplacement, stageManifestBaseline } from '../src/lib/catalogo/io.mjs';
import { serveCatalogAsset } from '../src/lib/catalogo/asset-serving.mjs';
import { jsonDigest } from '../src/lib/catalogo/digest.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const baselineDigest = value => digest(JSON.stringify(value));
const id = 'SEL-999811';
const recordKey = 'manifests/' + id + '.json';
const assetKey = 'assets/selos/' + id + '/' + id + '-frente.webp';
function memoryStore(initial = {}) {
  const entries = new Map(Object.entries(initial));
  const writes = [];
  let version = 1;
  const store = {
    entries, writes,
    async get(key, options = {}) {
      const entry = entries.get(key);
      if (!entry) return null;
      return options.type === 'arrayBuffer' ? Uint8Array.from(entry.data).buffer : JSON.stringify(entry.data);
    },
    async getMetadata(key) { const entry = entries.get(key); return entry ? { etag: entry.etag, metadata: structuredClone(entry.metadata ?? {}) } : null; },
    async getWithMetadata(key, options = {}) {
      const entry = entries.get(key);
      return entry ? { data: options.type === 'arrayBuffer' ? Uint8Array.from(entry.data).buffer : structuredClone(entry.data), etag: entry.etag, metadata: structuredClone(entry.metadata ?? {}) } : null;
    },
    async set(key, data, options = {}) {
      writes.push({ key, options });
      const previous = entries.get(key);
      if (options.onlyIfNew && previous || options.onlyIfMatch && options.onlyIfMatch !== previous?.etag) return { modified: false };
      const etag = 'etag-' + ++version;
      entries.set(key, { data: Buffer.from(data), etag, metadata: options.metadata ?? {} });
      return { modified: true, etag };
    },
    async setJSON(key, data, options = {}) {
      writes.push({ key, options });
      const previous = entries.get(key);
      if (options.onlyIfNew && previous || options.onlyIfMatch && options.onlyIfMatch !== previous?.etag) return { modified: false };
      const etag = 'etag-' + ++version;
      entries.set(key, { data: structuredClone(data), etag, metadata: options.metadata ?? {} });
      return { modified: true, etag };
    },
  };
  globalThis.__MOCK_NETLIFY_ENV = true;
  globalThis.__MOCK_BLOB_STORE = store;
  return store;
}

test('Recuperação da publicação preserva baseline, rascunhos e fotografias', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-publishing-storage-'));
  const target = path.join(root, 'src/data/selos', id + '.json');
  const asset = path.join(root, 'public', assetKey);
  const previousRoot = process.env.SELO_ROOT;
  const previousLambda = process.env.LAMBDA_TASK_ROOT;
  const baseline = { id, titulo: 'Conteúdo já aprovado no Git', auditoria: { versao: '2.0' } };
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(path.dirname(asset), { recursive: true });
  await writeFile(target, JSON.stringify(baseline));
  const approvedBytes = Buffer.from('fotografia aprovada preservada');
  await writeFile(asset, approvedBytes);
  process.env.SELO_ROOT = root;
  t.afterEach(() => { globalThis.__MOCK_NETLIFY_ENV = false; globalThis.__MOCK_BLOB_STORE = null; });
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.SELO_ROOT; else process.env.SELO_ROOT = previousRoot;
    if (previousLambda === undefined) delete process.env.LAMBDA_TASK_ROOT; else process.env.LAMBDA_TASK_ROOT = previousLambda;
    await rm(root, { recursive: true, force: true });
  });

  await t.test('reconcilia apenas snapshot idêntico e preserva metadados por ETag', async () => {
    const store = memoryStore({ [recordKey]: { data: baseline, etag: 'before', metadata: { baseline_hash: 'baseline-anterior', snapshot: 'revisao-preservada' } } });
    assert.deepEqual(await readJson(target), baseline);
    assert.equal(store.writes.length, 1);
    assert.equal(store.writes[0].options.onlyIfMatch, 'before');
    assert.deepEqual(store.entries.get(recordKey).metadata, { baseline_hash: baselineDigest(baseline), snapshot: 'revisao-preservada' });
    assert.equal(await readFile(target, 'utf8'), JSON.stringify(baseline));
  });
  await t.test('baseline novo divergente nunca descarta edição pendente', async () => {
    const pending = { ...baseline, titulo: 'Edição posterior pendente' };
    const store = memoryStore({ [recordKey]: { data: pending, etag: 'pending', metadata: { baseline_hash: 'antigo' } } });
    await assert.rejects(readJson(target), { code: 'RECORD_CONFLICT' });
    assert.equal(store.writes.length, 0);
    assert.deepEqual(store.entries.get(recordKey).data, pending);
  });
  await t.test('CAS perdido para edição posterior resulta em conflito sem sobrescrever', async () => {
    const store = memoryStore({ [recordKey]: { data: baseline, etag: 'before', metadata: { baseline_hash: 'antigo' } } });
    const concurrent = { ...baseline, titulo: 'Alteração concorrente real' };
    store.setJSON = async () => { store.entries.set(recordKey, { data: concurrent, etag: 'concurrent', metadata: { baseline_hash: 'antigo' } }); return { modified: false }; };
    await assert.rejects(readJson(target), { code: 'RECORD_CONFLICT' });
    assert.deepEqual(store.entries.get(recordKey).data, concurrent);
  });
  await t.test('sem ETag não reconcilia silenciosamente', async () => {
    const store = memoryStore({ [recordKey]: { data: baseline, metadata: { baseline_hash: 'antigo' } } });
    await assert.rejects(readJson(target), { code: 'RECORD_CONFLICT' });
    assert.equal(store.writes.length, 0);
  });
  await t.test('rascunho da base atual permanece legível sem escrita', async () => {
    const draft = { ...baseline, titulo: 'Rascunho da versão corrente' };
    const store = memoryStore({ [recordKey]: { data: draft, etag: 'draft', metadata: { baseline_hash: baselineDigest(baseline) } } });
    assert.deepEqual(await readJson(target), draft);
    assert.equal(store.writes.length, 0);
  });
  await t.test('retifica asset somente FS materializando uma vez e preserva original e rollback', async () => {
    const store = memoryStore();
    const pending = Buffer.from('novo derivado pendente');
    const transaction = await beginAssetReplacement(asset, pending, 'image/webp', { expectedSha256: digest(approvedBytes) });
    assert.equal(store.writes[0].options.onlyIfNew, true);
    assert.ok(store.writes[1].options.onlyIfMatch);
    assert.deepEqual(await readFile(asset), approvedBytes);
    assert.deepEqual(await readAssetBinary(asset), pending);
    await transaction.rollback();
    assert.deepEqual(await readAssetBinary(asset), approvedBytes);
    assert.deepEqual(await readFile(asset), approvedBytes);
  });
  await t.test('corrida na materialização preserva o vencedor e bloqueia substituição', async () => {
    const store = memoryStore();
    const concurrent = Buffer.from('outro upload preservado');
    store.set = async (key) => { store.entries.set(key, { data: concurrent, etag: 'concurrent', metadata: {} }); return { modified: false }; };
    await assert.rejects(beginAssetReplacement(asset, Buffer.from('não escrever'), 'image/webp'), { code: 'ASSET_CONFLICT' });
    assert.deepEqual(store.entries.get(assetKey).data, concurrent);
    assert.deepEqual(await readFile(asset), approvedBytes);
  });
  await t.test('hash arquivado obsoleto bloqueia retificação sem sobrescrever concorrente', async () => {
    const concurrent = Buffer.from('imagem mudou depois do arquivamento');
    const store = memoryStore({ [assetKey]: { data: concurrent, etag: 'concurrent', metadata: {} } });
    await assert.rejects(beginAssetReplacement(asset, Buffer.from('não escrever'), 'image/webp', { expectedSha256: digest(approvedBytes) }), { code: 'ASSET_CONFLICT' });
    assert.equal(store.writes.length, 0);
    assert.deepEqual(store.entries.get(assetKey).data, concurrent);
  });
  await t.test('público serve exatamente foto aprovada e preview exige autenticação', async () => {
    const draft = Buffer.from('foto pendente privada');
    memoryStore({ [assetKey]: { data: draft, etag: 'draft', metadata: {} } });
    const response = await serveCatalogAsset(id, id + '-frente.webp');
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), approvedBytes);
    const { GET } = await import('../src/pages/api/admin/selos/[id]/assets/[papel].ts');
    const blocked = await GET({ params: { id, papel: 'frente' }, locals: {} });
    assert.equal(blocked.status, 401);
    const preview = await GET({ params: { id, papel: 'frente' }, locals: { adminUser: { username: 'revisor' } } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), draft);
    const traversal = await GET({ params: { id, papel: '../frente' }, locals: { adminUser: { username: 'revisor' } } });
    assert.equal(traversal.status, 404);
  });
  await t.test('leitura pública usa fallback Lambda sem consultar Blobs', async () => {
    globalThis.__MOCK_NETLIFY_ENV = true;
    globalThis.__MOCK_BLOB_STORE = { get: async () => { throw Error('Público não pode consultar Blobs'); } };
    process.env.LAMBDA_TASK_ROOT = root;
    const absentCwdPath = path.join(root, 'outro-cwd', 'public', assetKey);
    assert.deepEqual(await readPublishedAssetBinary(absentCwdPath), approvedBytes);
    delete process.env.LAMBDA_TASK_ROOT;
  });
});


test('Manifesto publicado reconcilia sem descartar reservas administrativas', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-manifest-stage-'));
  const target = path.join(root, 'manifests/ids.json');
  const key = 'manifests/ids.json';
  const baseline = {next_sequence:2,reserved:[{id:'SEL-000001',status:'criado'}]};
  const published = {next_sequence:3,reserved:[...baseline.reserved,{id:'SEL-000002',status:'criado'}]};
  const pending = {next_sequence:4,reserved:[...published.reserved,{id:'SEL-000003',status:'criado'}]};
  await mkdir(path.dirname(target), {recursive:true});
  t.afterEach(() => { globalThis.__MOCK_NETLIFY_ENV=false; globalThis.__MOCK_BLOB_STORE=null; });
  t.after(async () => { await rm(root,{recursive:true,force:true}); });
  await t.test('publicação parcial conserva todos os outros rascunhos após novo build', async () => {
    await writeFile(target,JSON.stringify(baseline));
    const store=memoryStore({[key]:{data:pending,etag:'manifest-1',metadata:{origem:'painel'}}});
    await stageManifestBaseline(jsonDigest(pending),published,{target});
    assert.deepEqual(store.entries.get(key).data,pending);
    assert.equal(store.entries.get(key).metadata.pending_baseline_hash,baselineDigest(published));
    assert.deepEqual(await readJson(target),pending,'Baseline antigo continua acessível antes do deploy');
    await writeFile(target,JSON.stringify(published));
    assert.deepEqual(await readJson(target),pending,'Novo build preserva reserva do terceiro selo ainda privado');
    assert.equal(store.entries.get(key).metadata.baseline_hash,baselineDigest(published));
    assert.equal(store.entries.get(key).metadata.pending_baseline_hash,undefined);
    assert.equal(store.entries.get(key).metadata.origem,'painel');
  });
  await t.test('mudança concorrente durante stage não é sobrescrita nem aprovada', async () => {
    await writeFile(target,JSON.stringify(baseline));
    const store=memoryStore({[key]:{data:pending,etag:'before',metadata:{}}});
    const concurrent={...pending,next_sequence:5,reserved:[...pending.reserved,{id:'SEL-000004',status:'reservado'}]};
    store.setJSON=async () => {store.entries.set(key,{data:concurrent,etag:'concurrent',metadata:{}});return {modified:false};};
    await assert.rejects(stageManifestBaseline(jsonDigest(pending),published,{target}),{code:'RECORD_CONFLICT'});
    assert.deepEqual(store.entries.get(key).data,concurrent);
    assert.equal(store.entries.get(key).metadata.pending_baseline_hash,undefined);
  });
  await t.test('edição posterior ao stage é preservada pelo CAS de reconciliação', async () => {
    await writeFile(target,JSON.stringify(baseline));
    const store=memoryStore({[key]:{data:pending,etag:'before',metadata:{}}});
    await stageManifestBaseline(jsonDigest(pending),published,{target});
    const concurrent={...pending,next_sequence:5,reserved:[...pending.reserved,{id:'SEL-000004',status:'reservado'}]};
    const set=store.setJSON;
    let conflict=true;
    store.setJSON=async (blobKey,data,options) => {
      if(conflict) {conflict=false;store.entries.set(key,{...store.entries.get(key),data:concurrent,etag:'concurrent'});return {modified:false};}
      return set(blobKey,data,options);
    };
    await writeFile(target,JSON.stringify(published));
    assert.deepEqual(await readJson(target),concurrent);
    assert.equal(store.entries.get(key).metadata.baseline_hash,baselineDigest(published));
  });
  await t.test('stage impede outra publicação pendente e admite repetir o mesmo snapshot', async () => {
    await writeFile(target,JSON.stringify(baseline));
    const store=memoryStore({[key]:{data:pending,etag:'before',metadata:{}}});
    await stageManifestBaseline(jsonDigest(pending),published,{target});
    await stageManifestBaseline(jsonDigest(pending),published,{target});
    const prior=structuredClone(store.entries.get(key));
    await assert.rejects(stageManifestBaseline(jsonDigest(pending),pending,{target}),{code:'MANIFEST_PUBLICATION_PENDING'});
    assert.deepEqual(store.entries.get(key),prior);
  });
  await t.test('publicação sem mudança de manifesto não deixa pendência artificial', async () => {
    await writeFile(target,JSON.stringify(baseline));
    const store=memoryStore({[key]:{data:pending,etag:'before',metadata:{}}});
    await stageManifestBaseline(jsonDigest(pending),baseline,{target});
    assert.equal(store.entries.get(key).metadata.pending_baseline_hash,undefined);
    assert.equal(store.entries.get(key).metadata.baseline_hash,baselineDigest(baseline));
    assert.deepEqual(store.entries.get(key).data,pending);
  });
  await t.test('hash de publicação desconhecido permanece bloqueado', async () => {
    await writeFile(target,JSON.stringify(published));
    const store=memoryStore({[key]:{data:pending,etag:'before',metadata:{baseline_hash:baselineDigest(baseline),pending_baseline_hash:'hash-nao-aprovado'}}});
    await assert.rejects(readJson(target),{code:'RECORD_CONFLICT'});
    assert.equal(store.writes.length,0);
  });
});
