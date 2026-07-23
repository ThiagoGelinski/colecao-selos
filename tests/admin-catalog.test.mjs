import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRecordOperational } from '../src/lib/catalogo/audit.mjs';
import { dataPath } from '../src/lib/catalogo/records.mjs';
import { dashboardStats, listAdminRecords, sanitizeSearch, toAdminRecord } from '../src/lib/admin/catalog-domain.mjs';

const official = JSON.parse(await readFile(new URL('../src/data/selos/SEL-000001.json', import.meta.url), 'utf8'));
const validation = await validateRecordOperational(official, dataPath(official.id));
const adminRecord = toAdminRecord(official, validation);
const clone = (value) => structuredClone(value);
function recordWithMissingAssets() {
  const record = clone(official); record.id = 'SEL-999998';
  for (const kind of ['frente', 'verso', 'card']) record.imagens[kind] = `/assets/selos/${record.id}/${record.id}-${kind}.webp`;
  return record;
}

test('registro completamente válido aprova todas as camadas operacionais', () => {
  assert.equal(validation.valid, true); assert.equal(validation.layers.structural.valid, true); assert.equal(validation.layers.semantic.valid, true); assert.equal(validation.layers.editorial.valid, true); assert.equal(validation.layers.assets.valid, true);
  assert.equal(validation.layers.assets.items.every((asset) => asset.path_valid && asset.exists), true);
});

test('adaptador projeta registro oficial e existência real dos assets', () => {
  assert.equal(adminRecord.id, official.id); assert.equal(adminRecord.titulo, official.titulo); assert.equal(adminRecord.pais, official.identificacao.pais); assert.equal(adminRecord.status, official.publicacao.status);
  assert.equal(adminRecord.imagens.frente.informado, true); assert.equal(adminRecord.imagens.frente.existe, true); assert.equal(adminRecord.imagens.card.valido, true); assert.equal(adminRecord.validacao.valida, true); assert.equal(adminRecord.validacao.assets.valida, true);
});

test('JSON válido com asset ausente falha somente na camada operacional aplicável', async () => {
  const record = recordWithMissingAssets(); const result = await validateRecordOperational(record, dataPath(record.id));
  assert.equal(result.layers.structural.valid, true); assert.equal(result.layers.semantic.valid, true); assert.equal(result.layers.editorial.valid, true); assert.equal(result.layers.assets.valid, false); assert.equal(result.valid, false);
  assert.match(result.layers.assets.errors.join('\n'), /arquivo não encontrado/);
});

test('caminho de asset inválido é refletido na projeção e nunca é presença válida', async () => {
  const record = clone(official); record.imagens.frente = `/assets/selos/${record.id}/arquivo-incorreto.webp`;
  const result = await validateRecordOperational(record, dataPath(record.id)); const projected = toAdminRecord(record, result);
  assert.equal(result.layers.assets.valid, false); assert.match(result.layers.assets.errors.join('\n'), /nome ou diretório inválido/);
  assert.deepEqual(projected.imagens.frente, { informado: true, caminho_valido: false, existe: false, valido: false, erro: `frente: nome ou diretório inválido; esperado /assets/selos/${record.id}/${record.id}-frente.webp.` });
  assert.equal(projected.validacao.valida, false); assert.equal(projected.validacao.assets.valida, false);
});

test('erro de asset incrementa com_erro no dashboard', async () => {
  const record = recordWithMissingAssets(); const invalid = await validateRecordOperational(record, dataPath(record.id));
  const stats = dashboardStats([official, record], new Map([[official.id, validation], [record.id, invalid]]));
  assert.equal(stats.indicadores.total, 2); assert.equal(stats.indicadores.com_erro, 1);
});

test('listagem nunca classifica como Válido registro com asset ausente', async () => {
  const record = recordWithMissingAssets(); const invalid = await validateRecordOperational(record, dataPath(record.id)); const projected = toAdminRecord(record, invalid);
  const listed = listAdminRecords([projected], {}).items[0];
  assert.equal(listed.validacao.valida, false); assert.ok(listed.validacao.erros > 0); assert.equal(listed.validacao.assets.valida, false); assert.equal(listed.imagens.frente.informado, true); assert.equal(listed.imagens.frente.existe, false);
});

test('dashboard calcula exclusivamente dados reais e atividade da auditoria', () => {
  const stats = dashboardStats([official], new Map([[official.id, validation]]));
  assert.equal(stats.indicadores.total, 1); assert.equal(stats.indicadores.aguardando_revisao, 1); assert.equal(stats.indicadores.publicados, 0); assert.equal(stats.indicadores.com_erro, 0); assert.equal(stats.atividade_recente[0].id, official.id);
});

test('dashboard representa ausência de dados sem inventar indicadores', () => {
  assert.deepEqual(dashboardStats([], new Map()), { indicadores: { total: 0, rascunhos: 0, em_preparacao: 0, aguardando_revisao: 0, aprovados: 0, publicados: 0, rejeitados_ou_correcoes: 0, com_erro: 0 }, atividade_recente: [] });
});

test('listagem busca ID e título, filtra status e pagina com limites', () => {
  const second = { ...adminRecord, id: 'SEL-000002', titulo: 'Outro selo', status: 'rascunho' };
  assert.deepEqual(listAdminRecords([adminRecord, second], { q: 'campos salles' }).items.map((item) => item.id), [official.id]); assert.deepEqual(listAdminRecords([adminRecord, second], { q: 'SEL-000002' }).items.map((item) => item.id), ['SEL-000002']); assert.deepEqual(listAdminRecords([adminRecord, second], { status: 'rascunho' }).items.map((item) => item.id), ['SEL-000002']);
  const paged = listAdminRecords([adminRecord, second], { page: 2, pageSize: 1, sort: 'id' }); assert.equal(paged.meta.pages, 2); assert.equal(paged.items[0].id, 'SEL-000002');
});

test('busca é sanitizada, limitada e status desconhecido não injeta filtro', () => { assert.equal(sanitizeSearch(`\u0000 ${'x'.repeat(150)}`).length, 100); assert.equal(listAdminRecords([adminRecord], { status: '<script>' }).items.length, 1); });
test('ordenação aceita somente chaves previstas', () => { const second = { ...adminRecord, id: 'SEL-000002', titulo: 'A' }; assert.deepEqual(listAdminRecords([adminRecord, second], { sort: '__proto__', direction: 'desc' }).items.map((item) => item.id), ['SEL-000002', 'SEL-000001']); });
