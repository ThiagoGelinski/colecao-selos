import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { accessDecision } from '../src/lib/admin/access.mjs';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../src/lib/admin/api.mjs';
import { authenticateAdmin, changeAdminPassword } from '../src/lib/admin/auth-service.mjs';
import { hashPassword, validateNewPassword, verifyCredentials } from '../src/lib/admin/auth.mjs';
import { AuthConfigurationError, loadAuthConfig, loadBootstrapPassword } from '../src/lib/admin/config.mjs';
import { AdminStorageError, createMemoryAdminStore, loadAdminCredentials } from '../src/lib/admin/credential-store.mjs';
import { createSession, sessionCookieOptions, verifySession } from '../src/lib/admin/session.mjs';
import { clearRateLimits, consumeRateLimit } from '../src/lib/admin/rate-limit.mjs';

const secret = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
const bootstrapPassword = 'bootstrap-temporario-exclusivo-2026';
const bootstrap = { env: { ADMIN_BOOTSTRAP_PASSWORD: bootstrapPassword } };
const config = () => loadAuthConfig({ ADMIN_SESSION_SECRET: secret, ADMIN_ROLE: 'administrador', ADMIN_SESSION_TTL_SECONDS: '3600' });

test('rotas administrativas exigem sessão e o catálogo público continua acessível', () => {
  assert.equal(accessDecision('/admin', false).action, 'redirect-login'); assert.equal(accessDecision('/api/admin/dashboard', false).action, 'json-unauthorized');
  assert.equal(accessDecision('/admin/login', false).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/login', false).action, 'allow'); assert.equal(accessDecision('/catalogo', false).action, 'allow');
});

test('primeiro bootstrap usa a senha configurada no ambiente e persiste somente hash', async () => {
  const store = createMemoryAdminStore(); const auth = await authenticateAdmin(store, 'admin', bootstrapPassword, bootstrap); const snapshot = store.snapshot();
  assert.equal(auth.valid, true); assert.equal(auth.credentials.bootstrap_required, true); assert.equal(auth.credentials.credential_version, 1); assert.equal(snapshot.state.bootstrap_secret_version, 1);
  assert.match(snapshot.credentials.password_hash, /^scrypt\$/); assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(bootstrapPassword));
});

test('ausência ou senha ambiental curta no primeiro acesso falha fechado sem criar estado', async () => {
  const missing = createMemoryAdminStore(); await assert.rejects(() => authenticateAdmin(missing, 'admin', 'qualquer-valor', { env: {} }), AuthConfigurationError); assert.deepEqual(missing.snapshot(), { credentials: null, state: null });
  const short = createMemoryAdminStore(); await assert.rejects(() => loadAdminCredentials(short, { env: { ADMIN_BOOTSTRAP_PASSWORD: 'curta' } }), /ao menos 16 caracteres/); assert.deepEqual(short.snapshot(), { credentials: null, state: null });
});

test('senha de bootstrap incorreta é recusada', async () => {
  const store = createMemoryAdminStore(); const auth = await authenticateAdmin(store, 'admin', 'segredo-temporario-incorreto', bootstrap); assert.equal(auth.valid, false);
});

test('bootstrap bloqueia dashboard e APIs normais, mas permite troca, sessão e logout', () => {
  assert.equal(accessDecision('/admin', true, true).action, 'redirect-change-password'); assert.equal(accessDecision('/admin/selos', true, true).action, 'redirect-change-password');
  assert.equal(accessDecision('/admin/configuracoes', true, true).action, 'redirect-change-password'); assert.equal(accessDecision('/api/admin/dashboard', true, true).action, 'json-bootstrap-required');
  assert.equal(accessDecision('/admin/alterar-senha', true, true).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/change-password', true, true).action, 'allow');
  assert.equal(accessDecision('/api/admin/auth/session', true, true).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/logout', true, true).action, 'allow');
});

test('política recusa senha curta, igual ao usuário e confirmação divergente', () => {
  assert.equal(validateNewPassword('curta', 'curta', 'admin').code, 'PASSWORD_TOO_SHORT'); assert.equal(validateNewPassword('administrador', 'administrador', 'administrador').code, 'PASSWORD_NOT_ALLOWED');
  assert.equal(validateNewPassword('senha-definitiva-forte', 'outra-senha-forte', 'admin').code, 'PASSWORD_CONFIRMATION_MISMATCH');
});

test('troca recusa senha atual incorreta sem modificar o estado persistido', async () => {
  const store = createMemoryAdminStore(); await loadAdminCredentials(store, bootstrap); const before = store.snapshot(); const result = await changeAdminPassword(store, 'incorreta', 'senha-definitiva-forte', 'senha-definitiva-forte', 'administrador', bootstrap);
  assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_CURRENT_PASSWORD'); assert.deepEqual(store.snapshot(), before);
});

test('troca definitiva válida consome bootstrap e recusa a senha temporária', async () => {
  const store = createMemoryAdminStore(); const before = await loadAdminCredentials(store, bootstrap); const result = await changeAdminPassword(store, bootstrapPassword, 'senha-definitiva-forte', 'senha-definitiva-forte', 'administrador', bootstrap);
  assert.equal(result.ok, true); const snapshot = store.snapshot(); assert.equal(snapshot.credentials.bootstrap_required, false); assert.equal(snapshot.credentials.credential_version, 2); assert.equal(snapshot.state.bootstrap_consumed, true);
  assert.match(snapshot.credentials.password_hash, /^scrypt\$/); assert.doesNotMatch(JSON.stringify(snapshot), /senha-definitiva-forte|bootstrap-temporario-exclusivo-2026/);
  assert.equal((await authenticateAdmin(store, 'admin', bootstrapPassword, { env: {} })).valid, false); assert.equal((await authenticateAdmin(store, 'admin', 'senha-definitiva-forte', { env: {} })).valid, true); assert.notEqual(before.password_hash, snapshot.credentials.password_hash);
});

test('remoção ou alteração da variável após consumo não quebra login nem recria bootstrap', async () => {
  const store = createMemoryAdminStore(); await changeAdminPassword(store, bootstrapPassword, 'senha-definitiva-forte', 'senha-definitiva-forte', 'administrador', bootstrap); const before = store.snapshot();
  const withoutVariable = await authenticateAdmin(store, 'admin', 'senha-definitiva-forte', { env: {} }); const changedVariable = await authenticateAdmin(store, 'admin', 'senha-definitiva-forte', { env: { ADMIN_BOOTSTRAP_PASSWORD: 'outro-segredo-temporario-2026' } });
  assert.equal(withoutVariable.valid, true); assert.equal(changedVariable.valid, true); assert.deepEqual(store.snapshot(), before); assert.equal(store.snapshot().state.bootstrap_consumed, true); assert.equal(store.snapshot().credentials.bootstrap_required, false);
});

test('bootstrap legado ainda não consumido é migrado para o segredo ambiental', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const legacyHash = await hashPassword('valor-legado-inseguro');
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, updated_at: timestamp }); await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: legacyHash, bootstrap_required: true, credential_version: 1, updated_at: timestamp });
  const migrated = await loadAdminCredentials(store, bootstrap); assert.equal(migrated.credential_version, 2); assert.equal(migrated.state.bootstrap_secret_version, 1); assert.equal(await verifyCredentials('admin', 'valor-legado-inseguro', migrated), false); assert.equal(await verifyCredentials('admin', bootstrapPassword, migrated), true);
});

test('troca renova versão e invalida a sessão anterior', async () => {
  const store = createMemoryAdminStore(); const before = await loadAdminCredentials(store, bootstrap); const oldSession = await createSession(config(), before); const changed = await changeAdminPassword(store, bootstrapPassword, 'senha-definitiva-forte', 'senha-definitiva-forte', 'administrador', bootstrap); assert.equal(changed.ok, true);
  assert.equal((await verifySession(oldSession.token, config(), changed.credentials)).valid, false); const renewed = await createSession(config(), changed.credentials); assert.equal((await verifySession(renewed.token, config(), changed.credentials)).valid, true);
});

test('não existe derivação de senha fixa pública no código de autenticação', async () => {
  const source = `${await readFile(new URL('../src/lib/admin/auth.mjs', import.meta.url), 'utf8')}\n${await readFile(new URL('../src/lib/admin/credential-store.mjs', import.meta.url), 'utf8')}`;
  assert.doesNotMatch(source, /hashPassword\(\s*['"]admin['"]\s*\)/); assert.doesNotMatch(source, /derivePasswordHash\(\s*['"]admin['"]\s*\)/); assert.doesNotMatch(source, /hashBootstrapPassword/);
});

test('armazenamento indisponível falha fechado e não oferece fallback de bootstrap', async () => {
  const store = createMemoryAdminStore({ fail: true }); await assert.rejects(() => authenticateAdmin(store, 'admin', bootstrapPassword, bootstrap), AdminStorageError);
  const response = safeApiFailure(new AdminStorageError('detalhe-interno')); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /detalhe-interno|bootstrap-temporario/);
});

test('autenticação definitiva aceita credencial válida e recusa usuário incorreto', async () => {
  const credentials = { username: 'curador', passwordHash: await hashPassword('senha-segura-de-teste') }; assert.equal(await verifyCredentials('curador', 'senha-segura-de-teste', credentials), true); assert.equal(await verifyCredentials('outro', 'senha-segura-de-teste', credentials), false);
});

test('sessão assinada expira, detecta adulteração e preserva perfil', async () => {
  const credentials = { username: 'curador', credential_version: 3, bootstrap_required: false }; const now = Date.now(); const session = await createSession(config(), credentials, now);
  assert.deepEqual((await verifySession(session.token, config(), credentials, now + 1000)).user, { username: 'curador', role: 'administrador', bootstrapRequired: false }); assert.equal((await verifySession(`${session.token}x`, config(), credentials, now)).valid, false); assert.equal((await verifySession(session.token, config(), credentials, now + 3_601_000)).reason, 'expired');
});

test('logout continua removendo o cookie com as proteções da sessão', () => { assert.deepEqual(sessionCookieOptions(0), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 }); });

test('configuração de sessão e bootstrap mantém erros públicos seguros', async () => {
  assert.throws(() => loadAuthConfig({}), AuthConfigurationError); assert.doesNotThrow(() => config()); assert.equal(loadBootstrapPassword(bootstrap.env), bootstrapPassword);
  const response = safeApiFailure(new AuthConfigurationError('ADMIN_BOOTSTRAP_PASSWORD=valor-secreto')); assert.equal(response.status, 503); const body = await response.text(); assert.doesNotMatch(body, /valor-secreto/);
});

test('respostas JSON seguem contrato sem cache', async () => {
  const success = jsonResponse(apiPayload({ total: 1 })); const failure = jsonResponse(apiError('INVALID_ID', 'Inválido.'), 400); assert.equal(success.headers.get('cache-control'), 'no-store'); assert.deepEqual(await success.json(), { ok: true, data: { total: 1 } }); assert.deepEqual(await failure.json(), { ok: false, error: { code: 'INVALID_ID', message: 'Inválido.' } });
});

test('rate limit funciona para chaves de login e alteração sem armazenar senhas', () => {
  clearRateLimits(); assert.equal(consumeRateLimit('change-password:ip:admin', { limit: 2 }, 100).allowed, true); assert.equal(consumeRateLimit('change-password:ip:admin', { limit: 2 }, 101).allowed, true); assert.equal(consumeRateLimit('change-password:ip:admin', { limit: 2 }, 102).allowed, false);
});