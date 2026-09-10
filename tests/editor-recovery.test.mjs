import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { editCandidate, editRecord } from '../src/lib/admin/editor.mjs';
import { jsonDigest } from '../src/lib/catalogo/digest.mjs';
import { inspectEditorialHistory } from '../src/lib/catalogo/history.mjs';
import { validateSeloData } from '../src/lib/selo-validation.mjs';

const original = JSON.parse(await readFile(new URL('../src/data/selos/SEL-000001.json', import.meta.url), 'utf8'));
const user = { username: 'revisor-de-teste', role: 'administrador' };
const instant = '2026-09-10T15:00:00.000Z';
const rejected = (operation, code) => assert.throws(operation, error => error.code === code && error.status === 422);

test('Editor preserva identidade e protocolo editorial', async t => {
  await t.test('campos de identidade, auditoria, aprovação e histórico são protegidos', () => {
    for (const field of ['id','slug','schema_version','auditoria','aprovacao_humana','historico_editorial','publicacao']) {
      rejected(() => editCandidate(original,{[field]:'não autorizado'},user,instant), 'PROTECTED_FIELD');
    }
  });
  await t.test('caminhos de fotografias e canonical não são editáveis', () => {
    for (const role of ['frente','verso','card','thumb']) rejected(() => editCandidate(original,{imagens:{[role]:'/arbitrario.webp'}},user,instant),'PROTECTED_FIELD');
    rejected(() => editCandidate(original,{seo:{canonical_path:'/outro-endereco'}},user,instant),'PROTECTED_FIELD');
  });
  await t.test('merge parcial mantém campos irmãos e invalida aprovação com histórico completo', () => {
    const before = structuredClone(original);
    const changed = editCandidate(original,{identificacao:{pais:'Brasil (revisão documental)'},imagens:{alt:'Descrição fotográfica revisada'}},user,instant);
    assert.equal(changed.identificacao.pais,'Brasil (revisão documental)');
    assert.equal(changed.identificacao.serie, original.identificacao.serie);
    assert.deepEqual(changed.identificacao.personagem, original.identificacao.personagem);
    assert.equal(changed.imagens.frente, original.imagens.frente);
    assert.equal(changed.publicacao.status,'revisao_necessaria');
    assert.equal(changed.publicacao.apto_para_publicacao,false);
    assert.equal(changed.aprovacao_humana.status,'revogado');
    assert.equal(changed.aprovacao_humana.aprovado_por,original.aprovacao_humana.aprovado_por);
    assert.deepEqual(changed.historico_editorial.slice(0,-1),original.historico_editorial);
    assert.equal(changed.historico_editorial.at(-1).tipo,'invalidacao');
    assert.equal(changed.historico_editorial.at(-1).responsavel,user.username);
    assert.equal(changed.auditoria.ultima_revisao,'2026-09-10');
    assert.notEqual(changed.auditoria.versao,original.auditoria.versao);
    assert.deepEqual(original,before,'Fonte real nunca é alterada pelo candidato');
    assert.equal(validateSeloData(changed).valid,true);
    assert.deepEqual(inspectEditorialHistory(changed).errors,[]);
  });
  await t.test('edição subsequente preserva invalidação anterior e não reaprova', () => {
    const first = editCandidate(original,{titulo:'Título revisado para teste'},user,instant);
    const second = editCandidate(first,{descricao_curta:'Descrição revisada para testar histórico.'},user,'2026-09-10T15:00:01.000Z');
    assert.deepEqual(second.historico_editorial.slice(0,-1),first.historico_editorial);
    assert.equal(second.historico_editorial.at(-1).tipo,'rejeicao');
    assert.equal(second.aprovacao_humana.status,'revogado');
    assert.deepEqual(inspectEditorialHistory(second).errors,[]);
  });
  await t.test('quantidade repetida exige escolha por melhor conservação sem alterar fotos', () => {
    rejected(() => editCandidate(original,{exemplar:{quantidade:2}},user,instant),'VALIDATION_ERROR');
    const changed = editCandidate(original,{exemplar:{quantidade:2,criterio_selecao:'melhor_conservacao',observacao:'Exemplar selecionado após comparação humana.'}},user,instant);
    assert.equal(changed.exemplar.quantidade,2);
    assert.equal(changed.exemplar.criterio_selecao,'melhor_conservacao');
    assert.deepEqual(changed.imagens,original.imagens);
    rejected(() => editCandidate(original,{exemplar:{quantidade:0}},user,instant),'VALIDATION_ERROR');
    rejected(() => editCandidate(original,{exemplar:{quantidade:2.5}},user,instant),'VALIDATION_ERROR');
  });
  await t.test('entrada vazia, inválida e poluição de protótipo são rejeitadas', () => {
    for (const input of [null,[],{},'texto']) rejected(() => editCandidate(original,input,user,instant),'INVALID_CHANGES');
    rejected(() => editCandidate(original,JSON.parse('{"identificacao":{"__proto__":{"injetado":true}}}'),user,instant),'INVALID_FIELD');
    rejected(() => editCandidate(original,{titulo:42},user,instant),'VALIDATION_ERROR');
    assert.equal({}.injetado,undefined);
  });
  await t.test('edição idêntica não inventa revisão e digest independe da ordem de chaves', () => {
    assert.equal(editCandidate(original,{titulo:original.titulo},user,instant),original);
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assert.equal(jsonDigest(reordered),jsonDigest(original));
    assert.notEqual(jsonDigest({...original,titulo:'Outro'}),jsonDigest(original));
  });
});

test('Edição remota usa hash completo para impedir colisões no mesmo dia', async t => {
  let current = structuredClone(original);
  let etag = 'record-1';
  let writes = 0;
  globalThis.__MOCK_NETLIFY_ENV = true;
  globalThis.__MOCK_BLOB_STORE = {
    getWithMetadata: async () => ({data:structuredClone(current),etag,metadata:{}}),
    setJSON: async (_key,value,options) => {
      if(options.onlyIfMatch !== etag) return {modified:false};
      current=structuredClone(value); etag='record-'+(++writes+1); return {modified:true,etag};
    },
  };
  t.after(() => { globalThis.__MOCK_NETLIFY_ENV=false; globalThis.__MOCK_BLOB_STORE=null; });
  await t.test('perfil consulta não pode editar e falta de digest bloqueia antes de gravar', async () => {
    await assert.rejects(editRecord(original.id,jsonDigest(original),{titulo:'Proibido'},{username:'leitor',role:'consulta'}),{code:'FORBIDDEN'});
    await assert.rejects(editRecord(original.id,null,{titulo:'Sem versão'},user),{code:'DIGEST_REQUIRED'});
    assert.equal(writes,0);
  });
  await t.test('segunda edição baseada no mesmo snapshot é rejeitada mesmo com data igual', async () => {
    const expected=jsonDigest(current);
    const updated=await editRecord(original.id,expected,{titulo:'Edição temporária em memória'},user);
    assert.equal(updated.record_digest,jsonDigest(current));
    const preserved=structuredClone(current);
    await assert.rejects(editRecord(original.id,expected,{titulo:'Perda de atualização'},user),{code:'RECORD_CONFLICT'});
    assert.equal(writes,1);
    assert.deepEqual(current,preserved);
  });
});
