import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { catalogStoreName, readJson } from '../src/lib/catalogo/io.mjs';

test('Seleção explícita de geração do catálogo preserva stores legados', async t => {
  await t.test('default mantém compatibilidade com store legado', () => {
    assert.equal(catalogStoreName({}),'colecao-selos-catalogo');
    assert.equal(catalogStoreName({CATALOG_BLOB_STORE:''}),'colecao-selos-catalogo');
    assert.equal(catalogStoreName({CATALOG_BLOB_STORE:'colecao-selos-catalogo'}),'colecao-selos-catalogo');
  });
  await t.test('geração recuperada exige nome exato permitido', () => {
    assert.equal(catalogStoreName({CATALOG_BLOB_STORE:'colecao-selos-catalogo-v2'}),'colecao-selos-catalogo-v2');
    assert.equal(catalogStoreName({CATALOG_BLOB_STORE:' colecao-selos-catalogo-v2 '}),'colecao-selos-catalogo-v2');
  });
  await t.test('nome incorreto e stores de credenciais, originais e publicação são rejeitados', () => {
    for(const name of ['colecao-selos-catalogo-v3','colecao-selos-originais','colecao-selos-publicacao','colecao-selos-admin','../catalogo','store-arbitrario']) {
      assert.throws(() => catalogStoreName({CATALOG_BLOB_STORE:name}),error=>error.code==='CATALOG_STORE_INVALID' && error.status===503);
    }
  });
  await t.test('configuração inválida bloqueia I/O antes de consultar ou escrever no storage', async () => {
    const priorName=process.env.CATALOG_BLOB_STORE, priorMock=globalThis.__MOCK_BLOB_STORE, priorEngine=globalThis.__MOCK_NETLIFY_ENV;
    let calls=0;
    process.env.CATALOG_BLOB_STORE='nome-nao-permitido';
    globalThis.__MOCK_NETLIFY_ENV=true;
    globalThis.__MOCK_BLOB_STORE={get:async()=>{calls++;return null;},setJSON:async()=>{calls++;}};
    try {
      await assert.rejects(readJson(path.join(process.cwd(),'src/data/selos/SEL-000001.json')),{code:'CATALOG_STORE_INVALID'});
      assert.equal(calls,0);
    } finally {
      if(priorName===undefined)delete process.env.CATALOG_BLOB_STORE;else process.env.CATALOG_BLOB_STORE=priorName;
      globalThis.__MOCK_BLOB_STORE=priorMock;globalThis.__MOCK_NETLIFY_ENV=priorEngine;
    }
  });
  await t.test('store v2 vazio permite painel ler os sete selos oficiais sem gravar nem importar legado', async () => {
    const priorName=process.env.CATALOG_BLOB_STORE, priorMock=globalThis.__MOCK_BLOB_STORE, priorEngine=globalThis.__MOCK_NETLIFY_ENV;
    process.env.CATALOG_BLOB_STORE='colecao-selos-catalogo-v2';
    globalThis.__MOCK_NETLIFY_ENV=true;
    globalThis.__MOCK_BLOB_STORE={
      get:async()=>null,getWithMetadata:async()=>null,getMetadata:async()=>null,list:async()=>({blobs:[]}),
      setJSON:async()=>{throw Error('Consulta inicial não deve gravar no novo store');},
      set:async()=>{throw Error('Fotografias do Git devem permanecer somente no baseline');},
    };
    try {
      const { getAdminStamps } = await import('../src/lib/admin/catalog-service.ts');
      const result=await getAdminStamps({pageSize:20});
      assert.deepEqual(result.items.map(item=>item.id),Array.from({length:7},(_,i)=>'SEL-'+String(i+1).padStart(6,'0')));
      assert.ok(result.items.every(item=>item.status==='publicado' && item.validacao.valida));
    } finally {
      if(priorName===undefined)delete process.env.CATALOG_BLOB_STORE;else process.env.CATALOG_BLOB_STORE=priorName;
      globalThis.__MOCK_BLOB_STORE=priorMock;globalThis.__MOCK_NETLIFY_ENV=priorEngine;
    }
  });
  await t.test('troca de configuração é lida a cada seleção sem manter nome anterior', () => {
    const environment={CATALOG_BLOB_STORE:'colecao-selos-catalogo'};
    assert.equal(catalogStoreName(environment),'colecao-selos-catalogo');
    environment.CATALOG_BLOB_STORE='colecao-selos-catalogo-v2';
    assert.equal(catalogStoreName(environment),'colecao-selos-catalogo-v2');
    environment.CATALOG_BLOB_STORE='colecao-selos-catalogo';
    assert.equal(catalogStoreName(environment),'colecao-selos-catalogo');
  });
});
