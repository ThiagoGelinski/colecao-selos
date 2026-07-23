import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dashboardStats, listAdminRecords, sanitizeSearch, toAdminRecord } from '../src/lib/admin/catalog-domain.mjs';
import { validateSeloData } from '../src/lib/selo-validation.mjs';

const official = JSON.parse(await readFile(new URL('../src/data/selos/SEL-000001.json', import.meta.url), 'utf8'));
const validation = validateSeloData(official);
const adminRecord = toAdminRecord(official, validation);

test('adaptador projeta registro oficial sem duplicação e mantém compatibilidade com a pipeline', () => {
  assert.equal(adminRecord.id, official.id); assert.equal(adminRecord.titulo, official.titulo); assert.equal(adminRecord.pais, official.identificacao.pais); assert.equal(adminRecord.status, official.publicacao.status);
  assert.equal(adminRecord.imagens.frente, true); assert.equal(adminRecord.imagens.card, true); assert.equal(adminRecord.validacao.valida, validation.valid);
});

test('dashboard calcula exclusivamente dados reais e atividade da auditoria', () => {
  const stats = dashboardStats([official], new Map([[official.id, validation]]));
  assert.equal(stats.indicadores.total, 1); assert.equal(stats.indicadores.aguardando_revisao, 1);
  assert.equal(stats.indicadores.publicados, 0); assert.equal(stats.indicadores.com_erro, validation.valid ? 0 : 1);
  assert.equal(stats.atividade_recente[0].id, official.id);
});

test('dashboard representa ausência de dados sem inventar indicadores', () => {
  assert.deepEqual(dashboardStats([], new Map()), { indicadores: { total: 0, rascunhos: 0, em_preparacao: 0, aguardando_revisao: 0, aprovados: 0, publicados: 0, rejeitados_ou_correcoes: 0, com_erro: 0 }, atividade_recente: [] });
});

test('listagem busca ID e título, filtra status e pagina com limites', () => {
  const second = { ...adminRecord, id: 'SEL-000002', titulo: 'Outro selo', status: 'rascunho' };
  assert.deepEqual(listAdminRecords([adminRecord, second], { q: 'campos salles' }).items.map((item) => item.id), [official.id]);
  assert.deepEqual(listAdminRecords([adminRecord, second], { q: 'SEL-000002' }).items.map((item) => item.id), ['SEL-000002']);
  assert.deepEqual(listAdminRecords([adminRecord, second], { status: 'rascunho' }).items.map((item) => item.id), ['SEL-000002']);
  const paged = listAdminRecords([adminRecord, second], { page: 2, pageSize: 1, sort: 'id' }); assert.equal(paged.meta.pages, 2); assert.equal(paged.items[0].id, 'SEL-000002');
});

test('busca é sanitizada, limitada e status desconhecido não injeta filtro', () => {
  assert.equal(sanitizeSearch(`\u0000 ${'x'.repeat(150)}`).length, 100);
  assert.equal(listAdminRecords([adminRecord], { status: '<script>' }).items.length, 1);
});

test('ordenação aceita somente chaves previstas', () => {
  const second = { ...adminRecord, id: 'SEL-000002', titulo: 'A' };
  assert.deepEqual(listAdminRecords([adminRecord, second], { sort: '__proto__', direction: 'desc' }).items.map((item) => item.id), ['SEL-000002', 'SEL-000001']);
});
