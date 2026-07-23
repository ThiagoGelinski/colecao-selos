import test from 'node:test';
import assert from 'node:assert/strict';
import { accessDecision } from '../src/lib/admin/access.mjs';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../src/lib/admin/api.mjs';
import { hashPassword, verifyCredentials } from '../src/lib/admin/auth.mjs';
import { AuthConfigurationError, loadAuthConfig } from '../src/lib/admin/config.mjs';
import { createSession, sessionCookieOptions, verifySession } from '../src/lib/admin/session.mjs';
import { clearRateLimits, consumeRateLimit } from '../src/lib/admin/rate-limit.mjs';

const secret = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
async function config() {
  return loadAuthConfig({ ADMIN_USERNAME: 'curador', ADMIN_PASSWORD_HASH: await hashPassword('senha-segura-de-teste'), ADMIN_SESSION_SECRET: secret, ADMIN_ROLE: 'revisor', ADMIN_SESSION_TTL_SECONDS: '3600' });
}

test('rotas administrativas e APIs exigem sessão, login e catálogo permanecem públicos', () => {
  assert.equal(accessDecision('/admin', false).action, 'redirect-login');
  assert.equal(accessDecision('/admin/selos', false).action, 'redirect-login');
  assert.equal(accessDecision('/api/admin/dashboard', false).action, 'json-unauthorized');
  assert.equal(accessDecision('/admin/login', false).action, 'allow');
  assert.equal(accessDecision('/api/admin/auth/login', false).action, 'allow');
  assert.equal(accessDecision('/catalogo', false).action, 'allow');
  assert.equal(accessDecision('/admin', true).action, 'allow');
});

test('autenticação aceita credencial válida e recusa usuário ou senha incorretos', async () => {
  const auth = await config();
  assert.equal(await verifyCredentials('curador', 'senha-segura-de-teste', auth), true);
  assert.equal(await verifyCredentials('outro', 'senha-segura-de-teste', auth), false);
  assert.equal(await verifyCredentials('curador', 'senha-incorreta', auth), false);
});

test('sessão assinada expira, detecta adulteração e carrega perfil futuro', async () => {
  const auth = await config(); const now = Date.now(); const session = await createSession(auth, now);
  assert.deepEqual((await verifySession(session.token, auth, now + 1000)).user, { username: 'curador', role: 'revisor' });
  assert.equal((await verifySession(`${session.token}x`, auth, now)).valid, false);
  assert.equal((await verifySession(session.token, auth, now + 3_601_000)).reason, 'expired');
});

test('logout pode remover cookie com as mesmas proteções de sessão', () => {
  assert.deepEqual(sessionCookieOptions(0), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
});

test('falhas de configuração são explícitas internamente e seguras na API', async () => {
  assert.throws(() => loadAuthConfig({}), AuthConfigurationError);
  assert.throws(() => loadAuthConfig({ ADMIN_USERNAME: 'x', ADMIN_PASSWORD_HASH: 'invalido', ADMIN_SESSION_SECRET: secret }), /formato inválido/);
  const response = safeApiFailure(new AuthConfigurationError('ADMIN_SESSION_SECRET=valor-secreto'));
  assert.equal(response.status, 503);
  const body = await response.text(); assert.doesNotMatch(body, /valor-secreto/); assert.match(body, /Autenticação administrativa indisponível/);
});

test('respostas JSON seguem contrato sem cache', async () => {
  const success = jsonResponse(apiPayload({ total: 1 })); const failure = jsonResponse(apiError('INVALID_ID', 'Inválido.'), 400);
  assert.equal(success.headers.get('cache-control'), 'no-store'); assert.deepEqual(await success.json(), { ok: true, data: { total: 1 } });
  assert.deepEqual(await failure.json(), { ok: false, error: { code: 'INVALID_ID', message: 'Inválido.' } });
});

test('limite básico bloqueia excesso sem registrar credenciais', () => {
  clearRateLimits(); assert.equal(consumeRateLimit('ip:teste', { limit: 2 }, 100).allowed, true); assert.equal(consumeRateLimit('ip:teste', { limit: 2 }, 101).allowed, true); assert.equal(consumeRateLimit('ip:teste', { limit: 2 }, 102).allowed, false);
});



