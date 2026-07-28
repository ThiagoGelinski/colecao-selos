import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const ID = 'SEL-999988';
const RECORD_KEY = `manifests/${ID}.json`;
const ASSET_KEY = `assets/selos/${ID}/${ID}-frente.webp`;
const OLD_ASSET = Buffer.from('RIFFold-WEBP');

function webp(size = 20) {
  const bytes = Buffer.alloc(Math.max(size, 12));
  bytes.write('RIFF', 0); bytes.write('WEBP', 8);
  return bytes;
}

function form({ expected = '2026-07-22', size = 20, mime = 'image/webp', name = 'novo.webp', magic = true, includeFile = true } = {}) {
  const data = new FormData(); data.append('papel', 'frente'); data.append('expected_updated_at', expected);
  if (includeFile) data.append('file', new File([magic ? webp(size) : Buffer.alloc(Math.max(size, 12))], name, { type: mime }));
  return data;
}

function scenario({ assetExists = true, recordConflict = false, recordFailure = false, assetConflict = false, rollbackConflict = false } = {}) {
  const data = {
    [RECORD_KEY]: { id: ID, slug: 'selo-existente', titulo: 'Selo existente', imagens: { frente: `/assets/selos/${ID}/${ID}-frente.webp`, card: `/assets/selos/${ID}/${ID}-card.webp`, alt: 'Selo' }, auditoria: { criado_em: '2026-07-22', ultima_revisao: '2026-07-22', versao: '1.0.0' }, publicacao: { status: 'homologacao', apto_para_preview: true, apto_para_publicacao: false }, historico_editorial: [] },
    ...(assetExists ? { [ASSET_KEY]: Buffer.from(OLD_ASSET) } : {})
  };
  const etags = { [RECORD_KEY]: 'record-1', ...(assetExists ? { [ASSET_KEY]: 'asset-1' } : {}) };
  let sequence = 1; let assetWrites = 0;
  const store = {
    get: async (key, options) => {
      if (!(key in data)) return null;
      if (options?.type === 'arrayBuffer') return Uint8Array.from(data[key]).buffer;
      return typeof data[key] === 'string' ? data[key] : Buffer.isBuffer(data[key]) ? data[key] : JSON.stringify(data[key]);
    },
    getMetadata: async (key) => key in data ? { etag: etags[key] } : null,
    getWithMetadata: async (key, options) => {
      if (!(key in data)) return null;
      let value = data[key];
      if (options?.type === 'json') value = structuredClone(value);
      if (options?.type === 'arrayBuffer') value = Uint8Array.from(value).buffer;
      return { data: value, etag: etags[key] };
    },
    setJSON: async (key, value, options) => {
      if (recordFailure) throw new Error('record unavailable');
      if (recordConflict || options?.onlyIfMatch !== etags[key]) return { modified: false };
      data[key] = structuredClone(value); etags[key] = `record-${++sequence}`;
      return { modified: true, etag: etags[key] };
    },
    set: async (key, value, options) => {
      assetWrites++;
      if ((assetConflict && assetWrites === 1) || (rollbackConflict && assetWrites === 2) || options?.onlyIfMatch !== etags[key]) return { modified: false };
      data[key] = Buffer.from(value); etags[key] = `asset-${++sequence}`;
      return { modified: true, etag: etags[key] };
    },
    list: async () => ({ blobs: Object.keys(data).map((key) => ({ key })) })
  };
  globalThis.__MOCK_NETLIFY_ENV = true; globalThis.__MOCK_BLOB_STORE = store;
  return { data, assetWrites };
}

async function callPUT(formData, options) {
  const state = scenario(options);
  const { PUT } = await import('../src/pages/api/admin/selos/[id]/assets.ts');
  const response = await PUT({ params: { id: ID }, locals: { adminUser: { username: 'admin-tester-x' } }, request: { formData: async () => formData } });
  return { response, state };
}

test('Microbloco 2A.2.6 - Retificação Controlada de Assets', async (t) => {
  t.afterEach(() => { globalThis.__MOCK_NETLIFY_ENV = false; globalThis.__MOCK_BLOB_STORE = null; });

  await t.test('1. retificação válida Serverless atualiza asset, registro e histórico oficial', async () => {
    const { response, state } = await callPUT(form()); assert.equal(response.status, 200, await response.text());
    assert.deepEqual(state.data[ASSET_KEY], webp());
    const event = state.data[RECORD_KEY].historico_editorial.at(-1);
    assert.deepEqual(Object.keys(event).sort(), ['hash','motivo','ocorrido_em','responsavel','tipo','versao']);
    assert.equal(event.responsavel, 'admin-tester-x'); assert.equal(event.tipo, 'rejeicao');
  });
  await t.test('2. expected_updated_at obsoleto retorna 409 sem escrita', async () => {
    const { response, state } = await callPUT(form({ expected: '2020-01-01' })); assert.equal(response.status, 409); assert.deepEqual(state.data[ASSET_KEY], OLD_ASSET);
  });
  await t.test('3. arquivo acima de 5 MiB retorna 413', async () => { assert.equal((await callPUT(form({ size: 5 * 1024 * 1024 + 1 }))).response.status, 413); });
  await t.test('4. MIME inválido retorna 415', async () => { assert.equal((await callPUT(form({ mime: 'image/png' }))).response.status, 415); });
  await t.test('5. extensão inválida retorna 415', async () => { assert.equal((await callPUT(form({ name: 'novo.png' }))).response.status, 415); });
  await t.test('6. magic bytes inválidos retornam 415', async () => { assert.equal((await callPUT(form({ magic: false }))).response.status, 415); });
  await t.test('7. arquivo ausente retorna 422', async () => { assert.equal((await callPUT(form({ includeFile: false }))).response.status, 422); });
  await t.test('8. asset inexistente retorna 404', async () => { assert.equal((await callPUT(form(), { assetExists: false })).response.status, 404); });
  await t.test('9. conflito do JSON retorna 409 e restaura asset anterior', async () => {
    const { response, state } = await callPUT(form(), { recordConflict: true }); assert.equal(response.status, 409); assert.deepEqual(state.data[ASSET_KEY], OLD_ASSET);
  });
  await t.test('10. conflito concorrente do asset retorna 409 sem overwrite', async () => {
    const { response, state } = await callPUT(form(), { assetConflict: true }); assert.equal(response.status, 409); assert.deepEqual(state.data[ASSET_KEY], OLD_ASSET);
  });
  await t.test('11. falha do JSON retorna 500 e restaura asset anterior', async () => {
    const { response, state } = await callPUT(form(), { recordFailure: true }); assert.equal(response.status, 500); assert.deepEqual(state.data[ASSET_KEY], OLD_ASSET);
  });
  await t.test('12. falha de rollback é fechada e nunca reporta sucesso', async () => { assert.equal((await callPUT(form(), { recordFailure: true, rollbackConflict: true })).response.status, 500); });
  await t.test('13. falhas preservam JSON sem histórico parcial', async () => {
    const { state } = await callPUT(form(), { recordFailure: true }); assert.equal(state.data[RECORD_KEY].historico_editorial.length, 0);
  });
  await t.test('14. todo caminho validado retorna Response', async () => {
    for (const payload of [form(), form({ expected: 'x' }), form({ includeFile: false }), form({ magic: false })]) assert.ok((await callPUT(payload)).response instanceof Response);
  });
  await t.test('15. substituição local usa backup e rollback em diretório temporário', async () => {
    globalThis.__MOCK_NETLIFY_ENV = false; globalThis.__MOCK_BLOB_STORE = null;
    const root = await mkdtemp(path.join(tmpdir(), 'selos-retificacao-')); const target = path.join(root, 'public/assets/selos/SEL-123456/SEL-123456-frente.webp');
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, OLD_ASSET);
    const { beginAssetReplacement } = await import('../src/lib/catalogo/io.mjs'); const transaction = await beginAssetReplacement(target, webp(), 'image/webp');
    assert.deepEqual(await readFile(target), webp()); await transaction.rollback(); assert.deepEqual(await readFile(target), OLD_ASSET); await rm(root, { recursive: true, force: true });
  });
  await t.test('16. substituição local confirmada remove backup e mantém novo asset', async () => {
    globalThis.__MOCK_NETLIFY_ENV = false; globalThis.__MOCK_BLOB_STORE = null;
    const root = await mkdtemp(path.join(tmpdir(), 'selos-retificacao-')); const target = path.join(root, 'public/assets/selos/SEL-123456/SEL-123456-frente.webp');
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, OLD_ASSET);
    const { beginAssetReplacement } = await import('../src/lib/catalogo/io.mjs'); const transaction = await beginAssetReplacement(target, webp(), 'image/webp'); await transaction.commit();
    assert.deepEqual(await readFile(target), webp()); await rm(root, { recursive: true, force: true });
  });
});