import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import sharp from 'sharp';
import schema from '../../../schemas/publicacao.schema.json' with { type: 'json' };
import { validateSeloData } from '../selo-validation.mjs';
import { inspectManifest } from '../catalogo/manifest.mjs';
import { inspectEditorialHistory } from '../catalogo/history.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const roles = ['frente', 'verso', 'card', 'thumb'];
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_DECODED_BYTES = 160 * 1024 * 1024;
const DEPTH_BYTES = { uchar: 1, char: 1, ushort: 2, short: 2, uint: 4, int: 4, float: 4, double: 8, complex: 8, dpcomplex: 16 };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const jsonHash = (value) => sha256(canonicalJson(value));
export function snapshotHash(packet) {
  const { approval, ...snapshot } = packet;
  return jsonHash(snapshot);
}

function allowedRelativeFile(file) {
  return typeof file === 'string' && !path.isAbsolute(file) &&
    !file.includes('\\') && !file.includes(':') && !file.includes('\0') &&
    file.split('/').every(part => part && part !== '.' && part !== '..' &&
      !['.git', '.netlify', 'node_modules', 'dist'].includes(part.toLowerCase())) &&
    !/\.(bundle|tmp|backup|log)$/i.test(file);
}

async function verifiedFile(root, descriptor) {
  if (!allowedRelativeFile(descriptor.file)) throw new Error('Caminho de arquivo não permitido: ' + descriptor.file);
  const absolute = path.resolve(root, descriptor.file);
  const relative = path.relative(root, await realpath(absolute));
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Arquivo fora do pacote.');
  // Reject symbolic links/junctions in every component, even if the final target is inside the packet.
  let current = root;
  for (const part of descriptor.file.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Link simbólico não permitido no pacote.');
  }
  const stat = await lstat(absolute);
  if (!stat.isFile()) throw new Error('Arquivo regular obrigatório.');
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Imagem excede o limite de 64 MiB: ' + descriptor.file);
  const bytes = await readFile(absolute);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Imagem excede o limite de 64 MiB: ' + descriptor.file);
  if (!bytes.length || sha256(bytes) !== descriptor.sha256) throw new Error('Hash ou conteúdo divergente: ' + descriptor.file);
  return bytes;
}

async function inspectImage(bytes, { file, width, height, webp = false }) {
  const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, autoOrient: false });
  try {
    const metadata = await decoder.metadata();
    if (webp && (metadata.format !== 'webp' || !file.endsWith('.webp'))) throw new Error('Derivado não é um contêiner WebP.');
    if ((metadata.pages ?? 1) !== 1) throw new Error('Imagem deve conter somente um frame/página.');
    const pixels = metadata.width * metadata.height;
    const decodedBytes = pixels * metadata.channels * (DEPTH_BYTES[metadata.depth] ?? Infinity);
    if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > MAX_IMAGE_PIXELS || !Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_BYTES) {
      throw new Error('Imagem excede os limites de pixels ou memória para decodificação.');
    }
    if (metadata.width !== width || metadata.height !== height) throw new Error('Dimensões da imagem divergem da receita declarada.');
    // Decode every pixel to detect corrupt payloads. No transform or file write is performed.
    await decoder.raw().timeout({ seconds: 15 }).toBuffer();
  } catch (error) {
    throw new Error('Imagem inválida ou não decodificável (' + file + '): ' + error.message);
  } finally {
    decoder.destroy();
  }
}

/**
 * Read-only preparation, never an authentication or deployment boundary.
 * Baseline is supplied from Git by the CLI, not trusted from the incoming packet.
 */
export async function preparePublication(packet, { root, baseCommit, baselineRecords, baselineManifest, now = new Date() }) {
  const errors = [];
  const warnings = [
    'Pré-validação local: a identidade do revisor e a origem das fotografias exigem comprovação no fluxo autenticado.',
    'A receita declarada não prova que os pixels resultam somente do recorte/conversão; a revisão humana continua obrigatória.',
    'Não escreve arquivos, não cria PR, não faz merge, não publica e não altera Blobs.'
  ];
  const result = { ok: false, mode: 'preparation_only', can_publish: false, snapshot_sha256: null, files: [], errors, warnings };
  if (!validate(packet)) {
    errors.push(...validate.errors.map(error => (error.instancePath || '/') + ': ' + error.message));
    return result;
  }
  result.snapshot_sha256 = snapshotHash(packet);
  if (packet.base_commit !== baseCommit) errors.push('base_commit diverge da main local verificada; atualizar o snapshot e revisar novamente.');
  if (Date.parse(packet.created_at) > now.getTime()) errors.push('Snapshot com data futura.');
  const approval = packet.approval;
  if (approval.status !== 'approved' || !approval.reviewer?.trim() || !approval.decided_at) errors.push('Aprovação humana do snapshot pendente.');
  if (approval.snapshot_sha256 !== result.snapshot_sha256) errors.push('Aprovação não corresponde ao hash do snapshot completo.');
  if (approval.decided_at && (Date.parse(approval.decided_at) < Date.parse(packet.created_at) || Date.parse(approval.decided_at) > now.getTime())) errors.push('Data de aprovação incompatível com o snapshot.');
  if (packet.ids.base_sha256 !== jsonHash(baselineManifest)) errors.push('Manifesto base divergente.');

  const baseline = new Map(baselineRecords.map(record => [record.id, record]));
  const candidates = new Map(baseline);
  const submitted = new Set();
  const planned = [];
  let packetRoot;
  try { packetRoot = await realpath(root); } catch { errors.push('Pasta do pacote inexistente.'); return result; }
  for (const entry of packet.records) {
    const { id, record } = entry;
    const label = id + ': ';
    if (submitted.has(id)) errors.push(label + 'ID duplicado no pacote.');
    submitted.add(id);
    if (record.id !== id) errors.push(label + 'ID interno divergente.');
    const originalRecord = baseline.get(id);
    if (entry.base_sha256 !== (originalRecord ? jsonHash(originalRecord) : null)) errors.push(label + 'Registro base divergente.');
    const validation = validateSeloData(record);
    errors.push(...validation.errors.map(error => label + error.instancePath + ': ' + error.message));
    errors.push(...inspectEditorialHistory(record).errors.map(error => label + error));
    if (record.publicacao?.status !== 'publicado' || record.publicacao?.apto_para_publicacao !== true) errors.push(label + 'O pacote exige o JSON final aprovado e validado pelo pipeline editorial.');
    candidates.set(id, record);
    planned.push({ path: 'src/data/selos/' + id + '.json', sha256: jsonHash(record), encoding: 'canonical-json' });
    const assets = new Map();
    for (const asset of entry.assets) {
      if (assets.has(asset.role)) errors.push(label + 'Papel de imagem duplicado.');
      assets.set(asset.role, asset);
      const canonicalPath = '/assets/selos/' + id + '/' + id + '-' + asset.role + '.webp';
      if (record.imagens?.[asset.role] !== canonicalPath) errors.push(label + 'Imagem não corresponde ao caminho canônico de ' + asset.role + '.');
      const { crop, source_width: width, source_height: height } = asset.transform;
      if (crop.left !== crop.right || crop.top !== crop.bottom || crop.left + crop.right >= width || crop.top + crop.bottom >= height) errors.push(label + 'Recorte deve ser simétrico e preservar área positiva.');
      if (asset.file === asset.original.file) errors.push(label + 'Original e derivado devem ser arquivos distintos.');
      try {
        const bytes = await verifiedFile(packetRoot, asset);
        const originalBytes = await verifiedFile(packetRoot, asset.original);
        if (!asset.file.endsWith('.webp') || bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') errors.push(label + 'Derivado não é um contêiner WebP.');
        await inspectImage(originalBytes, { file: asset.original.file, width, height });
        await inspectImage(bytes, { file: asset.file, width: width - crop.left - crop.right, height: height - crop.top - crop.bottom, webp: true });
      } catch (error) { errors.push(label + error.message); }
      planned.push({ path: 'public' + canonicalPath, sha256: asset.sha256, encoding: 'binary' });
    }
    for (const role of roles) {
      if ((record.imagens?.[role] || ['frente', 'card'].includes(role)) && !assets.has(role)) errors.push(label + 'Imagem e original obrigatórios para ' + role + '.');
    }
  }

  const manifest = packet.ids.value;
  const inspection = inspectManifest(manifest, [...candidates.values()].map(record => ({ record, path: 'src/data/selos/' + record.id + '.json' })));
  errors.push(...inspection.errors);
  if (Array.isArray(manifest.reserved)) {
    for (const reservation of baselineManifest.reserved ?? []) {
      const next = manifest.reserved.find(item => item?.id === reservation.id);
      if (canonicalJson(next) !== canonicalJson(reservation)) errors.push('Reserva existente deve ser preservada: ' + reservation.id);
    }
    if (manifest.next_sequence < baselineManifest.next_sequence) errors.push('A sequência de IDs nunca pode retroceder.');
    for (const record of candidates.values()) {
      const reservation = manifest.reserved.find(item => item?.id === record.id);
      if (reservation?.status !== 'criado' || reservation?.slug !== record.slug) errors.push(record.id + ': reserva deve corresponder ao registro criado.');
    }
    for (const reservation of manifest.reserved) {
      if (reservation?.status === 'criado' && !candidates.has(reservation.id)) errors.push(reservation.id + ': reserva criada sem registro no catálogo resultante.');
    }
  }
  const slugs = new Set();
  for (const record of candidates.values()) {
    if (slugs.has(record.slug)) errors.push('Slug duplicado no catálogo resultante: ' + record.slug);
    slugs.add(record.slug);
  }
  planned.push({ path: 'manifests/ids.json', sha256: jsonHash(manifest), encoding: 'canonical-json' });
  result.ok = errors.length === 0;
  // Never expose an executable export plan for a rejected packet.
  if (result.ok) result.files = planned;
  return result;
}
