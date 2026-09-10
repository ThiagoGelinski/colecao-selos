import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient, REPOSITORY } from '../src/lib/publicacao/github.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), token = 'token-ficticio-de-teste';
const file = 'src/data/selos/SEL-999812.json';
const bytes = Buffer.from('{"id":"SEL-999812"}\n');
const pr = {number:12,state:'open',draft:false,merged:false,changed_files:1,base:{ref:'main',repo:{full_name:REPOSITORY}},head:{sha:head,repo:{full_name:REPOSITORY}}};
function client(routes) {
  const requests=[];
  const fetcher=async (url,options) => {
    assert.ok(url.startsWith('https://api.github.com/repos/' + REPOSITORY));
    const endpoint=url.slice(('https://api.github.com/repos/' + REPOSITORY).length);
    requests.push({endpoint,method:options.method,body:options.body?JSON.parse(options.body):null,headers:options.headers});
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.ok(options.signal instanceof AbortSignal);
    const value=typeof routes === 'function' ? await routes(endpoint,options) : routes[options.method+' '+endpoint];
    if(value === undefined) throw Error('Unexpected mocked request: ' + options.method + ' ' + endpoint);
    if(value instanceof Response)return value;
    return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  };
  return {api:createGithubClient({token,fetcher}),requests};
}
const run = {id:20,path:'.github/workflows/ci.yml',head_sha:head,head_repository:{full_name:REPOSITORY},status:'completed',conclusion:'success',html_url:'https://github.com/'+REPOSITORY+'/actions/runs/20'};
const statusRoutes = (pull=pr,runs=[run],jobs=[{name:'Testes, auditoria e build',head_sha:head,conclusion:'success'}]) => ({
  'GET /pulls/12':pull,
  ['GET /actions/runs?head_sha='+head+'&event=pull_request&per_page=100']:{workflow_runs:runs},
  'GET /actions/runs/20/jobs?filter=latest&per_page=100':{jobs},
});

test('Cliente GitHub publica somente revisão verificada e CI vigente',async t => {
  await t.test('credencial ausente gera bloqueio configurável sem tentativa de rede',() => {
    assert.throws(() => createGithubClient({token:'',fetcher:()=>{throw Error('rede não autorizada');}}),{code:'PUBLICATION_NOT_CONFIGURED'});
  });
  await t.test('erros remotos não expõem credencial nem corpo remoto',async () => {
    const {api}=client({'GET /git/ref/heads/main':new Response('SECRET-REMOTE-BODY '+token,{status:403})});
    await assert.rejects(api.getMain(),error => error.code==='GITHUB_ERROR' && !error.message.includes(token) && !error.message.includes('SECRET-REMOTE-BODY'));
  });
  await t.test('Contents API maior que 1MiB usa Git Blob sem URL remota arbitrária',async () => {
    const {api,requests}=client({['GET /contents/'+file+'?ref='+base]:{type:'file',encoding:'none',sha:'blob-sha'},'GET /git/blobs/blob-sha':{encoding:'base64',size:2*1024*1024,content:bytes.toString('base64')}});
    assert.deepEqual(await api.readFile(file,base),bytes);
    assert.equal(requests.length,2);
  });
  await t.test('review aceita filho direto da base com bytes e caminhos exatos',async () => {
    const {api}=client({['GET /git/commits/'+head]:{parents:[{sha:base}]},['GET /compare/'+base+'...'+head]:{files:[{filename:file,status:'added'}]},['GET /contents/'+file+'?ref='+head]:{type:'file',encoding:'base64',content:bytes.toString('base64')}});
    await api.verifyReview({pr,base_sha:base,files:[{path:file,bytes}]});
  });
  await t.test('base de revisão trocada é bloqueada antes de ler arquivos',async () => {
    const {api,requests}=client({['GET /git/commits/'+head]:{parents:[{sha:'c'.repeat(40)}]}});
    await assert.rejects(api.verifyReview({pr,base_sha:base,files:[{path:file,bytes}]}),{code:'REVIEW_CHANGED'});
    assert.equal(requests.length,1);
  });
  await t.test('alterações fora da allowlist, remoção e bytes diferentes bloqueiam',async () => {
    for(const invalid of [{filename:'.github/workflows/ci.yml',status:'modified'},{filename:file,status:'removed'}]) {
      const {api}=client({['GET /git/commits/'+head]:{parents:[{sha:base}]},['GET /compare/'+base+'...'+head]:{files:[invalid]}});
      await assert.rejects(api.verifyReview({pr,base_sha:base,files:[{path:file,bytes}]}),{code:'REVIEW_CHANGED'});
    }
    const {api}=client({['GET /git/commits/'+head]:{parents:[{sha:base}]},['GET /compare/'+base+'...'+head]:{files:[{filename:file,status:'modified'}]},['GET /contents/'+file+'?ref='+head]:{type:'file',encoding:'base64',content:Buffer.from('adulterado').toString('base64')}});
    await assert.rejects(api.verifyReview({pr,base_sha:base,files:[{path:file,bytes}]}),{code:'REVIEW_CHANGED'});
  });
  await t.test('CI exige PR aberta do mesmo repositório, head e job esperado',async () => {
    assert.equal((await client(statusRoutes()).api.reviewStatus(12,head)).ci_passed,true);
    assert.equal((await client(statusRoutes(pr,[run],[{name:'Teste diferente',head_sha:head,conclusion:'success'}])).api.reviewStatus(12,head)).ci_passed,false);
    for(const changed of [{...pr,head:{...pr.head,sha:base}},{...pr,base:{...pr.base,repo:{full_name:'outro/repositorio'}}}]) {
      await assert.rejects(client(statusRoutes(changed)).api.reviewStatus(12,head),{code:'REVIEW_CHANGED'});
    }
  });
  await t.test('PR fechada ou draft não reutiliza teste antigo aprovado',async () => {
    for(const pull of [{...pr,state:'closed'},{...pr,draft:true}]) {
      const {api,requests}=client(statusRoutes(pull));
      assert.equal((await api.reviewStatus(12,head)).ci_passed,false);
      assert.equal(requests.length,1);
    }
  });
  await t.test('workflow distinto e execução mais recente falha não autorizam publicação',async () => {
    const unrelated={...run,path:'.github/workflows/outro.yml'};
    assert.equal((await client(statusRoutes(pr,[unrelated])).api.reviewStatus(12,head)).ci_passed,false);
    const latest={...run,id:21,conclusion:'failure'};
    assert.equal((await client(statusRoutes(pr,[run,latest])).api.reviewStatus(12,head)).ci_passed,false);
  });
  await t.test('main avançada não recebe PATCH e corrida de referência é fechada',async () => {
    const changed=client({'GET /git/ref/heads/main':{object:{sha:'c'.repeat(40)}}});
    await assert.rejects(changed.api.publish({head_sha:head,base_sha:base}),{code:'BASE_CHANGED'});
    assert.equal(changed.requests.length,1);
    const race=client({'GET /git/ref/heads/main':{object:{sha:base}},'PATCH /git/refs/heads/main':new Response('{}',{status:422})});
    await assert.rejects(race.api.publish({head_sha:head,base_sha:base}),{code:'GITHUB_ERROR'});
    assert.deepEqual(race.requests[1].body,{sha:head,force:false});
    assert.equal(race.requests.length,2);
  });
  await t.test('publicação usa exatamente fast-forward sem force',async () => {
    const {api,requests}=client({'GET /git/ref/heads/main':{object:{sha:base}},'PATCH /git/refs/heads/main':{object:{sha:head}}});
    assert.deepEqual(await api.publish({head_sha:head,base_sha:base}),{sha:head});
    assert.deepEqual(requests[1].body,{sha:head,force:false});
  });
  await t.test('retry de criação reaproveita PR existente sem novos blobs ou commits',async () => {
    const hash='d'.repeat(64),id='SEL-999812';
    const endpoint='/pulls?state=all&head=ThiagoGelinski:publicacao/'+id+'-'+hash.slice(0,24)+'&base=main';
    const {api,requests}=client({['GET '+endpoint]:[pr]});
    assert.deepEqual(await api.createReview({id,snapshot_hash:hash,base_sha:base,files:[{path:file,bytes}],reviewer:'revisor'}),pr);
    assert.equal(requests.length,1);
  });
});
