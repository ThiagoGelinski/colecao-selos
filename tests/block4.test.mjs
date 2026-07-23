import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const TOOL = path.join(ROOT, 'tools', 'catalogo.mjs');
const ID = 'SEL-000002';

function record() {
  return {
    schema_version: '1.0.0', id: ID, slug: 'selo-bloco-quatro', titulo: 'Selo Bloco 4', descricao_curta: 'Teste',
    identificacao: { pais: 'Brasil', tipo: 'Selo postal', categoria: 'teste', tema: [], valor_facial: { valor: 1, unidade: 'centavo' } },
    emissao: { ano: 2000 }, tecnica: {}, catalogos: {}, exemplar: {},
    imagens: { frente: `/assets/selos/${ID}/${ID}-frente.webp`, verso: null, card: `/assets/selos/${ID}/${ID}-card.webp`, thumb: null, alt: 'Selo' },
    historico: {}, historico_editorial: [], fontes: [], seo: { title: 'Selo', meta_description: 'Descrição', canonical_path: '/selos/selo-bloco-quatro' },
    aprovacao_humana: { status: 'pendente', decisao: 'pendente', aprovado_por: null, aprovado_em: null, hash_do_registro_aprovado: null, versao_aprovada: null, escopo: 'publicacao_catalogo', observacao: null },
    publicacao: { status: 'aguardando_revisao', apto_para_preview: true, apto_para_publicacao: false, motivo: 'teste' },
    auditoria: { criado_em: '2026-07-23', ultima_revisao: '2026-07-23', versao: '1.0.0' }
  };
}

function reservation() {
  return { id: ID, sequence: 2, reserved_at: '2026-07-23T12:00:00.000Z', source: 'teste', status: 'criado', slug: 'selo-bloco-quatro', created_at: '2026-07-23T12:00:00.000Z', completed_at: '2026-07-23T12:00:01.000Z', failed_at: null, failure_reason: null, cancelado_em: null, cancellation_reason: null };
}

async function fixture(value = record()) {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-bloco4-'));
  const file = path.join(root, 'src', 'data', 'selos', `${ID}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.join(root, 'public', 'assets', 'selos', ID), { recursive: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'templates'), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(root, 'public', 'assets', 'selos', ID, `${ID}-frente.webp`), 'asset');
  await writeFile(path.join(root, 'public', 'assets', 'selos', ID, `${ID}-card.webp`), 'asset');
  await writeFile(path.join(root, 'manifests', 'ids.json'), `${JSON.stringify({ schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 3, reserved: [reservation()] }, null, 2)}\n`);
  return { root, file };
}

function run(root, command, ...args) { return spawnSync(process.execPath, [TOOL, command, ...args], { cwd: root, encoding: 'utf8' }); }
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function approve(root) { const result = run(root, 'selo:aprovar', ID, '--revisor', '  Revisora Humana  '); assert.equal(result.status, 0, result.stderr); }

for (const moduleName of ['assets.mjs', 'audit.mjs', 'commands.mjs', 'errors.mjs', 'history.mjs', 'io.mjs', 'lock.mjs', 'manifest.mjs', 'output.mjs', 'paths.mjs', 'records.mjs', 'transactions.mjs']) {
  test(`módulo ${moduleName} importa sem erro`, async () => { await import(`../src/lib/catalogo/${moduleName}`); });
}

test('CLI atual continua funcionando e --json produz JSON puro', async () => {
  const { root } = await fixture();
  const result = run(root, 'selo:status', ID, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, 'selo:status');
});

test('exit codes diferenciam uso e aprovação', async () => {
  const { root } = await fixture();
  assert.equal(run(root, 'comando:inexistente').status, 2);
  assert.equal(run(root, 'selo:revogar', ID, '--revisor', 'R', '--motivo', 'M').status, 6);
});

test('rejeição válida normaliza revisor, exige motivo e adiciona histórico', async () => {
  const { root, file } = await fixture();
  const result = run(root, 'selo:rejeitar', ID, '--revisor', '  Revisora  ', '--motivo', '  Dados insuficientes  ');
  assert.equal(result.status, 0, result.stderr);
  const value = await json(file);
  assert.equal(value.aprovacao_humana.status, 'rejeitado');
  assert.equal(value.aprovacao_humana.rejeitado_por, 'Revisora');
  assert.equal(value.aprovacao_humana.motivo_rejeicao, 'Dados insuficientes');
  assert.equal(value.publicacao.status, 'revisao_necessaria');
  assert.equal(value.historico_editorial.at(-1).tipo, 'rejeicao');
});

test('rejeição sem motivo ou revisor falha sem alterar registro', async () => {
  const first = await fixture();
  const before = await readFile(first.file, 'utf8');
  assert.equal(run(first.root, 'selo:rejeitar', ID, '--revisor', 'R').status, 2);
  assert.equal(await readFile(first.file, 'utf8'), before);
  assert.equal(run(first.root, 'selo:rejeitar', ID, '--motivo', 'M').status, 2);
});

test('revogação válida preserva aprovação e histórico anterior', async () => {
  const { root, file } = await fixture();
  await approve(root);
  const approved = await json(file);
  const hash = approved.aprovacao_humana.hash_do_registro_aprovado;
  const result = run(root, 'selo:revogar', ID, '--revisor', 'Revisor 2', '--motivo', 'Nova análise');
  assert.equal(result.status, 0, result.stderr);
  const value = await json(file);
  assert.equal(value.aprovacao_humana.status, 'revogado');
  assert.equal(value.aprovacao_humana.aprovado_por, 'Revisora Humana');
  assert.equal(value.aprovacao_humana.hash_do_registro_aprovado, hash);
  assert.deepEqual(value.historico_editorial.map((item) => item.tipo), ['aprovacao', 'revogacao']);
});

test('revogação sem aprovação ativa falha', async () => {
  const { root } = await fixture();
  const result = run(root, 'selo:revogar', ID, '--revisor', 'R', '--motivo', 'M');
  assert.equal(result.status, 6);
});

test('aprovação e publicação adicionam histórico cronológico', async () => {
  const { root, file } = await fixture();
  await approve(root);
  assert.equal(run(root, 'selo:publicar', ID).status, 0);
  const value = await json(file);
  assert.deepEqual(value.historico_editorial.map((item) => item.tipo), ['aprovacao', 'publicacao']);
  assert.ok(Date.parse(value.historico_editorial[1].ocorrido_em) >= Date.parse(value.historico_editorial[0].ocorrido_em));
});

test('invalidação automática adiciona histórico e preserva aprovação', async () => {
  const { root, file } = await fixture();
  await approve(root);
  const value = await json(file);
  const approvedBy = value.aprovacao_humana.aprovado_por;
  value.titulo = 'Alterado';
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  assert.equal(run(root, 'selo:publicar', ID).status, 6);
  const invalid = await json(file);
  assert.equal(invalid.aprovacao_humana.aprovado_por, approvedBy);
  assert.equal(invalid.historico_editorial.at(-1).tipo, 'invalidacao');
});

test('status individual e global apresentam resumo correto', async () => {
  const { root } = await fixture();
  const individual = JSON.parse(run(root, 'selo:status', ID, '--json').stdout);
  assert.equal(individual.data.id, ID);
  assert.equal(individual.data.assets_obrigatorios_presentes, true);
  const global = JSON.parse(run(root, 'catalogo:status', '--json').stdout);
  assert.equal(global.data.total_registros, 1);
  assert.equal(global.data.proximo_id, 'SEL-000003');
});

test('manutenção dry-run diagnostica sem remover artefato recente', async () => {
  const { root } = await fixture();
  const residue = path.join(root, 'manifests', 'ids.lock.removal-teste');
  await writeFile(residue, '{}');
  const output = JSON.parse(run(root, 'catalogo:manutencao', '--dry-run', '--json').stdout);
  assert.equal(output.data.residues.length, 1);
  await access(residue);
});

test('manutenção não remove lock ativo', async () => {
  const { root } = await fixture();
  const lock = path.join(root, 'manifests', 'ids.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString(), command: 'teste', token: 'ativo' }));
  const result = run(root, 'catalogo:manutencao', '--limpar', '--json');
  assert.equal(result.status, 3);
  await access(lock);
});

test('manutenção identifica lock obsoleto e limpa quarentena segura', async () => {
  const { root } = await fixture();
  const lock = path.join(root, 'manifests', 'ids.lock');
  const old = new Date(Date.now() - 120_000);
  await writeFile(lock, JSON.stringify({ pid: 99999999, timestamp: old.toISOString(), command: 'teste', token: 'obsoleto' }));
  const residue = path.join(root, 'manifests', 'ids.lock.removal-antigo');
  await writeFile(residue, '{}');
  await utimes(residue, old, old);
  const diagnosis = JSON.parse(run(root, 'catalogo:manutencao', '--dry-run', '--json').stdout);
  assert.equal(diagnosis.data.lock.stale, true);
  const clean = JSON.parse(run(root, 'catalogo:manutencao', '--limpar', '--json').stdout);
  assert.ok(clean.data.removed.length >= 2);
  assert.equal((await readdir(path.join(root, 'manifests'))).some((name) => name.startsWith('ids.lock.removal-')), false);
});

test('auditoria detecta histórico inconsistente', async () => {
  const value = record();
  value.historico_editorial = [{ tipo: 'revogacao', ocorrido_em: '2026-07-23T12:00:00.000Z', responsavel: 'R', motivo: 'M', hash: null, versao: '1.0.0' }];
  const { root } = await fixture(value);
  const result = run(root, 'catalogo:auditoria');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /revogação sem aprovação anterior/);
});

test('auditoria detecta assets órfãos e temporários antigos', async () => {
  const { root } = await fixture();
  await mkdir(path.join(root, 'public', 'assets', 'selos', 'SEL-999999'));
  const temporary = path.join(root, 'src', 'data', 'selos', 'residuo.tmp');
  await writeFile(temporary, 'x');
  const old = new Date(Date.now() - 120_000);
  await utimes(temporary, old, old);
  const result = run(root, 'catalogo:auditoria');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /assets órfão/);
  assert.match(result.stdout, /temporary antigo/);
});

test('logs de operação mutável incluem transaction_id', async () => {
  const { root } = await fixture();
  await approve(root);
  const lines = (await readFile(path.join(root, 'logs', 'pipeline.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.match(lines.at(-1).transaction_id, /^[0-9a-f-]{36}$/);
  assert.equal(lines.at(-1).pid > 0, true);
});

test('stack trace aparece somente em debug', async () => {
  const { root } = await fixture();
  const normal = run(root, 'selo:revogar', ID, '--revisor', 'R', '--motivo', 'M');
  assert.doesNotMatch(normal.stderr, /\n\s+at /);
  const debug = run(root, 'selo:revogar', ID, '--revisor', 'R', '--motivo', 'M', '--debug');
  assert.match(debug.stderr, /\n\s+at /);
});