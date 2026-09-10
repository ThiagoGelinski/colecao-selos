import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readFile as readSource } from 'node:fs/promises';
import { validateAdminMutationOrigin } from '../src/lib/admin/request-security.mjs';

function memoryStore() {
  const data = new Map(); const metadata = new Map(); let version = 0;
  const next = () => `etag-${++version}`;
  return {
    data, metadata,
    async get(key, options) { const value = data.get(key); if (value === undefined) return null; if (options?.type === 'arrayBuffer') return Uint8Array.from(Buffer.from(value)).buffer; return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value : JSON.stringify(value); },
    async getWithMetadata(key, options) { if (!data.has(key)) return null; let value = data.get(key); if (options?.type === 'json') value = typeof value === 'string' ? JSON.parse(value) : structuredClone(value); return { data: value, etag: metadata.get(key)?.etag, metadata: metadata.get(key)?.metadata ?? {} }; },
    async getMetadata(key) { return metadata.get(key) ?? null; },
    async setJSON(key, value, options = {}) { if (options.onlyIfNew && data.has(key)) return { modified: false }; if (options.onlyIfMatch && metadata.get(key)?.etag !== options.onlyIfMatch) return { modified: false }; const etag = next(); data.set(key, structuredClone(value)); metadata.set(key, { etag, metadata: options.metadata ?? {} }); return { modified: true, etag }; },
    async set(key, value, options = {}) { if (options.onlyIfNew && data.has(key)) return { modified: false }; if (options.onlyIfMatch && metadata.get(key)?.etag !== options.onlyIfMatch) return { modified: false }; const etag = next(); data.set(key, Buffer.from(value)); metadata.set(key, { etag, metadata: options.metadata ?? {} }); return { modified: true, etag }; },
    async delete(key) { data.delete(key); metadata.delete(key); },
    async list() { return { blobs: [...data.keys()].map((key) => ({ key })) }; }
  };
}

const originalServerless = globalThis.__MOCK_NETLIFY_ENV;
const originalStore = globalThis.__MOCK_BLOB_STORE;
test.afterEach(() => { globalThis.__MOCK_NETLIFY_ENV = originalServerless; globalThis.__MOCK_BLOB_STORE = originalStore; });

test('Origin administrativo aceita origem direta e proxy Netlify sem aceitar origem arbitrária', () => {
  assert.equal(validateAdminMutationOrigin(new Request('https://example.test/api', { headers: { origin: 'https://example.test' } })), true);
  assert.equal(validateAdminMutationOrigin(new Request('http://internal:4321/api', { headers: { origin: 'https://deploy-preview-3--colecao.netlify.app', 'x-forwarded-host': 'deploy-preview-3--colecao.netlify.app', 'x-forwarded-proto': 'https' } })), true);
  assert.equal(validateAdminMutationOrigin(new Request('http://internal:4321/api', { headers: { origin: 'https://evil.test', 'x-forwarded-host': 'deploy-preview-3--colecao.netlify.app', 'x-forwarded-proto': 'https' } })), false);
  assert.equal(validateAdminMutationOrigin(new Request('http://internal:4321/api', { headers: { origin: 'https://evil.test', 'x-forwarded-host': 'evil.test,deploy-preview-3--colecao.netlify.app', 'x-forwarded-proto': 'https' } })), false);
  assert.equal(validateAdminMutationOrigin(new Request('https://example.test/api')), false);
});

test('todas as mutações administrativas usam o helper central de Origin', async () => {
  const files = ['src/pages/api/admin/selos/index.ts', 'src/pages/api/admin/selos/[id]/assets.ts', 'src/pages/api/admin/auth/login.ts', 'src/pages/api/admin/auth/logout.ts', 'src/pages/api/admin/auth/first-access.ts', 'src/pages/api/admin/auth/change-password.ts'];
  for (const file of files) assert.match(await readSource(file, 'utf8'), /validateAdminMutationOrigin\(request\)/, file);
});

test('criação exclusiva local produz um vencedor e rollback remove somente seu asset', async () => {
  globalThis.__MOCK_NETLIFY_ENV = false;
  const root = await mkdtemp(path.join(tmpdir(), 'asset-exclusive-')); const target = path.join(root, 'public/assets/selos/SEL-900001/SEL-900001-frente.webp');
  const { beginAssetCreation } = await import('../src/lib/catalogo/io.mjs');
  try {
    const settled = await Promise.allSettled([beginAssetCreation(target, Buffer.from('primeiro')), beginAssetCreation(target, Buffer.from('segundo'))]);
    assert.equal(settled.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(settled.filter((entry) => entry.status === 'rejected' && entry.reason.code === 'ASSET_CONFLICT').length, 1);
    const winner = settled.find((entry) => entry.status === 'fulfilled').value; await winner.rollback();
    await assert.rejects(readFile(target), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('asset preexistente nunca é removido por tentativa exclusiva ou rollback alheio', async () => {
  globalThis.__MOCK_NETLIFY_ENV = false;
  const root = await mkdtemp(path.join(tmpdir(), 'asset-existing-')); const target = path.join(root, 'public/assets/selos/SEL-900002/SEL-900002-card.webp');
  const { beginAssetCreation } = await import('../src/lib/catalogo/io.mjs');
  try { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'original'); await assert.rejects(beginAssetCreation(target, Buffer.from('novo')), (error) => error.code === 'ASSET_CONFLICT'); assert.equal(await readFile(target, 'utf8'), 'original'); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('registro baseline-only é materializado e depois atualizado por CAS', async () => {
  globalThis.__MOCK_NETLIFY_ENV = true; const store = memoryStore(); globalThis.__MOCK_BLOB_STORE = store;
  const root = await mkdtemp(path.join(tmpdir(), 'baseline-materialize-')); const target = path.join(root, 'src/data/selos/SEL-900003.json');
  const baseline = { id: 'SEL-900003', slug: 'baseline', imagens: {}, auditoria: { ultima_revisao: '2026-07-28' } };
  const { updateRecordAtomic, updateRecordExpected, readJson } = await import('../src/lib/catalogo/io.mjs');
  try {
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(baseline));
    await updateRecordAtomic(target, (draft) => ({ ...draft, imagens: { frente: '/assets/selos/SEL-900003/SEL-900003-frente.webp' } }));
    assert.ok(store.data.has('manifests/SEL-900003.json')); assert.equal((await readJson(target)).imagens.frente.includes('frente.webp'), true);
    await updateRecordExpected(target, '2026-07-28', (draft) => ({ ...draft, titulo: 'Retificado' }));
    assert.equal((await readJson(target)).titulo, 'Retificado');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('materialização concorrente converge e divergência de baseline falha fechado', async () => {
  globalThis.__MOCK_NETLIFY_ENV = true; const store = memoryStore(); globalThis.__MOCK_BLOB_STORE = store;
  const root = await mkdtemp(path.join(tmpdir(), 'baseline-race-')); const target = path.join(root, 'src/data/selos/SEL-900004.json');
  const baseline = { id: 'SEL-900004', slug: 'race', contador: 0, auditoria: { ultima_revisao: '2026-07-28' } };
  const { updateRecordAtomic, readJson } = await import('../src/lib/catalogo/io.mjs');
  try {
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(baseline));
    await Promise.all([updateRecordAtomic(target, (draft) => ({ ...draft, contador: draft.contador + 1 })), updateRecordAtomic(target, (draft) => ({ ...draft, contador: draft.contador + 1 }))]);
    assert.equal((await readJson(target)).contador, 2);
    await writeFile(target, JSON.stringify({ ...baseline, slug: 'baseline-alterado' }));
    await assert.rejects(readJson(target), /baseline alterado/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validação operacional reconhece assets existentes somente no Blob', async () => {
  globalThis.__MOCK_NETLIFY_ENV = true; const store = memoryStore(); globalThis.__MOCK_BLOB_STORE = store;
  await store.set('assets/selos/SEL-900005/SEL-900005-frente.webp', Buffer.from('frente'), { onlyIfNew: true });
  await store.set('assets/selos/SEL-900005/SEL-900005-card.webp', Buffer.from('card'), { onlyIfNew: true });
  const { validateAssets } = await import('../src/lib/catalogo/assets.mjs');
  const record = { id: 'SEL-900005', imagens: { frente: '/assets/selos/SEL-900005/SEL-900005-frente.webp', card: '/assets/selos/SEL-900005/SEL-900005-card.webp' } };
  assert.deepEqual((await validateAssets(record)).map((item) => item.exists), [true, true]);
  store.data.delete('assets/selos/SEL-900005/SEL-900005-card.webp'); store.metadata.delete('assets/selos/SEL-900005/SEL-900005-card.webp');
  assert.equal((await validateAssets(record)).find((item) => item.kind === 'card').exists, false);
});

test('upload rejeita limite multipart antes do parse e arquivo excessivo antes da conversão', async () => {
  globalThis.__MOCK_NETLIFY_ENV = false;
  const { POST } = await import('../src/pages/api/admin/selos/[id]/assets.ts');
  const { MAX_ORIGINAL_SIZE } = await import('../src/lib/catalogo/media.mjs');
  assert.equal(MAX_ORIGINAL_SIZE, 5 * 1024 * 1024);
  const context = request => ({ params: { id: 'SEL-000001' }, locals: { adminUser: { username: 'teste-limites', role: 'administrador' } }, request });
  let parsed = false;
  const tooLarge = await POST(context({
    url: 'https://example.test/api/admin/selos/SEL-000001/assets',
    headers: new Headers({ origin: 'https://example.test', 'content-length': String(MAX_ORIGINAL_SIZE + 64 * 1024 + 1) }),
    formData: async () => { parsed = true; throw Error('Multipart não deveria ser lido'); },
  }));
  assert.equal(tooLarge.status, 413);
  assert.equal(parsed, false, 'Tamanho declarado deve ser bloqueado antes de carregar multipart');
  const form = new FormData();
  form.set('papel', 'frente');
  form.set('file', new File([Buffer.alloc(MAX_ORIGINAL_SIZE + 1)], 'excessivo.png', { type: 'image/png' }));
  const oversizedFile = await POST(context({
    url: 'https://example.test/api/admin/selos/SEL-000001/assets',
    headers: new Headers({ origin: 'https://example.test' }),
    formData: async () => form,
  }));
  assert.equal(oversizedFile.status, 413, 'Arquivo excessivo deve ser rejeitado antes da decodificação, mesmo sem Content-Length');
});
test('assets baseline continuam disponíveis no modo serverless dual-source', async () => {
  globalThis.__MOCK_NETLIFY_ENV = true; const store = memoryStore(); globalThis.__MOCK_BLOB_STORE = store;
  const root = await mkdtemp(path.join(tmpdir(), 'asset-baseline-')); const target = path.join(root, 'public/assets/selos/SEL-900006/SEL-900006-frente.webp');
  const bytes = Buffer.from('RIFFbaselineWEBP');
  const { existsAssetBinary, readAssetBinary } = await import('../src/lib/catalogo/io.mjs');
  try { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); assert.equal(await existsAssetBinary(target), true); assert.deepEqual(await readAssetBinary(target), bytes); assert.equal(store.data.size, 0); }
  finally { await rm(root, { recursive: true, force: true }); }
});
