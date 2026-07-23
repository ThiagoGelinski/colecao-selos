import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const TOOL = path.resolve('tools/catalogo.mjs');
const TEMPLATE_SOURCE = path.resolve('templates/selo.template.json');

async function waitForFile(target, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await access(target);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Tempo esgotado aguardando arquivo: ${target}`);
}

function reservation(sequence, overrides = {}) {
  const id = `SEL-${String(sequence).padStart(6, '0')}`;
  return {
    id, sequence, reserved_at: '2026-07-23T12:00:00.000Z', source: 'teste', status: 'criado', slug: `selo-${sequence}`,
    created_at: '2026-07-23T12:00:00.000Z', completed_at: '2026-07-23T12:00:01.000Z', failed_at: null, failure_reason: null,
    cancelado_em: null, cancellation_reason: null,
    ...overrides
  };
}

function manifest(reserved = [], nextSequence = Math.max(0, ...reserved.map((item) => item.sequence || 0)) + 1) {
  return { schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: nextSequence, reserved };
}

async function workspace({ manifestValue = manifest(), withTemplate = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-transacao-'));
  await mkdir(path.join(root, 'src', 'data', 'selos'), { recursive: true });
  await mkdir(path.join(root, 'public', 'assets', 'selos'), { recursive: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await writeFile(path.join(root, 'manifests', 'ids.json'), `${JSON.stringify(manifestValue, null, 2)}\n`);
  if (withTemplate) await writeFile(path.join(root, 'templates', 'selo.template.json'), await readFile(TEMPLATE_SOURCE, 'utf8'));
  return root;
}

function run(root, command, args = [], env = {}) {
  return spawnSync(process.execPath, [TOOL, command, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}

function runAsync(root, command, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, command, ...args], { cwd: root, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function readManifest(root) { return JSON.parse(await readFile(path.join(root, 'manifests', 'ids.json'), 'utf8')); }
async function writeLock(root, value) { await writeFile(path.join(root, 'manifests', 'ids.lock'), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }

async function writeRecord(root, id, slug, fileId = id) {
  const record = {
    schema_version: '1.0.0', id, slug, titulo: `Teste ${id}`, identificacao: { pais: 'Brasil', tipo: 'Selo postal', categoria: 'teste', tema: [], valor_facial: { valor: 1, unidade: 'centavo' } },
    emissao: { ano: 2000 }, catalogos: {}, imagens: { frente: `/assets/selos/${id}/${id}-frente.webp`, card: `/assets/selos/${id}/${id}-card.webp`, alt: 'Teste' },
    fontes: [], seo: { title: 'Teste', meta_description: 'Teste', canonical_path: `/selos/${slug}` }, publicacao: { status: 'rascunho', apto_para_preview: false, apto_para_publicacao: false }, auditoria: { criado_em: '2026-07-23', ultima_revisao: '2026-07-23', versao: '1.0.0' }
  };
  await writeFile(path.join(root, 'src', 'data', 'selos', `${fileId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const assetDir = path.join(root, 'public', 'assets', 'selos', id);
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, `${id}-frente.webp`), 'asset');
  await writeFile(path.join(assetDir, `${id}-card.webp`), 'asset');
}

test('duas reservas simultâneas geram IDs distintos', async () => {
  const root = await workspace();
  const [first, second] = await Promise.all([
    runAsync(root, 'selo:novo', ['--slug', 'primeiro-selo', '--titulo', 'Primeiro']),
    runAsync(root, 'selo:novo', ['--slug', 'segundo-selo', '--titulo', 'Segundo'])
  ]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const ids = (await readManifest(root)).reserved.map((item) => item.id);
  assert.deepEqual(new Set(ids), new Set(['SEL-000001', 'SEL-000002']));
});

test('lock impede concorrência até ser liberado', async () => {
  const root = await workspace();
  const lock = path.join(root, 'manifests', 'ids.lock');
  await writeLock(root, { pid: process.pid, timestamp: new Date().toISOString(), command: 'teste', token: 'owner' });
  const pending = runAsync(root, 'selo:novo', ['--slug', 'aguarda-lock', '--titulo', 'Aguarda'], { SELO_LOCK_TIMEOUT_MS: '1500', SELO_LOCK_RETRY_MS: '20' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await readManifest(root)).reserved.length, 0);
  await unlink(lock);
  const result = await pending;
  assert.equal(result.status, 0, result.stderr);
});

test('lock obsoleto sem processo ativo é removido com segurança', async () => {
  const root = await workspace();
  await writeLock(root, { pid: 99999999, timestamp: new Date(Date.now() - 60_000).toISOString(), command: 'antigo', token: 'stale' });
  const result = run(root, 'selo:novo', ['--slug', 'lock-obsoleto', '--titulo', 'Lock'], { SELO_LOCK_STALE_MS: '10' });
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(path.join(root, 'manifests', 'ids.lock'), 'utf8'), /ENOENT/);
});

test('timeout de lock falha sem consumir ID', async () => {
  const root = await workspace();
  await writeLock(root, { pid: process.pid, timestamp: new Date().toISOString(), command: 'ativo', token: 'active' });
  const result = run(root, 'selo:novo', ['--slug', 'timeout-lock', '--titulo', 'Timeout'], { SELO_LOCK_TIMEOUT_MS: '80', SELO_LOCK_RETRY_MS: '10' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Timeout ao adquirir lock/);
  assert.equal((await readManifest(root)).next_sequence, 1);
});

test('slug duplicado não consome ID', async () => {
  const existing = reservation(1, { slug: 'slug-existente' });
  const root = await workspace({ manifestValue: manifest([existing], 2) });
  await writeRecord(root, existing.id, existing.slug);
  const before = await readFile(path.join(root, 'manifests', 'ids.json'), 'utf8');
  const result = run(root, 'selo:novo', ['--slug', ' Slug Existente ', '--titulo', 'Duplicado']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Slug duplicado/);
  assert.equal(await readFile(path.join(root, 'manifests', 'ids.json'), 'utf8'), before);
});

test('manifesto inválido bloqueia reserva', async () => {
  const root = await workspace({ manifestValue: { prefix: 'BAD', digits: 5, next_sequence: 0, reserved: [] } });
  const result = run(root, 'selo:novo', ['--slug', 'manifesto-invalido', '--titulo', 'Inválido']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Manifesto inválido/);
});

test('ID duplicado no manifesto aparece na auditoria', async () => {
  const root = await workspace({ manifestValue: manifest([reservation(1), reservation(1, { slug: 'outro' })], 2) });
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ID duplicado/);
});

test('next_sequence incoerente aparece na auditoria', async () => {
  const root = await workspace({ manifestValue: manifest([reservation(2)], 2) });
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /next_sequence.*maior/);
});

test('criação bem-sucedida marca status criado', async () => {
  const root = await workspace();
  const result = run(root, 'selo:novo', ['--slug', 'criacao-ok', '--titulo', 'Criação OK']);
  assert.equal(result.status, 0, result.stderr);
  const item = (await readManifest(root)).reserved[0];
  assert.equal(item.status, 'criado');
  assert.ok(item.created_at);
  assert.ok(item.completed_at);
});

test('falha após reserva marca falha_na_criacao', async () => {
  const root = await workspace({ withTemplate: false });
  const result = run(root, 'selo:novo', ['--slug', 'falha-reservada', '--titulo', 'Falha']);
  assert.notEqual(result.status, 0);
  const item = (await readManifest(root)).reserved[0];
  assert.equal(item.status, 'falha_na_criacao');
  assert.ok(item.failed_at);
  assert.match(item.failure_reason, /selo\.template\.json|ENOENT/);
});

test('ID de falha nunca é reutilizado', async () => {
  const root = await workspace({ withTemplate: false });
  assert.notEqual(run(root, 'selo:novo', ['--slug', 'primeira-falha', '--titulo', 'Falha']).status, 0);
  await writeFile(path.join(root, 'templates', 'selo.template.json'), await readFile(TEMPLATE_SOURCE, 'utf8'));
  const result = run(root, 'selo:novo', ['--slug', 'depois-da-falha', '--titulo', 'Depois']);
  assert.equal(result.status, 0, result.stderr);
  const data = await readManifest(root);
  assert.equal(data.reserved[0].id, 'SEL-000001');
  assert.equal(data.reserved[0].status, 'falha_na_criacao');
  assert.equal(data.reserved[1].id, 'SEL-000002');
});

test('arquivo existente bloqueia sobrescrita e permanece intacto', async () => {
  const root = await workspace();
  const target = path.join(root, 'src', 'data', 'selos', 'SEL-000001.json');
  await writeFile(target, '{"evidencia":true}\n');
  const before = await readFile(target, 'utf8');
  const result = run(root, 'selo:novo', ['--slug', 'nao-sobrescrever', '--titulo', 'Bloqueado']);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(target, 'utf8'), before);
});

test('pasta existente bloqueia sobrescrita indevida sem consumir ID', async () => {
  const root = await workspace();
  await mkdir(path.join(root, 'public', 'assets', 'selos', 'SEL-000001'));
  const result = run(root, 'selo:novo', ['--slug', 'pasta-existente', '--titulo', 'Bloqueado']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pasta de assets já existe/);
  assert.equal((await readManifest(root)).next_sequence, 1);
});

test('resolveRecord bloqueia slug ambíguo', async () => {
  const root = await workspace({ manifestValue: manifest([reservation(1, { slug: 'ambiguo' }), reservation(2, { slug: 'ambiguo' })], 3) });
  await writeRecord(root, 'SEL-000001', 'ambiguo');
  await writeRecord(root, 'SEL-000002', 'ambiguo');
  const result = run(root, 'selo:validar', ['ambiguo']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /slug ambíguo/i);
});

test('arquivo sem reserva aparece na auditoria', async () => {
  const root = await workspace();
  await writeRecord(root, 'SEL-000001', 'sem-reserva');
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /arquivo sem reserva no manifesto/);
});

test('reserva criada sem arquivo aparece na auditoria', async () => {
  const root = await workspace({ manifestValue: manifest([reservation(1)], 2) });
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Reserva criada sem JSON/);
});

test('status inválido aparece na auditoria', async () => {
  const root = await workspace({ manifestValue: manifest([reservation(1, { status: 'desconhecido' })], 2) });
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /status inválido/);
});

test('falha transacional não deixa lock preso', async () => {
  const root = await workspace({ withTemplate: false });
  assert.notEqual(run(root, 'selo:novo', ['--slug', 'falha-sem-lock', '--titulo', 'Falha']).status, 0);
  await assert.rejects(readFile(path.join(root, 'manifests', 'ids.lock'), 'utf8'), /ENOENT/);
});

test('falha transacional mantém manifesto legível', async () => {
  const root = await workspace({ withTemplate: false });
  assert.notEqual(run(root, 'selo:novo', ['--slug', 'falha-legivel', '--titulo', 'Falha']).status, 0);
  const data = await readManifest(root);
  assert.equal(data.next_sequence, 2);
  assert.equal(data.reserved[0].status, 'falha_na_criacao');
});

test('lock substituído entre snapshot e liberação não é removido', async () => {
  const root = await workspace();
  const lockPath = path.join(root, 'manifests', 'ids.lock');
  const pending = runAsync(root, 'selo:novo', ['--slug', 'troca-na-liberacao', '--titulo', 'Troca'], { SELO_TEST_LOCK_REMOVE_DELAY_MS: '500' });
  await waitForFile(lockPath);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await unlink(lockPath);
  const replacement = { pid: process.pid, timestamp: new Date().toISOString(), command: 'substituto', token: 'novo-token' };
  await writeLock(root, replacement);
  const result = await pending;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), replacement);
  await unlink(lockPath);
});

test('lock substituído antes da remoção obsoleta é preservado', async () => {
  const root = await workspace();
  const lockPath = path.join(root, 'manifests', 'ids.lock');
  await writeLock(root, { pid: 99999999, timestamp: new Date(Date.now() - 60_000).toISOString(), command: 'obsoleto', token: 'antigo' });
  const pending = runAsync(root, 'selo:novo', ['--slug', 'troca-obsoleto', '--titulo', 'Troca'], { SELO_LOCK_STALE_MS: '10', SELO_LOCK_TIMEOUT_MS: '900', SELO_LOCK_RETRY_MS: '20', SELO_TEST_LOCK_REMOVE_DELAY_MS: '500' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await unlink(lockPath);
  const replacement = { pid: process.pid, timestamp: new Date().toISOString(), command: 'ativo', token: 'token-ativo' };
  await writeLock(root, replacement);
  const result = await pending;
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), replacement);
  await unlink(lockPath);
});

test('processo não remove lock de outro token', async () => {
  const root = await workspace();
  const replacement = { pid: process.pid, timestamp: new Date().toISOString(), command: 'outro', token: 'token-de-outro' };
  await writeLock(root, replacement);
  const result = run(root, 'selo:novo', ['--slug', 'outro-token', '--titulo', 'Token'], { SELO_LOCK_TIMEOUT_MS: '80', SELO_LOCK_RETRY_MS: '10' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'manifests', 'ids.lock'), 'utf8')), replacement);
});

test('processo não remove lock de outro PID ativo', async () => {
  const root = await workspace();
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
  try {
    const replacement = { pid: holder.pid, timestamp: new Date(Date.now() - 60_000).toISOString(), command: 'holder', token: 'holder-token' };
    await writeLock(root, replacement);
    const result = run(root, 'selo:novo', ['--slug', 'pid-ativo', '--titulo', 'PID'], { SELO_LOCK_STALE_MS: '10', SELO_LOCK_TIMEOUT_MS: '80', SELO_LOCK_RETRY_MS: '10' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'manifests', 'ids.lock'), 'utf8')), replacement);
  } finally { holder.kill(); }
});

test('falha após JSON criado remove o JSON da transação', async () => {
  const root = await workspace();
  const result = run(root, 'selo:novo', ['--slug', 'falha-depois-json', '--titulo', 'Falha JSON'], { SELO_TEST_FAIL_STAGE: 'json' });
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(root, 'src', 'data', 'selos', 'SEL-000001.json'), 'utf8'), /ENOENT/);
  const item = (await readManifest(root)).reserved[0];
  assert.equal(item.status, 'falha_na_criacao');
  assert.ok(item.failed_at);
});

test('falha após pasta criada remove JSON e pasta vazia', async () => {
  const root = await workspace();
  const result = run(root, 'selo:novo', ['--slug', 'falha-depois-pasta', '--titulo', 'Falha Pasta'], { SELO_TEST_FAIL_STAGE: 'assets' });
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(root, 'src', 'data', 'selos', 'SEL-000001.json'), 'utf8'), /ENOENT/);
  await assert.rejects(readFile(path.join(root, 'public', 'assets', 'selos', 'SEL-000001'), 'utf8'));
  assert.equal((await readManifest(root)).reserved[0].status, 'falha_na_criacao');
});

test('falha compensada mantém manifesto válido', async () => {
  const root = await workspace();
  assert.notEqual(run(root, 'selo:novo', ['--slug', 'manifesto-apos-falha', '--titulo', 'Falha'], { SELO_TEST_FAIL_STAGE: 'assets' }).status, 0);
  const audit = run(root, 'catalogo:auditoria');
  assert.equal(audit.status, 0, audit.stdout + audit.stderr);
  assert.equal(JSON.parse(audit.stdout).errors.length, 0);
});

test('artefato preexistente nunca é removido pela falha', async () => {
  const root = await workspace();
  const directory = path.join(root, 'public', 'assets', 'selos', 'SEL-000001');
  await mkdir(directory);
  const evidence = path.join(directory, 'evidencia.txt');
  await writeFile(evidence, 'preservar');
  const result = run(root, 'selo:novo', ['--slug', 'preserva-existente', '--titulo', 'Preserva']);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(evidence, 'utf8'), 'preservar');
  assert.equal((await readManifest(root)).next_sequence, 1);
});

test('falha_na_criacao com JSON aparece como erro', async () => {
  const failed = reservation(1, { status: 'falha_na_criacao', completed_at: null, failed_at: '2026-07-23T12:00:02.000Z', failure_reason: 'falha', cancelado_em: null, cancellation_reason: null });
  const root = await workspace({ manifestValue: manifest([failed], 2) });
  await writeRecord(root, failed.id, failed.slug);
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /falha_na_criacao com JSON existente/);
});

test('reserva criada sem pasta de assets aparece como erro', async () => {
  const created = reservation(1);
  const root = await workspace({ manifestValue: manifest([created], 2) });
  await writeRecord(root, created.id, created.slug);
  await unlink(path.join(root, 'public', 'assets', 'selos', created.id, `${created.id}-frente.webp`));
  await unlink(path.join(root, 'public', 'assets', 'selos', created.id, `${created.id}-card.webp`));
  await rmdir(path.join(root, 'public', 'assets', 'selos', created.id));
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Reserva criada sem pasta de assets/);
});

test('slug do manifesto diferente do registro aparece como erro', async () => {
  const created = reservation(1, { slug: 'slug-manifesto' });
  const root = await workspace({ manifestValue: manifest([created], 2) });
  await writeRecord(root, created.id, 'slug-registro');
  const result = run(root, 'catalogo:auditoria');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Slug da reserva difere do JSON/);
});

test('schema_version inválido bloqueia criação', async () => {
  const invalid = manifest();
  invalid.schema_version = '1.0.0';
  const root = await workspace({ manifestValue: invalid });
  const result = run(root, 'selo:novo', ['--slug', 'schema-invalido', '--titulo', 'Schema']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /schema_version deve ser 2\.0\.0/);
  assert.equal((await readManifest(root)).next_sequence, 1);
});
