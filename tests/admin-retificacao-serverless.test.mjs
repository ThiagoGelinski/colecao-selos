import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFixture, memoryStore } from './helpers/media-fixture.mjs';
import { jsonDigest } from '../src/lib/catalogo/digest.mjs';
import { mediaHash } from '../src/lib/catalogo/media.mjs';

const ID = 'SEL-999988';
const RECORD_KEY = `manifests/${ID}.json`;
const ASSET_KEY = `assets/selos/${ID}/${ID}-frente.webp`;
const OLD_ASSET = await imageFixture('webp', { r: 10, g: 20, b: 30 });
const ORIGINAL = await imageFixture('jpeg');
const initialRecord = () => ({ id: ID, slug: 'selo-existente', titulo: 'Selo existente', imagens: { frente: `/${ASSET_KEY}`, card: `/assets/selos/${ID}/${ID}-card.webp`, alt: 'Selo' }, auditoria: { criado_em: '2026-07-22', ultima_revisao: '2026-07-22', versao: '1.0.0' }, publicacao: { status: 'homologacao', apto_para_preview: true, apto_para_publicacao: false }, historico_editorial: [] });
function form(options = {}) {
  const data = new FormData(); data.append('papel', 'frente'); data.append('expected_digest', options.expected ?? jsonDigest(initialRecord()));
  if (options.file !== false) data.append('file', new File([options.bytes ?? ORIGINAL], options.name ?? 'foto.jpg', { type: options.mime ?? 'image/jpeg' }));
  return data;
}
const { PUT } = await import('../src/pages/api/admin/selos/[id]/assets.ts');
let catalog; let media;
async function callPUT(formData = form(), role = 'administrador') {
  return PUT({ params: { id: ID }, locals: { adminUser: { username: 'admin-tester-x', role } }, request: new Request(`http://localhost/api/admin/selos/${ID}/assets`, { method: 'PUT', headers: { origin: 'http://localhost' }, body: formData }) });
}

test('Retificação preserva original, derivado anterior e concorrência integral', async (t) => {
  t.beforeEach(() => {
    catalog = memoryStore({ [RECORD_KEY]: initialRecord(), [ASSET_KEY]: OLD_ASSET }); media = memoryStore();
    globalThis.__MOCK_NETLIFY_ENV = true; globalThis.__MOCK_BLOB_STORE = catalog.store; globalThis.__MOCK_MEDIA_STORE = media.store;
  });
  t.after(() => { globalThis.__MOCK_NETLIFY_ENV = false; delete globalThis.__MOCK_BLOB_STORE; delete globalThis.__MOCK_MEDIA_STORE; });
  await t.test('retificação válida grava histórico, mantém original exato e preserva derivado anterior separado', async () => {
    const response = await callPUT(); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(media.data.get(`originais/${mediaHash(ORIGINAL)}`), ORIGINAL);
    assert.deepEqual(media.data.get(`historico-derivados/${mediaHash(OLD_ASSET)}`), OLD_ASSET);
    assert.equal(media.data.has(`originais/${mediaHash(OLD_ASSET)}`), false);
    assert.equal(body.data.previous_derived_hash, mediaHash(OLD_ASSET));
    assert.equal(mediaHash(catalog.data.get(ASSET_KEY)), body.data.provenance.derived_hash);
    assert.equal(body.data.record_digest, jsonDigest(catalog.data.get(RECORD_KEY)));
    const event = catalog.data.get(RECORD_KEY).historico_editorial.at(-1);
    assert.equal(event.responsavel, 'admin-tester-x'); assert.equal(event.tipo, 'rejeicao');
  });
  await t.test('versão integral obsoleta recusa antes da primeira escrita', async () => {
    assert.equal((await callPUT(form({ expected: '0'.repeat(64) }))).status, 409);
    assert.equal(catalog.writes.length, 0); assert.equal(media.writes.length, 0);
  });
  await t.test('rejeita arquivo grande, MIME incorreto, conteúdo truncado e arquivo ausente', async () => {
    assert.equal((await callPUT(form({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }))).status, 413);
    assert.equal((await callPUT(form({ mime: 'image/png' }))).status, 415);
    assert.equal((await callPUT(form({ bytes: Buffer.from('RIFFxxxxWEBP') }))).status, 415);
    assert.equal((await callPUT(form({ file: false }))).status, 422);
  });
  await t.test('nome não controla caminho nem formato: prevalecem MIME e decodificação', async () => {
    assert.equal((await callPUT(form({ name: '../../foto-sem-extensao' }))).status, 200);
    assert.ok(catalog.data.has(ASSET_KEY));
  });
  await t.test('perfil não editor e asset inexistente falham fechados', async () => {
    assert.equal((await callPUT(form(), 'revisor')).status, 403);
    catalog.data.delete(ASSET_KEY); catalog.etags.delete(ASSET_KEY);
    assert.equal((await callPUT()).status, 404);
  });
  await t.test('conflito de ETag do asset não sobrescreve bytes', async () => {
    const originalSet = catalog.store.set;
    catalog.store.set = async (key, value, opts) => key === ASSET_KEY ? { modified: false } : originalSet(key, value, opts);
    assert.equal((await callPUT()).status, 409);
    assert.deepEqual(catalog.data.get(ASSET_KEY), OLD_ASSET);
  });
  await t.test('mudança do registro no mesmo dia retorna 409 e restaura derivado', async () => {
    const originalSetJSON = catalog.store.setJSON;
    catalog.store.setJSON = async (key, value, opts) => {
      catalog.data.get(key).titulo = 'Revisão concorrente'; catalog.etags.set(key, 'concorrente');
      catalog.store.setJSON = originalSetJSON; return { modified: false };
    };
    assert.equal((await callPUT()).status, 409);
    assert.deepEqual(catalog.data.get(ASSET_KEY), OLD_ASSET);
    assert.equal(catalog.data.get(RECORD_KEY).titulo, 'Revisão concorrente');
    assert.equal(catalog.data.get(RECORD_KEY).historico_editorial.length, 0);
  });
  await t.test('falha de JSON restaura derivado sem descartar arquivos imutáveis', async () => {
    catalog.store.setJSON = async () => { throw new Error('registro indisponível'); };
    assert.equal((await callPUT()).status, 500);
    assert.deepEqual(catalog.data.get(ASSET_KEY), OLD_ASSET);
    assert.deepEqual(catalog.data.get(RECORD_KEY), initialRecord());
    assert.deepEqual(media.data.get(`originais/${mediaHash(ORIGINAL)}`), ORIGINAL);
    assert.deepEqual(media.data.get(`historico-derivados/${mediaHash(OLD_ASSET)}`), OLD_ASSET);
  });
  await t.test('falha na preservação do derivado anterior impede substituição', async () => {
    const originalSet = media.store.set;
    media.store.set = async (key, value, opts) => { if (key.startsWith('historico-derivados/')) throw new Error('arquivo indisponível'); return originalSet(key, value, opts); };
    assert.equal((await callPUT()).status, 500);
    assert.deepEqual(catalog.data.get(ASSET_KEY), OLD_ASSET);
    assert.deepEqual(catalog.data.get(RECORD_KEY), initialRecord());
  });
  await t.test('conflito no rollback não reporta sucesso nem descarta o original', async () => {
    catalog.store.setJSON = async () => { throw new Error('registro indisponível'); };
    const originalSet = catalog.store.set; let writes = 0;
    catalog.store.set = async (key, value, opts) => { if (key === ASSET_KEY && ++writes === 2) return { modified: false }; return originalSet(key, value, opts); };
    assert.equal((await callPUT()).status, 500);
    assert.deepEqual(catalog.data.get(RECORD_KEY), initialRecord());
    assert.deepEqual(media.data.get(`originais/${mediaHash(ORIGINAL)}`), ORIGINAL);
  });
});
