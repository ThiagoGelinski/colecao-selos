import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEditorChanges, buildMediaFormData, fieldValue, privateAssetUrl } from '../src/lib/admin/editor-form.mjs';
import { validateSeloSchema } from '../src/lib/selo-validation.mjs';

const record = JSON.parse(await readFile(new URL('../src/data/selos/SEL-000001.json', import.meta.url), 'utf8'));
const digest = 'a'.repeat(64);
const file = new File([new Uint8Array([1, 2, 3])], 'original.png', { type: 'image/png' });

test('editor preserva todo dado não exibido e não altera o registro recebido', () => {
  const before = structuredClone(record);
  const changes = buildEditorChanges(record, { titulo: 'Título revisado', 'identificacao.serie': record.identificacao.serie, 'identificacao.valor_facial.valor': String(record.identificacao.valor_facial.valor) }, record.fontes);
  assert.deepEqual(changes, { titulo: 'Título revisado' });
  assert.deepEqual(record, before);
});

test('editor não converte valor facial numérico inalterado em texto', () => {
  assert.deepEqual(buildEditorChanges(record, { 'identificacao.valor_facial.valor': '20' }, record.fontes), {});
});

test('editor envia somente campo acessível alt e preserva caminhos de fotografias', () => {
  const changes = buildEditorChanges(record, { 'imagens.alt': 'Descrição conferida', 'imagens.frente': '/outro.webp', 'publicacao.status': 'publicado', id: 'SEL-000099' }, record.fontes);
  assert.deepEqual(changes, { imagens: { alt: 'Descrição conferida' } });
});

test('quantidade ausente continua ausente e não é presumida como uma unidade', () => {
  assert.deepEqual(buildEditorChanges(record, { 'exemplar.quantidade': '' }, record.fontes), {});
  assert.equal('quantidade' in record.exemplar, false);
});

test('repetidos exigem contagem inteira e confirmação do exemplar de melhor conservação', () => {
  for (const quantity of ['0', '-1', '1.5', '2e1', 'x', '9007199254740993']) assert.throws(() => buildEditorChanges(record, { 'exemplar.quantidade': quantity }, record.fontes), /quantidade/);
  assert.throws(() => buildEditorChanges(record, { 'exemplar.quantidade': '2' }, record.fontes), /melhor conservação/);
  assert.deepEqual(buildEditorChanges(record, { 'exemplar.quantidade': '2', 'exemplar.melhor_conservacao': 'on' }, record.fontes), { exemplar: { quantidade: 2, criterio_selecao: 'melhor_conservacao' } });
});

test('quantidade registrada não desaparece ao limpar o formulário', () => {
  const existing = structuredClone(record); existing.exemplar.quantidade = 1;
  assert.throws(() => buildEditorChanges(existing, { 'exemplar.quantidade': '' }, existing.fontes), /já foi registrada/);
});

test('temas aceitam linhas e emissão desconhecida pode ser anulada sem apagar ressalvas', () => {
  assert.equal(fieldValue(record, 'identificacao.tema'), record.identificacao.tema.join('\n'));
  assert.deepEqual(buildEditorChanges(record, { 'identificacao.tema': ' Tema A \n\nTema B ', 'emissao.ano': '' }, record.fontes), { identificacao: { tema: ['Tema A', 'Tema B'] }, emissao: { ano: null } });
});

test('preview de rascunho usa endpoint administrativo e rejeita identificador ou papel inválido', () => {
  assert.equal(privateAssetUrl(record.id, 'frente', digest), '/api/admin/selos/SEL-000001/assets/frente?v=' + digest);
  assert.throws(() => privateAssetUrl('../SEL-000001', 'frente'), /inválida/);
  assert.throws(() => privateAssetUrl(record.id, 'original'), /inválida/);
});

test('upload conserva bytes originais no FormData e usa revisão completa do registro', async () => {
  const form = buildMediaFormData(file, 'frente', digest, '2', '3');
  assert.equal(form.get('papel'), 'frente');
  assert.equal(form.get('expected_digest'), digest);
  assert.equal(form.get('expected_updated_at'), null);
  assert.equal(form.get('crop_x'), '2'); assert.equal(form.get('crop_y'), '3');
  assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
});

test('upload bloqueia digest ausente e recorte inválido antes do envio', () => {
  assert.throws(() => buildMediaFormData(file, 'frente', ''), /Recarregue/);
  for (const value of ['-1', '1.5', 'NaN', '9007199254740993']) assert.throws(() => buildMediaFormData(file, 'card', digest, value, '0'), /recortes/);
  assert.throws(() => buildMediaFormData(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png'), 'frente', digest), /5 MiB/);
});

test('schema mantém os sete registros sem exigir contagens não comprovadas', async () => {
  for (let sequence = 1; sequence <= 7; sequence++) {
    const id = 'SEL-' + String(sequence).padStart(6, '0');
    const current = JSON.parse(await readFile(new URL('../src/data/selos/' + id + '.json', import.meta.url), 'utf8'));
    assert.equal(validateSeloSchema(current).valid, true, id);
  }
});

test('schema protege regra de repetidos também fora da interface', () => {
  const candidate = structuredClone(record);
  candidate.exemplar.quantidade = 2;
  assert.equal(validateSeloSchema(candidate).valid, false);
  candidate.exemplar.criterio_selecao = 'melhor_conservacao';
  assert.equal(validateSeloSchema(candidate).valid, true);
  candidate.exemplar.quantidade = 0;
  assert.equal(validateSeloSchema(candidate).valid, false);
});
