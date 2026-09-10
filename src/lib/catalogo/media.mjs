import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { getStore } from '@netlify/blobs';
import { isServerlessEngine } from './io.mjs';

export const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const HASH = /^[a-f0-9]{64}$/;
const FORMATS = { png: ['image/png'], jpeg: ['image/jpeg'], webp: ['image/webp'], tiff: ['image/tiff'] };
export const mediaHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mediaError = (message, status = 415) => Object.assign(new Error(message), { code: 'MEDIA_VALIDATION', status });
let cachedStore;
const mediaStore = () => globalThis.__MOCK_MEDIA_STORE ?? (cachedStore ??= getStore({ name: 'colecao-selos-originais', consistency: 'strong' }));
const archivePath = (key) => path.join(process.cwd(), 'data', 'originais', ...key.split('/'));

async function readArchive(key) {
  if (isServerlessEngine()) {
    const value = await mediaStore().get(key, { type: 'arrayBuffer', consistency: 'strong' });
    return value == null ? null : Buffer.from(value);
  }
  try { return await readFile(archivePath(key)); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function writeArchiveExclusive(key, bytes, metadata = {}) {
  if (isServerlessEngine()) {
    await mediaStore().set(key, bytes, { onlyIfNew: true, metadata });
  } else {
    const target = archivePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    try { await writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const persisted = await readArchive(key);
  if (!persisted || !persisted.equals(bytes)) throw new Error('Arquivo imutável ausente ou divergente; operação recusada.');
}

/** Decode the complete image and produce only a symmetric crop and a lossless WebP. @param {Buffer} original @param {{ mime?: string, crop_x?: number, crop_y?: number }} [options] */
export async function prepareMedia(original, { mime, crop_x = 0, crop_y = 0 } = {}) {
  if (!Buffer.isBuffer(original) || original.length === 0) throw mediaError('Fotografia original vazia ou inválida.');
  if (original.length > MAX_ORIGINAL_SIZE) throw mediaError('O arquivo excede o limite de 5 MiB.', 413);
  if (![crop_x, crop_y].every((value) => Number.isSafeInteger(value) && value >= 0)) throw mediaError('As margens do recorte devem ser inteiros não negativos.', 422);
  let metadata;
  try { metadata = await sharp(original, { failOn: 'warning', limitInputPixels: MAX_PIXELS }).metadata(); }
  catch { throw mediaError('A fotografia não pôde ser decodificada integralmente.'); }
  if (!FORMATS[metadata.format]?.includes(mime)) throw mediaError('Formato real e MIME devem corresponder a PNG, JPEG, WebP ou TIFF.');
  if ((metadata.pages ?? 1) !== 1) throw mediaError('Fotografias animadas ou com múltiplas páginas não são permitidas.');
  if (!['srgb', 'b-w'].includes(metadata.space) || metadata.depth !== 'uchar') throw mediaError('A fotografia exige alteração de espaço de cor ou precisão; conversão recusada.');
  const width = metadata.width - 2 * crop_x;
  const height = metadata.height - 2 * crop_y;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16383 || height > 16383) throw mediaError('Recorte vazio ou dimensões incompatíveis com WebP.', 422);
  let derived;
  try {
    let pipeline = sharp(original, { failOn: 'warning', limitInputPixels: MAX_PIXELS });
    if (crop_x || crop_y) pipeline = pipeline.extract({ left: crop_x, top: crop_y, width, height });
    // Preserve existing ICC/EXIF. Do not apply automatic orientation or a colour conversion.
    derived = await pipeline.keepMetadata().webp({ lossless: true }).toBuffer();
    // Fully decode the source as well: a crop must not hide damaged image data.
    const sourcePixels = await sharp(original, { failOn: 'warning', limitInputPixels: MAX_PIXELS }).keepMetadata().raw().toBuffer({ resolveWithObject: true });
    const outputPixels = await sharp(derived, { failOn: 'warning', limitInputPixels: MAX_PIXELS }).keepMetadata().raw().toBuffer({ resolveWithObject: true });
    const channels = sourcePixels.info.channels;
    if (channels !== outputPixels.info.channels) throw new Error('Mudança de canais.');
    for (let row = 0; row < height; row++) {
      const start = ((row + crop_y) * metadata.width + crop_x) * channels;
      if (!sourcePixels.data.subarray(start, start + width * channels).equals(outputPixels.data.subarray(row * width * channels, (row + 1) * width * channels))) throw new Error('Mudança de pixels.');
    }
    const outputMetadata = await sharp(derived).metadata();
    if ((metadata.orientation ?? 1) !== (outputMetadata.orientation ?? 1) || (metadata.icc && !metadata.icc.equals(outputMetadata.icc ?? Buffer.alloc(0)))) throw new Error('Mudança de metadados de orientação ou cor.');
  } catch { throw mediaError('A fotografia não pôde ser decodificada integralmente ou convertida para WebP.'); }
  return {
    original, derived,
    provenance: {
      version: 1,
      original_hash: mediaHash(original), derived_hash: mediaHash(derived),
      original_mime: mime, original_size: original.length, derived_size: derived.length,
      recipe: { operation: 'symmetric-crop-webp', crop_x, crop_y, source_width: metadata.width, source_height: metadata.height, width, height, lossless: true, preserve_metadata: true, auto_orient: false },
    },
  };
}

/** All archives and the server-generated receipt must exist before the mutable asset is promoted. */
export async function archivePreparedMedia(prepared) {
  const { original, derived, provenance } = prepared;
  if (mediaHash(original) !== provenance.original_hash || mediaHash(derived) !== provenance.derived_hash) throw new Error('Bytes divergentes da procedência preparada.');
  await writeArchiveExclusive(`originais/${provenance.original_hash}`, original, { 'content-type': provenance.original_mime });
  await writeArchiveExclusive(`derivados/${provenance.derived_hash}.webp`, derived, { 'content-type': 'image/webp' });
  const key = `procedencia/${provenance.derived_hash}.json`;
  const receipt = Buffer.from(JSON.stringify(provenance));
  // A previous receipt for identical derived bytes remains authoritative and immutable.
  if (isServerlessEngine()) await mediaStore().set(key, receipt, { onlyIfNew: true, metadata: { 'content-type': 'application/json' } });
  else {
    await mkdir(path.dirname(archivePath(key)), { recursive: true });
    try { await writeFile(archivePath(key), receipt, { flag: 'wx' }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const verified = await getMediaProvenance(provenance.derived_hash);
  if (!verified) throw new Error('Recibo de procedência não foi persistido.');
  return verified;
}

/** Preserve an old published/administrative derivative without labelling it an original photo. */
export async function archivePreviousDerivative(bytes) {
  const digest = mediaHash(bytes);
  await writeArchiveExclusive(`historico-derivados/${digest}`, bytes, { category: 'derivado-anterior' });
  return digest;
}
export async function getMediaProvenance(derivedSha256) {
  if (!HASH.test(derivedSha256)) throw new Error('Hash de derivado inválido.');
  const receipt = await readArchive(`procedencia/${derivedSha256}.json`);
  if (!receipt) return null;
  const proof = JSON.parse(receipt.toString('utf8'));
  if (proof.version !== 1 || proof.derived_hash !== derivedSha256 || !HASH.test(proof.original_hash) || proof.recipe?.operation !== 'symmetric-crop-webp' || proof.recipe.lossless !== true || proof.recipe.auto_orient !== false) throw new Error('Procedência inválida.');
  const original = await readArchive(`originais/${proof.original_hash}`);
  const derived = await readArchive(`derivados/${derivedSha256}.webp`);
  if (!original || !derived || mediaHash(original) !== proof.original_hash || mediaHash(derived) !== derivedSha256) throw new Error('Arquivo de procedência ausente ou corrompido.');
  return proof;
}
export async function readArchivedOriginal(originalSha256) {
  if (!HASH.test(originalSha256)) throw new Error('Hash de original inválido.');
  const bytes = await readArchive(`originais/${originalSha256}`);
  if (!bytes || mediaHash(bytes) !== originalSha256) throw new Error('Original ausente ou corrompido.');
  return bytes;
}
