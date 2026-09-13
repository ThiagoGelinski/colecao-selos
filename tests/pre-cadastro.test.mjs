import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestStamp } from '../src/lib/admin/pre-cadastro.mjs';
const env = { GPT_PRECADASTRO_ENABLED: 'true', OPENAI_API_KEY: 'fixture-only', OPENAI_API_MODEL: 'fixture-model' };
const images = [{ side: 'frente', mime: 'image/png', bytes: Buffer.from('original-test-bytes') }];
const proposal = { pais: 'Brasil', tema: null, valor_facial: null, unidade: null, ano: null, observacao: 'Conferir identificação.', campos_baixa_confianca: [], confiancas: { pais: 'media', tema: 'pendente', valor_facial: 'pendente', unidade: 'pendente', ano: 'pendente' } };
const completed = data => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] }));
test('pré-cadastro sem chave ou habilitação mantém manual sem chamada externa', async () => {
  for (const config of [{}, { ...env, OPENAI_API_KEY: '' }, { ...env, GPT_PRECADASTRO_ENABLED: 'false' }]) {
    const result = await suggestStamp(images, { env: config, fetchImpl: () => { throw new Error('Não chamar'); } });
    assert.equal(result.status, 'fallback'); assert.equal(result.configured, false);
  }
});
test('análise envia bytes sem alteração e só retorna proposta com revisão humana', async () => {
  const original = Buffer.from(images[0].bytes);
  const result = await suggestStamp(images, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.tools, undefined);
    assert.equal(body.text.format.strict, true);
    const sent = body.input[0].content.find(item => item.type === 'input_image').image_url;
    assert.deepEqual(Buffer.from(sent.split(',')[1], 'base64'), original);
    return completed(proposal);
  } });
  assert.equal(result.status, 'suggested'); assert.equal(result.human_review_required, true);
  assert.equal(result.data.ano, null); assert.ok(result.data.campos_baixa_confianca.some(item => item.field === 'ano'));
  assert.deepEqual(images[0].bytes, original); assert.equal(JSON.stringify(result).includes(env.OPENAI_API_KEY), false);
});
test('falha, recusa e resposta fora do contrato mantêm cadastro manual sem vazar erro', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('secret-error-fixture'); },
    async () => new Response('secret-error-fixture', { status: 500 }),
    async () => completed({ ...proposal, publicacao: { status: 'publicado' } }),
    async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'x' }] }] })),
    async () => new Response(JSON.stringify({ status: 'incomplete', output: [] }))
  ]) {
    const result = await suggestStamp(images, { env, fetchImpl });
    assert.equal(result.status, 'fallback'); assert.equal(JSON.stringify(result).includes('secret-error-fixture'), false);
  }
});
test('segredo não é enviado a host alternativo; TIFF mantém fallback sem converter original', async () => {
  let called = false; const fetchImpl = async () => { called = true; return completed(proposal); };
  assert.equal((await suggestStamp(images, { env: { ...env, OPENAI_API_URL: 'https://example.com/v1' }, fetchImpl })).status, 'fallback');
  assert.equal((await suggestStamp([{ ...images[0], mime: 'image/tiff' }], { env, fetchImpl })).status, 'fallback');
  assert.equal(called, false);
});
