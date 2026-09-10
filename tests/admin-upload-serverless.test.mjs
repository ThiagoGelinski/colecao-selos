import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { imageFixture, memoryStore } from './helpers/media-fixture.mjs';
import { jsonDigest } from '../src/lib/catalogo/digest.mjs';

const ID = 'SEL-999999';
const ORIGINAL_CWD = process.cwd();
const ROOT = await mkdtemp(path.join(tmpdir(), 'selos-upload-'));
const ORIGINAL = await imageFixture('png');
const RECORD_KEY = `manifests/${ID}.json`;
const ASSET_KEY = `assets/selos/${ID}/${ID}-frente.webp`;
const initialRecord = () => ({ id: ID, slug: 'registro-de-teste', imagens: {}, historico_editorial: [], auditoria: { ultima_revisao: '2026-09-10', versao: '1.0.0' } });
const makeForm = (options = {}) => {
  const form = new FormData(); form.set('papel', options.papel ?? 'frente');
  if (options.file !== false) form.set('file', new File([options.bytes ?? ORIGINAL], options.name ?? 'foto.png', { type: options.mime ?? 'image/png' }));
  form.set('expected_digest', options.expected ?? jsonDigest(initialRecord()));
  if (options.crop_x !== undefined) form.set('crop_x', options.crop_x);
  if (options.crop_y !== undefined) form.set('crop_y', options.crop_y);
  return form;
};

process.chdir(ROOT);
// Import runtime-dependent modules only after the isolated fixture directory is active.
const { mediaHash } = await import('../src/lib/catalogo/media.mjs');
const { POST } = await import('../src/pages/api/admin/selos/[id]/assets.ts');
const { writeJsonExclusive, readJson } = await import('../src/lib/catalogo/io.mjs');
async function call(form, { id = ID, role = 'administrador', authenticated = true, origin = 'http://localhost' } = {}) {
  return POST({ params: { id }, locals: authenticated ? { adminUser: { username: 'admin', role } } : {}, request: new Request(`http://localhost/api/admin/selos/${id}/assets`, { method: 'POST', headers: { origin }, body: form }) });
}

test('Upload preserva fotografia original e promove apenas derivado rastreável', async (t) => {
  t.after(async () => { process.chdir(ORIGINAL_CWD); await rm(ROOT, { recursive: true, force: true }); globalThis.__MOCK_NETLIFY_ENV = false; delete globalThis.__MOCK_MEDIA_STORE; delete globalThis.__MOCK_BLOB_STORE; });
  let catalog; let media;
  t.beforeEach(() => {
    catalog = memoryStore({ [RECORD_KEY]: initialRecord() }); media = memoryStore();
    globalThis.__MOCK_NETLIFY_ENV = true; globalThis.__MOCK_BLOB_STORE = catalog.store; globalThis.__MOCK_MEDIA_STORE = media.store;
  });
  await t.test('exige sessão, perfil de edição, mesma origem e ID válido', async () => {
    assert.equal((await call(makeForm(), { authenticated: false })).status, 401);
    assert.equal((await call(makeForm(), { role: 'revisor' })).status, 403);
    assert.equal((await call(makeForm(), { origin: 'https://outro.example' })).status, 403);
    assert.equal((await call(makeForm(), { id: 'invalid' })).status, 400);
    assert.equal(media.writes.length, 0);
  });
  await t.test('recusa selo ausente, papel inválido e arquivo ausente', async () => {
    assert.equal((await call(makeForm(), { id: 'SEL-111111' })).status, 404);
    assert.equal((await call(makeForm({ papel: 'capa' }))).status, 422);
    assert.equal((await call(makeForm({ file: false }))).status, 422);
  });
  await t.test('verifica decodificação completa, MIME real e limite de 5 MiB', async () => {
    assert.equal((await call(makeForm({ bytes: Buffer.from('RIFFxxxxWEBP') }))).status, 415);
    assert.equal((await call(makeForm({ mime: 'image/jpeg' }))).status, 415);
    assert.equal((await call(makeForm({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }))).status, 413);
    assert.equal(media.writes.length, 0);
  });
  await t.test('recusa recorte inválido e versão integral obsoleta', async () => {
    for (const crop_x of ['-1', '1.5', '6', 'NaN']) assert.equal((await call(makeForm({ crop_x }))).status, 422);
    assert.equal((await call(makeForm({ expected: '0'.repeat(64) }))).status, 409);
    assert.equal(media.writes.length, 0);
  });
  await t.test('Blobs arquiva original exato, derivado e recibo antes do primeiro upload', async () => {
    const result = await call(makeForm({ crop_x: '1', crop_y: '2' }), { role: 'catalogador' });
    const body = await result.json(); assert.equal(result.status, 200, JSON.stringify(body));
    const asset = catalog.data.get(ASSET_KEY); const proof = body.data.provenance;
    assert.deepEqual(media.data.get(`originais/${mediaHash(ORIGINAL)}`), ORIGINAL);
    assert.deepEqual(media.data.get(`derivados/${proof.derived_hash}.webp`), asset);
    assert.ok(media.data.has(`procedencia/${proof.derived_hash}.json`));
    assert.equal(proof.derived_hash, mediaHash(asset));
    const decoded = await sharp(asset).metadata(); assert.equal(decoded.width, 10); assert.equal(decoded.height, 6);
    assert.equal(catalog.data.get(RECORD_KEY).imagens.frente, `/${ASSET_KEY}`);
    assert.equal(body.data.record_digest, jsonDigest(catalog.data.get(RECORD_KEY)));
    assert.ok(media.writes.every((write) => write.opts.onlyIfNew));
    await assert.rejects(readFile(path.join(ROOT, 'public', ASSET_KEY)), { code: 'ENOENT' });
  });
  await t.test('binário existente impede sobrescrita, placeholder sem binário permite primeiro envio', async () => {
    catalog.data.get(RECORD_KEY).imagens.frente = `/${ASSET_KEY}`;
    catalog.data.set(ASSET_KEY, ORIGINAL); catalog.etags.set(ASSET_KEY, 'asset');
    const expected = jsonDigest(catalog.data.get(RECORD_KEY));
    assert.equal((await call(makeForm({ expected }))).status, 409);
    catalog.data.delete(ASSET_KEY); catalog.etags.delete(ASSET_KEY);
    assert.equal((await call(makeForm({ expected }))).status, 200);
  });
  await t.test('falha ao preservar original impede qualquer promoção', async () => {
    media.store.set = async () => { throw new Error('arquivo indisponível'); };
    assert.equal((await call(makeForm())).status, 500);
    assert.equal(catalog.data.has(ASSET_KEY), false);
    assert.deepEqual(catalog.data.get(RECORD_KEY), initialRecord());
  });
  await t.test('falha do JSON reverte somente derivado mutável e mantém original arquivado', async () => {
    catalog.store.setJSON = async () => { throw new Error('gravação falhou'); };
    assert.equal((await call(makeForm())).status, 500);
    assert.equal(catalog.data.has(ASSET_KEY), false);
    assert.deepEqual(catalog.data.get(RECORD_KEY), initialRecord());
    assert.deepEqual(media.data.get(`originais/${mediaHash(ORIGINAL)}`), ORIGINAL);
  });
  await t.test('mudança concorrente no mesmo dia rejeita digest dentro do modificador', async () => {
    const setJSON = catalog.store.setJSON;
    catalog.store.setJSON = async (key, value, opts) => {
      if (key === RECORD_KEY) { catalog.data.get(key).titulo = 'alterado'; catalog.etags.set(key, 'concurrent'); catalog.store.setJSON = setJSON; return { modified: false }; }
      return setJSON(key, value, opts);
    };
    assert.equal((await call(makeForm())).status, 409);
    assert.equal(catalog.data.get(RECORD_KEY).titulo, 'alterado');
    assert.equal(catalog.data.has(ASSET_KEY), false);
  });
  await t.test('modo local mantém fotografia exata em data/originais e derivado em public', async () => {
    globalThis.__MOCK_NETLIFY_ENV = false;
    const recordPath = path.join(ROOT, 'src/data/selos', `${ID}.json`);
    await writeJsonExclusive(recordPath, initialRecord());
    const response = await call(makeForm()); const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(await readFile(path.join(ROOT, 'data/originais/originais', mediaHash(ORIGINAL))), ORIGINAL);
    const bytes = await readFile(path.join(ROOT, 'public', ASSET_KEY)); assert.equal(mediaHash(bytes), payload.data.provenance.derived_hash);
    assert.equal((await readJson(recordPath)).imagens.frente, `/${ASSET_KEY}`);
    assert.equal(media.writes.length, 0);
  });
});
