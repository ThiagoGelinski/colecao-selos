import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertSeloData, recordHash, schemaIsCompiled, validateSeloData, validateSeloSchema } from '../src/lib/selo-validation.mjs';

const ROOT = path.resolve('.');
const TOOL = path.join(ROOT, 'tools', 'catalogo.mjs');
const TEMPLATE = path.join(ROOT, 'templates', 'selo.template.json');
const DATA_DIR = path.join(ROOT, 'src', 'data', 'selos');

async function draft() {
  const raw = await readFile(TEMPLATE, 'utf8');
  return JSON.parse(raw.replaceAll('{{ID}}', 'SEL-000002').replaceAll('{{SLUG}}', 'selo-de-teste').replaceAll('{{TITULO}}', 'Selo de teste').replaceAll('{{DATE}}', '2026-07-23'));
}

function clone(value) { return structuredClone(value); }

function approved(record, status = 'aprovado') {
  const candidate = clone(record);
  candidate.publicacao.status = status;
  candidate.publicacao.apto_para_preview = status === 'publicado';
  candidate.publicacao.apto_para_publicacao = status === 'publicado';
  candidate.aprovacao_humana = {
    status: 'aprovado', decisao: 'aprovado', aprovado_por: 'Revisora', aprovado_em: '2026-07-23T12:00:00.000Z',
    hash_do_registro_aprovado: null, versao_aprovada: candidate.auditoria.versao, escopo: 'publicacao_catalogo', observacao: null
  };
  candidate.aprovacao_humana.hash_do_registro_aprovado = recordHash(candidate);
  return candidate;
}

function hasError(result, pathValue, keyword) {
  return result.errors.some((error) => error.instancePath === pathValue && error.keyword === keyword);
}

async function cliWorkspace(record, templateOverride = null) {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-schema-'));
  await mkdir(path.join(root, 'src', 'data', 'selos'), { recursive: true });
  await mkdir(path.join(root, 'public', 'assets', 'selos', record.id), { recursive: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await writeFile(path.join(root, 'src', 'data', 'selos', `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(path.join(root, 'public', 'assets', 'selos', record.id, `${record.id}-frente.webp`), 'asset');
  await writeFile(path.join(root, 'public', 'assets', 'selos', record.id, `${record.id}-card.webp`), 'asset');
  await writeFile(path.join(root, 'manifests', 'ids.json'), `${JSON.stringify({ schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 3, reserved: [{ id: record.id, sequence: 2, reserved_at: '2026-07-23T12:00:00.000Z', source: 'teste', status: 'criado', slug: record.slug, created_at: '2026-07-23T12:00:00.000Z', completed_at: '2026-07-23T12:00:01.000Z', failed_at: null, failure_reason: null, cancelado_em: null, cancellation_reason: null }] }, null, 2)}\n`);
  await writeFile(path.join(root, 'templates', 'selo.template.json'), templateOverride ?? await readFile(TEMPLATE, 'utf8'));
  return root;
}

function run(root, command, ...args) {
  return spawnSync(process.execPath, [TOOL, command, ...args], { cwd: root, encoding: 'utf8' });
}

test('schema compila sem erro', () => assert.equal(schemaIsCompiled(), true));

test('registro válido passa', async () => assert.equal(validateSeloData(await draft()).valid, true));

test('campo obrigatório ausente falha', async () => {
  const record = await draft(); delete record.titulo;
  assert.equal(hasError(validateSeloSchema(record), '/', 'required'), true);
});

test('tipo incorreto falha', async () => {
  const record = await draft(); record.identificacao.tema = 'tema';
  assert.equal(hasError(validateSeloSchema(record), '/identificacao/tema', 'type'), true);
});

test('enum inválido falha', async () => {
  const record = await draft(); record.publicacao.status = 'inexistente';
  assert.equal(hasError(validateSeloSchema(record), '/publicacao/status', 'enum'), true);
});

test('propriedade desconhecida falha', async () => {
  const record = await draft(); record.desconhecido = true;
  assert.equal(hasError(validateSeloSchema(record), '/', 'additionalProperties'), true);
});

test('data inválida falha', async () => {
  const record = await draft(); record.auditoria.criado_em = '2026-02-31';
  assert.equal(hasError(validateSeloSchema(record), '/auditoria/criado_em', 'format'), true);
});

test('date-time inválido falha', async () => {
  const record = approved(await draft()); record.aprovacao_humana.aprovado_em = '2026-07-23 12:00';
  assert.equal(hasError(validateSeloSchema(record), '/aprovacao_humana/aprovado_em', 'format'), true);
});

test('hash inválido falha', async () => {
  const record = approved(await draft()); record.aprovacao_humana.hash_do_registro_aprovado = 'abc';
  assert.equal(hasError(validateSeloSchema(record), '/aprovacao_humana/hash_do_registro_aprovado', 'pattern'), true);
});

test('publicado sem aprovação falha', async () => {
  const record = await draft(); delete record.aprovacao_humana; record.publicacao = { status: 'publicado', apto_para_preview: true, apto_para_publicacao: true, motivo: null };
  assert.equal(validateSeloSchema(record).valid, false);
});

test('aprovado com apto_para_publicacao true falha', async () => {
  const record = approved(await draft()); record.publicacao.apto_para_publicacao = true;
  assert.equal(validateSeloSchema(record).valid, false);
});

test('publicado com apto_para_publicacao false falha', async () => {
  const record = approved(await draft(), 'publicado'); record.publicacao.apto_para_publicacao = false;
  assert.equal(validateSeloSchema(record).valid, false);
});

test('revisão necessária com aprovação ainda válida falha', async () => {
  const record = approved(await draft()); record.publicacao.status = 'revisao_necessaria'; record.publicacao.apto_para_publicacao = false;
  assert.equal(validateSeloSchema(record).valid, false);
});

test('template substituído passa', async () => assert.equal(validateSeloSchema(await draft()).valid, true));

test('canonical diferente do slug falha semanticamente', async () => {
  const record = await draft(); record.seo.canonical_path = '/selos/outro';
  const result = validateSeloData(record);
  assert.equal(hasError(result.semantic, '/seo/canonical_path', 'canonicalPath'), true);
});

test('canonical absoluto falha', async () => {
  const record = await draft(); record.seo.canonical_path = 'https://example.com/selos/selo-de-teste';
  assert.equal(validateSeloData(record).valid, false);
});

test('canonical com query ou fragmento falha', async () => {
  for (const suffix of ['?x=1', '#secao']) {
    const record = await draft(); record.seo.canonical_path += suffix;
    assert.equal(validateSeloData(record).valid, false);
  }
});

test('erro de schema bloqueia gravação', async () => {
  const seed = await draft();
  const invalidTemplate = JSON.stringify({ ...seed, propriedade_desconhecida: true }).replaceAll(seed.id, '{{ID}}').replaceAll(seed.slug, '{{SLUG}}').replaceAll(seed.titulo, '{{TITULO}}').replaceAll('2026-07-23', '{{DATE}}');
  const root = await cliWorkspace(seed, invalidTemplate);
  await writeFile(path.join(root, 'src', 'data', 'selos', `${seed.id}.json`), `${JSON.stringify(seed)}\n`);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests', 'ids.json'), 'utf8'));
  manifest.next_sequence = 3;
  await writeFile(path.join(root, 'manifests', 'ids.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const result = run(root, 'selo:novo', '--slug', 'novo-schema-invalido', '--titulo', 'Inválido');
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(root, 'src', 'data', 'selos', 'SEL-000003.json'), 'utf8'), /ENOENT/);
  const after = JSON.parse(await readFile(path.join(root, 'manifests', 'ids.json'), 'utf8'));
  assert.equal(after.reserved.at(-1).status, 'falha_na_criacao');
});

test('CLI e runtime produzem resultado equivalente', async () => {
  const record = await draft(); record.publicacao.status = 'status-invalido';
  const runtime = validateSeloData(record);
  assert.throws(() => assertSeloData(record), /\/publicacao\/status/);
  const root = await cliWorkspace(record);
  const cli = run(root, 'selo:validar', record.id);
  assert.notEqual(cli.status, 0);
  const output = JSON.parse(cli.stdout)[0];
  assert.deepEqual(output.structural_errors.map(({ instancePath, keyword }) => ({ instancePath, keyword })), runtime.structural.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword })));
});

test('registros reais passam no schema', async () => {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.json'));
  for (const name of names) assert.equal(validateSeloSchema(JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'))).valid, true, name);
});

test('catálogo inteiro passa na validação estrutural', async () => {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.json'));
  const results = await Promise.all(names.map(async (name) => validateSeloSchema(JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8')))));
  assert.equal(results.every((result) => result.valid), true);
});
