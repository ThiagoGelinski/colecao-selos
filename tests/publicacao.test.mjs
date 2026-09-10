import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { jsonHash, preparePublication, sha256, snapshotHash } from '../src/lib/publicacao/prepare.mjs';

const baseCommit = 'd'.repeat(40);
const baselineRecords = await Promise.all((await readdir('src/data/selos')).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join('src/data/selos', name), 'utf8'))));
const baselineManifest = JSON.parse(await readFile('manifests/ids.json', 'utf8'));

// Real raster fixtures are generated in memory only; no collection photographs are read or edited.
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-publicacao-'));
  await mkdir(path.join(root, 'originais'));
  await mkdir(path.join(root, 'derivados'));
  const record = structuredClone(baselineRecords[0]);
  const assets = [];
  for (const role of ['frente', 'verso', 'card'].filter(role => record.imagens[role])) {
    const original = await sharp({ create: { width: 100, height: 120, channels: 3, background: '#789abc' } }).png().toBuffer();
    const bytes = await sharp(original).extract({ left: 2, top: 4, width: 96, height: 112 }).webp({ lossless: true }).toBuffer();
    const file = 'derivados/' + role + '.webp';
    const originalFile = 'originais/' + role + '.png';
    await writeFile(path.join(root, file), bytes);
    await writeFile(path.join(root, originalFile), original);
    assets.push({ role, file, sha256: sha256(bytes), original: { file: originalFile, sha256: sha256(original) },
      transform: { format: 'webp', source_width: 100, source_height: 120, crop: { left: 2, right: 2, top: 4, bottom: 4 },
        encoder: { name: 'fixture-only', version: '1.0', lossless: true, quality: 100 } } });
  }
  const packet = {
    schema_version: '1.0.0', repository: 'ThiagoGelinski/colecao-selos', base_commit: baseCommit,
    created_at: '2026-09-01T00:00:00Z',
    records: [{ id: record.id, base_sha256: jsonHash(record), blob_etag: 'fixture-record-etag', record, assets }],
    ids: { base_sha256: jsonHash(baselineManifest), blob_etag: 'fixture-manifest-etag', value: structuredClone(baselineManifest) },
    approval: { status: 'approved', reviewer: 'Revisor fictício do teste', decided_at: '2026-09-01T01:00:00Z', snapshot_sha256: null }
  };
  signFixture(packet);
  return { root, packet, options: { root, baseCommit, baselineRecords, baselineManifest, now: new Date('2026-09-09T00:00:00Z') } };
}
function signFixture(packet) { packet.approval.snapshot_sha256 = snapshotHash(packet); }
async function prepare(f) { return preparePublication(f.packet, f.options); }
function rejected(result, pattern) {
  assert.equal(result.ok, false);
  assert.equal(result.can_publish, false);
  assert.deepEqual(result.files, []);
  assert.match(result.errors.join('\n'), pattern);
}

test('pacote consistente retorna somente plano permitido e não escreve nos arquivos', async () => {
  const f = await fixture();
  const names = await readdir(f.root, { recursive: true });
  const before = await Promise.all(names.filter(name => /\.\w+$/.test(name)).map(async name => [name, sha256(await readFile(path.join(f.root, name)))]));
  const result = await prepare(f);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.mode, 'preparation_only');
  assert.equal(result.can_publish, false);
  assert.equal(result.files.length, 5);
  assert(result.files.every(file => /^(src\/data\/selos\/SEL-\d{6}\.json|public\/assets\/selos\/SEL-\d{6}\/SEL-\d{6}-(frente|verso|card|thumb)\.webp|manifests\/ids\.json)$/.test(file.path)));
  assert.equal(result.files.some(file => file.path.includes('originais')), false);
  assert.deepEqual(await readdir(f.root, { recursive: true }), names);
  for (const [name, hash] of before) assert.equal(sha256(await readFile(path.join(f.root, name))), hash);
});

test('aprovação ausente ou de snapshot anterior bloqueia o plano', async () => {
  const f = await fixture();
  f.packet.approval.status = 'pending';
  rejected(await prepare(f), /Aprovação humana/);
  f.packet.approval.status = 'approved';
  f.packet.records[0].blob_etag = 'outro-etag';
  rejected(await prepare(f), /hash do snapshot/);
});

test('bytes alterados na mesma URL e no mesmo arquivo invalidam a preparação', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, f.packet.records[0].assets[0].file), 'RIFF0000WEBP ALTERADO');
  rejected(await prepare(f), /Hash ou conteúdo divergente/);
});

test('original ausente ou alterado impede pacote sem inventar proveniência', async () => {
  const f = await fixture();
  f.packet.records[0].assets[0].original.file = 'originais/ausente.png';
  signFixture(f.packet);
  rejected(await prepare(f), /ENOENT/);
  f.packet.records[0].assets[0].original.file = 'originais/frente.png';
  await writeFile(path.join(f.root, 'originais/frente.png'), 'ORIGINAL ALTERADO');
  signFixture(f.packet);
  rejected(await prepare(f), /Hash ou conteúdo divergente/);
});

test('recorte assimétrico, negativo, vazio e transformação adicional são recusados', async () => {
  const f = await fixture();
  const transform = f.packet.records[0].assets[0].transform;
  transform.crop.right = 3;
  signFixture(f.packet);
  rejected(await prepare(f), /Recorte deve ser simétrico/);
  transform.crop.left = transform.crop.right = 50;
  signFixture(f.packet);
  rejected(await prepare(f), /Recorte deve ser simétrico/);
  transform.crop.left = transform.crop.right = -1;
  rejected(await prepare(f), /must be >= 0/);
  transform.crop.left = transform.crop.right = 2;
  transform.recolor = true;
  rejected(await prepare(f), /additional properties/);
});

test('recorte zero é conversão técnica sem recorte', async () => {
  const f = await fixture();
  const asset = f.packet.records[0].assets[0];
  asset.transform.crop = { left: 0, right: 0, top: 0, bottom: 0 };
  const bytes = await sharp(await readFile(path.join(f.root, asset.original.file))).webp({ lossless: true }).toBuffer();
  await writeFile(path.join(f.root, asset.file), bytes);
  asset.sha256 = sha256(bytes);
  signFixture(f.packet);
  assert.equal((await prepare(f)).ok, true);
});

test('base main avançada e conteúdo base divergente exigem nova preparação', async () => {
  const f = await fixture();
  rejected(await preparePublication(f.packet, { ...f.options, baseCommit: 'e'.repeat(40) }), /base_commit diverge/);
  f.packet.records[0].base_sha256 = '0'.repeat(64);
  signFixture(f.packet);
  rejected(await prepare(f), /Registro base divergente/);
  f.packet.ids.base_sha256 = '0'.repeat(64);
  signFixture(f.packet);
  rejected(await prepare(f), /Manifesto base divergente/);
});

test('alteração editorial após aprovação continua bloqueada pelo validador compartilhado', async () => {
  const f = await fixture();
  f.packet.records[0].record.titulo = 'Conteúdo adulterado';
  signFixture(f.packet);
  rejected(await prepare(f), /hash aprovado/);
});

test('reservas não podem ser removidas nem reutilizadas', async () => {
  const f = await fixture();
  f.packet.ids.value.reserved.pop();
  signFixture(f.packet);
  rejected(await prepare(f), /Reserva existente deve ser preservada/);
});

test('IDs, papéis duplicados e imagens referenciadas sem bytes são recusados', async () => {
  const f = await fixture();
  f.packet.records.push(structuredClone(f.packet.records[0]));
  signFixture(f.packet);
  rejected(await prepare(f), /ID duplicado/);
  f.packet.records.pop();
  const assets = f.packet.records[0].assets;
  assets[1] = structuredClone(assets[0]);
  signFixture(f.packet);
  rejected(await prepare(f), /Papel de imagem duplicado/);
  rejected(await prepare(f), /Imagem e original obrigatórios para verso/);
});

test('caminhos externos, artefatos e arquivos não WebP nunca entram no plano', async () => {
  for (const file of ['../fora.webp', 'C:/fora.webp', '.netlify/frente.webp', 'node_modules/frente.webp', 'dist/frente.webp', 'foto.bundle']) {
    const f = await fixture();
    f.packet.records[0].assets[0].file = file;
    signFixture(f.packet);
    rejected(await prepare(f), /Caminho de arquivo não permitido/);
  }
});

test('diretório ligado para fora do pacote é recusado', async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'selos-publicacao-fora-'));
  await writeFile(path.join(outside, 'frente.webp'), 'RIFF0000WEBPfrente');
  await symlink(outside, path.join(f.root, 'atalho'), process.platform === 'win32' ? 'junction' : 'dir');
  f.packet.records[0].assets[0].file = 'atalho/frente.webp';
  signFixture(f.packet);
  rejected(await prepare(f), /fora do pacote|Link simbólico/);
});

test('assinatura de contêiner errada e aprovação futura são recusadas', async () => {
  const f = await fixture();
  const asset = f.packet.records[0].assets[0];
  const bytes = Buffer.from('NAO E WEBP');
  await writeFile(path.join(f.root, asset.file), bytes);
  asset.sha256 = sha256(bytes);
  signFixture(f.packet);
  rejected(await prepare(f), /contêiner WebP/);
  f.packet.approval.decided_at = '2099-01-01T00:00:00Z';
  rejected(await prepare(f), /Data de aprovação/);
});

test('cabeçalho RIFF/WEBP sem imagem decodificável é recusado mesmo com hash correto', async () => {
  const f = await fixture();
  const asset = f.packet.records[0].assets[0];
  const bytes = Buffer.from('RIFF0000WEBPsem-pixels');
  await writeFile(path.join(f.root, asset.file), bytes);
  asset.sha256 = sha256(bytes);
  signFixture(f.packet);
  rejected(await prepare(f), /não decodificável/);
});

test('original corrompido é recusado mesmo com hash correto', async () => {
  const f = await fixture();
  const original = f.packet.records[0].assets[0].original;
  const bytes = Buffer.from('ORIGINAL SEM IMAGEM');
  await writeFile(path.join(f.root, original.file), bytes);
  original.sha256 = sha256(bytes);
  signFixture(f.packet);
  rejected(await prepare(f), /não decodificável/);
});

test('dimensões reais do original e do WebP devem corresponder à receita', async () => {
  const f = await fixture();
  const asset = f.packet.records[0].assets[0];
  asset.transform.source_width = 101;
  signFixture(f.packet);
  rejected(await prepare(f), /Dimensões da imagem divergem/);
  asset.transform.source_width = 100;
  const bytes = await sharp({ create: { width: 95, height: 112, channels: 3, background: '#789abc' } }).webp().toBuffer();
  await writeFile(path.join(f.root, asset.file), bytes);
  asset.sha256 = sha256(bytes);
  signFixture(f.packet);
  rejected(await prepare(f), /Dimensões da imagem divergem/);
});

test('original e derivado com mais de um frame são recusados', async () => {
  for (const target of ['original', 'derivado']) {
    const f = await fixture();
    const asset = f.packet.records[0].assets[0];
    const width = target === 'original' ? 100 : 96;
    const pageHeight = target === 'original' ? 120 : 112;
    const pixels = Buffer.alloc(width * pageHeight * 2 * 3);
    pixels.fill(255, pixels.length / 2);
    const bytes = await sharp(pixels, { raw: { width, height: pageHeight * 2, pageHeight, channels: 3 } }).webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer();
    assert.equal((await sharp(bytes).metadata()).pages, 2);
    const descriptor = target === 'original' ? asset.original : asset;
    await writeFile(path.join(f.root, descriptor.file), bytes);
    descriptor.sha256 = sha256(bytes);
    signFixture(f.packet);
    rejected(await prepare(f), /somente um frame/);
  }
});

test('limites de sequência são aplicados antes da inspeção do manifesto', async () => {
  for (const target of ['next_sequence', 'sequence']) {
    const f = await fixture();
    if (target === 'next_sequence') f.packet.ids.value.next_sequence = 1e20;
    else f.packet.ids.value.reserved[0].sequence = 1e20;
    signFixture(f.packet);
    // A separate worker lets the timeout stop even a synchronous regression in the manifest loop.
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker("const { parentPort, workerData } = require('node:worker_threads'); import(workerData.module).then(async ({ preparePublication }) => { const started = performance.now(); const result = await preparePublication(workerData.packet, workerData.options); parentPort.postMessage({ result, elapsed: performance.now() - started }); });", {
        eval: true, workerData: { packet: f.packet, options: f.options, module: new URL('../src/lib/publicacao/prepare.mjs', import.meta.url).href }
      });
      const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Worker de validação não encerrou em 10 segundos.')); }, 10000);
      worker.once('message', value => { clearTimeout(timeout); void worker.terminate(); resolve(value); });
      worker.once('error', error => { clearTimeout(timeout); void worker.terminate(); reject(error); });
    });
    assert(result.elapsed < 1000, 'A rejeição no schema deve ocorrer antes de inspeções ou leitura de imagens.');
    rejected(result.result, target === 'next_sequence' ? /must be <= 1000000/ : /must be <= 999999/);
  }
});

test('imagem com metadados válidos e pixels corrompidos falha na decodificação completa', async () => {
  const f = await fixture();
  const original = f.packet.records[0].assets[0].original;
  const bytes = await readFile(path.join(f.root, original.file));
  const idat = bytes.indexOf(Buffer.from('IDAT'));
  assert(idat > 0);
  bytes[idat + 4] ^= 0xff;
  assert.equal((await sharp(bytes).metadata()).width, 100);
  await writeFile(path.join(f.root, original.file), bytes);
  original.sha256 = sha256(bytes);
  signFixture(f.packet);
  rejected(await prepare(f), /não decodificável/);
});
