import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TOOL = path.resolve('tools/catalogo.mjs');
const ID = 'SEL-000002';

function baseRecord(id = ID) {
  return {
    schema_version: '1.0.0',
    id,
    slug: 'selo-de-teste',
    titulo: 'Selo de teste',
    descricao_curta: 'Registro isolado para testes.',
    identificacao: { pais: 'Brasil', tipo: 'Selo postal', categoria: 'teste', tema: [], valor_facial: { valor: 1, unidade: 'centavo' } },
    emissao: { ano: 2000 },
    tecnica: {},
    catalogos: {},
    exemplar: {},
    imagens: {
      frente: `/assets/selos/${id}/${id}-frente.webp`,
      verso: null,
      card: `/assets/selos/${id}/${id}-card.webp`,
      thumb: null,
      alt: 'Selo de teste'
    },
    historico: {},
    fontes: [],
    seo: { title: 'Selo de teste', meta_description: 'Descrição de teste', canonical_path: '/selos/selo-de-teste' },
    aprovacao_humana: { status: 'pendente', decisao: 'pendente', aprovado_por: null, aprovado_em: null, hash_do_registro_aprovado: null, versao_aprovada: null, escopo: 'publicacao_catalogo', observacao: null },
    publicacao: { status: 'aguardando_revisao', apto_para_preview: true, apto_para_publicacao: false, motivo: 'teste' },
    auditoria: { criado_em: '2026-07-23', ultima_revisao: '2026-07-23', versao: '1.0.0' }
  };
}

async function fixture({ record = baseRecord(), fileId = record.id, assets = ['frente', 'card'] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'selos-ai-first-'));
  await mkdir(path.join(root, 'src', 'data', 'selos'), { recursive: true });
  await mkdir(path.join(root, 'public', 'assets', 'selos', record.id), { recursive: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await writeFile(path.join(root, 'src', 'data', 'selos', `${fileId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(path.join(root, 'manifests', 'ids.json'), `${JSON.stringify({ prefix: 'SEL', digits: 6, next_sequence: 3, reserved: [{ id: record.id }] })}\n`);
  for (const kind of assets) await writeFile(path.join(root, 'public', 'assets', 'selos', record.id, `${record.id}-${kind}.webp`), 'asset');
  return { root, file: path.join(root, 'src', 'data', 'selos', `${fileId}.json`) };
}

function run(root, command, ...args) {
  return spawnSync(process.execPath, [TOOL, command, ...args], { cwd: root, encoding: 'utf8' });
}

async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }

test('aprovação válida registra identidade, data, hash e versão', async () => {
  const { root, file } = await fixture();
  const result = run(root, 'selo:aprovar', ID, '--revisor', 'Revisora Humana');
  assert.equal(result.status, 0, result.stderr);
  const record = await json(file);
  assert.equal(record.aprovacao_humana.aprovado_por, 'Revisora Humana');
  assert.match(record.aprovacao_humana.aprovado_em, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(record.aprovacao_humana.hash_do_registro_aprovado, /^[a-f0-9]{64}$/);
  assert.equal(record.aprovacao_humana.versao_aprovada, '1.0.0');
});

test('alteração após aprovação é detectada pela validação', async () => {
  const { root, file } = await fixture();
  assert.equal(run(root, 'selo:aprovar', ID, '--revisor', 'Revisora').status, 0);
  const record = await json(file);
  record.titulo = 'Conteúdo alterado após aprovação';
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = run(root, 'selo:validar', ID);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /diverge do hash aprovado/i);
});

test('hash divergente bloqueia publicação e invalida aprovação', async () => {
  const { root, file } = await fixture();
  assert.equal(run(root, 'selo:aprovar', ID, '--revisor', 'Revisora').status, 0);
  const record = await json(file);
  record.aprovacao_humana.hash_do_registro_aprovado = '0'.repeat(64);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = run(root, 'selo:publicar', ID);
  assert.notEqual(result.status, 0);
  const invalidated = await json(file);
  assert.equal(invalidated.aprovacao_humana.status, 'revogado');
  assert.equal(invalidated.publicacao.apto_para_publicacao, false);
  assert.equal(invalidated.publicacao.status, 'revisao_necessaria');
});

test('asset obrigatório ausente bloqueia publicação', async () => {
  const { root, file } = await fixture({ assets: ['frente'] });
  assert.equal(run(root, 'selo:aprovar', ID, '--revisor', 'Revisora').status, 0);
  const before = await readFile(file, 'utf8');
  const result = run(root, 'selo:publicar', ID);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /asset card: arquivo não encontrado/i);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('path traversal em asset é bloqueado', async () => {
  const record = baseRecord();
  record.imagens.frente = `/assets/selos/${ID}/../segredo.webp`;
  const { root } = await fixture({ record });
  const result = run(root, 'selo:validar', ID);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /path traversal/i);
});

test('nome do arquivo diferente do ID interno é bloqueado', async () => {
  const record = baseRecord('SEL-000003');
  const { root } = await fixture({ record, fileId: ID });
  const result = run(root, 'selo:validar');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /nome do arquivo.*difere do ID interno/i);
});

test('falha de publicação sem aprovação não altera o JSON', async () => {
  const { root, file } = await fixture();
  const before = await readFile(file, 'utf8');
  const result = run(root, 'selo:publicar', ID);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('preparação só libera revisão quando todos os assets existem', async () => {
  const { root } = await fixture({ assets: ['frente'] });
  const result = run(root, 'selo:preparar', ID);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"ready_for_review": false/);
});

test('revisor ausente bloqueia aprovação', async () => {
  const { root, file } = await fixture();
  const before = await readFile(file, 'utf8');
  const result = run(root, 'selo:aprovar', ID);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revisor/i);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('revisor composto apenas por espaços bloqueia aprovação', async () => {
  const { root, file } = await fixture();
  const before = await readFile(file, 'utf8');
  const result = run(root, 'selo:aprovar', ID, '--revisor', '   ');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revisor/i);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('nome do revisor é normalizado no registro e no log', async () => {
  const { root, file } = await fixture();
  const result = run(root, 'selo:aprovar', ID, '--revisor', '  Revisora Humana  ');
  assert.equal(result.status, 0, result.stderr);
  const record = await json(file);
  assert.equal(record.aprovacao_humana.aprovado_por, 'Revisora Humana');
  const log = await readFile(path.join(root, 'logs', 'pipeline.jsonl'), 'utf8');
  assert.equal(JSON.parse(log.trim()).reviewer, 'Revisora Humana');
});

test('falha estrutural de aprovação não modifica o JSON', async () => {
  const record = baseRecord();
  record.titulo = '';
  const { root, file } = await fixture({ record });
  const before = await readFile(file, 'utf8');
  const result = run(root, 'selo:aprovar', ID, '--revisor', 'Revisora');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APROVAÇÃO BLOQUEADA/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('fluxo positivo completo aprova e publica com sucesso', async () => {
  const { root, file } = await fixture();
  assert.equal(run(root, 'selo:aprovar', ID, '--revisor', 'Revisora').status, 0);
  const publish = run(root, 'selo:publicar', ID);
  assert.equal(publish.status, 0, publish.stderr);
  const record = await json(file);
  assert.equal(record.publicacao.status, 'publicado');
  assert.equal(record.publicacao.apto_para_publicacao, true);
});

test('aprovação editorial mantém apto_para_publicacao false', async () => {
  const { root, file } = await fixture();
  const result = run(root, 'selo:aprovar', ID, '--revisor', 'Revisora');
  assert.equal(result.status, 0, result.stderr);
  const record = await json(file);
  assert.equal(record.publicacao.status, 'aprovado');
  assert.equal(record.publicacao.apto_para_publicacao, false);
});

test('apto_para_publicacao só se torna true após publicar', async () => {
  const { root, file } = await fixture();
  assert.equal(run(root, 'selo:aprovar', ID, '--revisor', 'Revisora').status, 0);
  assert.equal((await json(file)).publicacao.apto_para_publicacao, false);
  assert.equal(run(root, 'selo:publicar', ID).status, 0);
  assert.equal((await json(file)).publicacao.apto_para_publicacao, true);
});
