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

test('Origin administrativo aceita mesma origem e recusa ausência ou divergência', () => {
  assert.equal(validateAdminMutationOrigin(new Request('https://example.test/api', { headers: { origin: 'https://example.test' } })), true);
  assert.equal(validateAdminMutationOrigin(new Request('https://example.test/api')), false);
  assert.equal(validateAdminMutationOrigin(new Request('https://example.test/api', { headers: { origin: 'https://evil.test' } })), false);
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

test('limite Content-Length é avaliado antes de request.formData e file.size permanece validado', async () => {
  const { contentLengthExceeds } = await import('../src/lib/admin/request-security.mjs');
  const request = new Request('https://example.test/upload', { method: 'POST', headers: { origin: 'https://example.test', 'content-length': String(6 * 1024 * 1024) } });
  assert.equal(contentLengthExceeds(request, 5 * 1024 * 1024 + 64 * 1024), true);
  const source = await readSource('src/pages/api/admin/selos/[id]/assets.ts', 'utf8');
  assert.ok(source.indexOf('contentLengthExceeds(request') < source.indexOf('request.formData()'));
  assert.match(source, /file\.size > MAX_UPLOAD_SIZE/);
});