import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageFixture, memoryStore } from './helpers/media-fixture.mjs';
import { prepareMedia, archivePreparedMedia, archivePreviousDerivative, getMediaProvenance, readArchivedOriginal, mediaHash } from '../src/lib/catalogo/media.mjs';

const pixels = Buffer.from(Array.from({ length: 9 * 7 * 3 }, (_, index) => (index * 31) % 256));
const png = await sharp(pixels, { raw: { width: 9, height: 7, channels: 3 } }).png().toBuffer();

test('Conversão técnica de fotografias', async (t) => {
  let archive;
  t.beforeEach(() => { archive = memoryStore(); globalThis.__MOCK_NETLIFY_ENV = true; globalThis.__MOCK_MEDIA_STORE = archive.store; });
  t.after(() => { globalThis.__MOCK_NETLIFY_ENV = false; delete globalThis.__MOCK_MEDIA_STORE; });
  await t.test('recorte retira margens iguais e mantém cada pixel remanescente', async () => {
    const prepared = await prepareMedia(png, { mime: 'image/png', crop_x: 2, crop_y: 1 });
    const expected = await sharp(png).extract({ left: 2, top: 1, width: 5, height: 5 }).raw().toBuffer();
    const actual = await sharp(prepared.derived).raw().toBuffer(); assert.deepEqual(actual, expected);
    assert.deepEqual(prepared.original, png); assert.equal(prepared.provenance.recipe.lossless, true);
  });
  await t.test('PNG, JPEG, WebP e TIFF reais são aceitos sem redimensionamento', async () => {
    for (const [format, mime] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['tiff', 'image/tiff']]) {
      const input = await imageFixture(format); const result = await prepareMedia(input, { mime });
      assert.equal(result.provenance.recipe.width, 12); assert.equal(result.provenance.recipe.height, 10);
      assert.deepEqual(await sharp(input).raw().toBuffer(), await sharp(result.derived).raw().toBuffer());
    }
  });
  await t.test('preserva orientação EXIF sem girar ou alterar pixels', async () => {
    const oriented = await sharp(png).withMetadata({ orientation: 6 }).png().toBuffer();
    const result = await prepareMedia(oriented, { mime: 'image/png' });
    assert.equal((await sharp(result.derived).metadata()).orientation, 6);
    assert.equal(result.provenance.recipe.width, 9); assert.equal(result.provenance.recipe.height, 7);
    assert.deepEqual(await sharp(oriented).raw().toBuffer(), await sharp(result.derived).raw().toBuffer());
  });
  await t.test('recusa WebP animado com múltiplas páginas', async () => {
    const frames = Buffer.alloc(8 * 8 * 3); frames.fill(255, 8 * 4 * 3);
    const input = sharp(frames, { raw: { width: 8, height: 8, channels: 3, pageHeight: 4 } });
    const animated = await input.webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer();
    assert.ok((await sharp(animated, { animated: true }).metadata()).pages > 1);
    await assert.rejects(prepareMedia(animated, { mime: 'image/webp' }), /múltiplas páginas/);
  });
  await t.test('recusa CMYK e 16 bits que exigiriam transformação de cor ou precisão', async () => {
    const cmyk = await sharp(png).toColourspace('cmyk').jpeg().toBuffer();
    await assert.rejects(prepareMedia(cmyk, { mime: 'image/jpeg' }), /espaço de cor ou precisão/);
    const highDepth = await sharp(png).toColourspace('rgb16').png().toBuffer();
    assert.equal((await sharp(highDepth).metadata()).depth, 'ushort');
    await assert.rejects(prepareMedia(highDepth, { mime: 'image/png' }), /espaço de cor ou precisão/);
  });
  await t.test('recusa recorte vazio, fracionário, negativo e arquivo truncado', async () => {
    for (const crop_x of [4.5, -1, 5, NaN]) await assert.rejects(prepareMedia(png, { mime: 'image/png', crop_x }), (error) => error.status === 422);
    await assert.rejects(prepareMedia(png.subarray(0, 45), { mime: 'image/png' }), (error) => error.status === 415);
  });
  await t.test('arquivo e recibo imutáveis verificam hashes, repetição idempotente e leitura de original', async () => {
    const prepared = await prepareMedia(png, { mime: 'image/png' });
    const proof = await archivePreparedMedia(prepared); const size = archive.data.size;
    assert.deepEqual(await archivePreparedMedia(prepared), proof); assert.equal(archive.data.size, size);
    assert.deepEqual(await getMediaProvenance(proof.derived_hash), proof);
    assert.deepEqual(await readArchivedOriginal(proof.original_hash), png);
    assert.ok(archive.writes.every((write) => write.opts.onlyIfNew));
    assert.equal(await getMediaProvenance('0'.repeat(64)), null);
  });
  await t.test('recibo não aceita arquivo corrompido ou original ausente', async () => {
    const prepared = await prepareMedia(png, { mime: 'image/png' }); const proof = await archivePreparedMedia(prepared);
    archive.data.set(`derivados/${proof.derived_hash}.webp`, Buffer.from('corrupto'));
    await assert.rejects(getMediaProvenance(proof.derived_hash), /corrompido/);
    await assert.rejects(archivePreparedMedia(prepared), /divergente/);
  });
  await t.test('derivado legado é preservado sem ser anunciado como fotografia original', async () => {
    const bytes = Buffer.from('derivado legado'); const hash = await archivePreviousDerivative(bytes);
    assert.equal(hash, mediaHash(bytes)); assert.deepEqual(archive.data.get(`historico-derivados/${hash}`), bytes);
    assert.equal(archive.data.has(`originais/${hash}`), false);
  });
});
