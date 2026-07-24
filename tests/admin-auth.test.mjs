import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { accessDecision } from '../src/lib/admin/access.mjs';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../src/lib/admin/api.mjs';
import { authenticateAdmin, changeAdminPassword, completeFirstAccess } from '../src/lib/admin/auth-service.mjs';
import { hashPassword, normalizeAdminUsername, validateNewPassword, verifyCredentials } from '../src/lib/admin/auth.mjs';
import { AuthConfigurationError, loadAuthConfig } from '../src/lib/admin/config.mjs';
import { AdminStorageError, createMemoryAdminStore, loadAdminCredentials } from '../src/lib/admin/credential-store.mjs';
import { logAdminAuth } from '../src/lib/admin/logging.mjs';
import { createSession, sessionCookieOptions, verifySession } from '../src/lib/admin/session.mjs';
import { clearRateLimits, consumeRateLimit } from '../src/lib/admin/rate-limit.mjs';

const secret = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
function legacyPasswordHash(password) { const salt = randomBytes(16); const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); return `scrypt$${16384}$${8}$${1}$${salt.toString('base64url')}$${derived.toString('base64url')}`; }
const config = () => loadAuthConfig({ ADMIN_SESSION_SECRET: secret, ADMIN_ROLE: 'administrador', ADMIN_SESSION_TTL_SECONDS: '3600' });
async function definitiveStore() { const store = createMemoryAdminStore(); const result = await completeFirstAccess(store, 'Curador.Principal', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(result.ok, true); return { store, credentials: result.credentials }; }

test('admin/123456 funciona somente antes do cadastro definitivo', async () => {
  const store = createMemoryAdminStore(); const auth = await authenticateAdmin(store, 'admin', '123456'); assert.equal(auth.valid, true); assert.equal(auth.credentials.bootstrap_required, true); assert.equal(auth.credentials.bootstrap_consumed, false);
});

test('senha inicial diferente é recusada com resposta de autenticação genérica', async () => {
  const store = createMemoryAdminStore(); assert.equal((await authenticateAdmin(store, 'admin', '654321')).valid, false); const response = jsonResponse(apiError('INVALID_CREDENTIALS', 'Usuário ou senha inválidos.'), 401); assert.doesNotMatch(await response.text(), /123456/);
});

test('dashboard e APIs normais permanecem bloqueados durante o bootstrap', () => {
  assert.equal(accessDecision('/admin', true, true).action, 'redirect-first-access'); assert.equal(accessDecision('/admin/selos', true, true).action, 'redirect-first-access'); assert.equal(accessDecision('/admin/configuracoes', true, true).action, 'redirect-first-access'); assert.equal(accessDecision('/admin/alterar-senha', true, true).action, 'redirect-first-access'); assert.equal(accessDecision('/api/admin/dashboard', true, true).action, 'json-bootstrap-required');
});

test('primeiro acesso, sessão e logout são permitidos durante o bootstrap', () => {
  assert.equal(accessDecision('/admin/primeiro-acesso', true, true).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/first-access', true, true).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/session', true, true).action, 'allow'); assert.equal(accessDecision('/api/admin/auth/logout', true, true).action, 'allow');
});

test('catálogo público continua funcionando sem sessão', () => {
  assert.equal(accessDecision('/catalogo', false).action, 'allow'); assert.equal(accessDecision('/selos/brasil-campos-salles-20-centavos-1967', false).action, 'allow'); assert.equal(accessDecision('/admin', false).action, 'redirect-login');
});

test('novo usuário é normalizado e usuário inválido é recusado', async () => {
  assert.equal(normalizeAdminUsername('  Curador.Principal  '), 'curador.principal'); for (const invalid of ['', 'abc', 'nome com espaço', 'usuário', 'a'.repeat(65)]) assert.equal(normalizeAdminUsername(invalid), null);
  const store = createMemoryAdminStore(); const result = await completeFirstAccess(store, 'x!', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_USERNAME');
});

test('senha curta e 123456 não podem ser senha definitiva', () => {
  assert.equal(validateNewPassword('curta', 'curta', 'curador').valid, false); assert.equal(validateNewPassword('123456', '123456', 'curador').valid, false);
});

test('senha igual ao login e confirmação divergente são recusadas', () => {
  assert.equal(validateNewPassword('curadorprincipal', 'curadorprincipal', 'curadorprincipal').code, 'PASSWORD_NOT_ALLOWED'); assert.equal(validateNewPassword('senha-definitiva-forte', 'outra-senha-forte', 'curador').code, 'PASSWORD_CONFIRMATION_MISMATCH');
});

test('cadastro definitivo salva username normalizado e consome bootstrap', async () => {
  const { store, credentials } = await definitiveStore(); const snapshot = store.snapshot(); assert.equal(credentials.username, 'curador.principal'); assert.equal(credentials.bootstrap_required, false); assert.equal(credentials.bootstrap_consumed, true); assert.equal(snapshot.state.bootstrap_consumed, true); assert.equal(snapshot.credentials.credential_version, 2);
});

test('somente hash é persistido, sem senha definitiva em texto puro', async () => {
  const { store } = await definitiveStore(); const serialized = JSON.stringify(store.snapshot()); assert.match(store.snapshot().credentials.password_hash, /^scrypt\$/); assert.doesNotMatch(serialized, /senha-definitiva-forte/);
});

test('novo username e nova senha autenticam após o cadastro', async () => {
  const { store } = await definitiveStore(); assert.equal((await authenticateAdmin(store, 'curador.principal', 'senha-definitiva-forte')).valid, true); assert.equal((await authenticateAdmin(store, 'Curador.Principal', 'senha-definitiva-forte')).valid, false);
});

test('admin/123456 é recusado definitivamente após o cadastro', async () => {
  const { store } = await definitiveStore(); assert.equal((await authenticateAdmin(store, 'admin', '123456')).valid, false);
});

test('bootstrap não reaparece após recarregar o estado', async () => {
  const { store } = await definitiveStore(); const before = store.snapshot(); const firstReload = await loadAdminCredentials(store); const secondReload = await loadAdminCredentials(store); assert.equal(firstReload.bootstrap_required, false); assert.equal(secondReload.bootstrap_consumed, true); assert.deepEqual(store.snapshot(), before);
});

test('bootstrap não reaparece após nova inicialização da aplicação sobre o mesmo store', async () => {
  const { store } = await definitiveStore(); const loadedByNewRuntime = await authenticateAdmin(store, 'curador.principal', 'senha-definitiva-forte'); assert.equal(loadedByNewRuntime.valid, true); assert.equal((await authenticateAdmin(store, 'admin', '123456')).valid, false);
});

test('bootstrap_consumed=true nunca é revertido', async () => {
  const { store } = await definitiveStore(); for (let index = 0; index < 3; index += 1) await loadAdminCredentials(store); assert.equal(store.snapshot().state.bootstrap_consumed, true); assert.equal(store.snapshot().credentials.bootstrap_consumed, true);
});

test('sessão de bootstrap é invalidada e sessão definitiva é válida', async () => {
  const store = createMemoryAdminStore(); const bootstrapCredentials = await loadAdminCredentials(store); const oldSession = await createSession(config(), bootstrapCredentials); const completed = await completeFirstAccess(store, 'curador', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(completed.ok, true);
  assert.equal((await verifySession(oldSession.token, config(), completed.credentials)).valid, false); const newSession = await createSession(config(), completed.credentials); assert.equal((await verifySession(newSession.token, config(), completed.credentials)).valid, true);
});

test('alteração posterior exige senha atual e mantém o login', async () => {
  const { store } = await definitiveStore(); const wrong = await changeAdminPassword(store, 'incorreta', 'segunda-senha-definitiva', 'segunda-senha-definitiva'); assert.equal(wrong.ok, false); assert.equal(wrong.code, 'INVALID_CURRENT_PASSWORD');
  const changed = await changeAdminPassword(store, 'senha-definitiva-forte', 'segunda-senha-definitiva', 'segunda-senha-definitiva'); assert.equal(changed.ok, true); assert.equal(changed.credentials.username, 'curador.principal'); assert.equal((await authenticateAdmin(store, 'curador.principal', 'segunda-senha-definitiva')).valid, true); assert.equal((await authenticateAdmin(store, 'curador.principal', 'senha-definitiva-forte')).valid, false);
});

test('estado experimental não consumido migra uma vez para admin/123456', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const oldHash = await hashPassword('segredo-experimental-antigo'); await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp }); await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: oldHash, bootstrap_required: true, credential_version: 4, updated_at: timestamp });
  const migrated = await loadAdminCredentials(store); assert.equal(migrated.credential_version, 5); assert.equal(migrated.state.bootstrap_mode_version, 2); assert.equal(await verifyCredentials('admin', '123456', migrated), true); assert.equal(await verifyCredentials('admin', 'segredo-experimental-antigo', migrated), false); const version = migrated.credential_version; assert.equal((await loadAdminCredentials(store)).credential_version, version);
});

test('estado já consumido é preservado e nunca sobrescrito pela migração', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const definitiveHash = await hashPassword('senha-definitiva-forte'); await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: true, bootstrap_secret_version: 1, updated_at: timestamp }); await store.createCredentials({ schema_version: 1, username: 'dono', password_hash: definitiveHash, bootstrap_required: false, credential_version: 7, updated_at: timestamp });
  const loaded = await loadAdminCredentials(store); assert.equal(loaded.username, 'dono'); assert.equal(loaded.credential_version, 7); assert.equal(loaded.bootstrap_consumed, true); assert.equal(await verifyCredentials('dono', 'senha-definitiva-forte', loaded), true); assert.equal(await verifyCredentials('admin', '123456', loaded), false);
});

test('Netlify Blobs indisponível falha fechado', async () => {
  const store = createMemoryAdminStore({ fail: true }); await assert.rejects(() => authenticateAdmin(store, 'admin', '123456'), AdminStorageError); const response = safeApiFailure(new AdminStorageError('detalhe-interno')); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /detalhe-interno|123456/);
});

test('mecanismo experimental de senha ambiental foi removido de código, exemplo, docs e diagnóstico', async () => {
  const paths = ['../src/lib/admin/config.mjs', '../src/lib/admin/credential-store.mjs', '../src/lib/admin/catalog-service.ts', '../src/pages/admin/configuracoes.astro', '../.env.example', '../docs/admin/README.md']; const contents = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8'))); assert.doesNotMatch(contents.join('\n'), /ADMIN_BOOTSTRAP_[A-Z]+/);
});

test('sessão assinada expira, detecta adulteração e preserva perfil', async () => {
  const credentials = { username: 'curador', credential_version: 3, bootstrap_required: false }; const now = Date.now(); const session = await createSession(config(), credentials, now); assert.deepEqual((await verifySession(session.token, config(), credentials, now + 1000)).user, { username: 'curador', role: 'administrador', bootstrapRequired: false }); assert.equal((await verifySession(`${session.token}x`, config(), credentials, now)).valid, false); assert.equal((await verifySession(session.token, config(), credentials, now + 3_601_000)).reason, 'expired');
});

test('logout continua removendo cookie com as proteções da sessão', () => { assert.deepEqual(sessionCookieOptions(0), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 }); });

test('configuração exige somente segredo de sessão e erros públicos são seguros', async () => {
  assert.throws(() => loadAuthConfig({}), AuthConfigurationError); assert.doesNotThrow(() => config()); const response = safeApiFailure(new AuthConfigurationError('ADMIN_SESSION_SECRET=valor-secreto')); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /valor-secreto/);
});

test('respostas JSON seguem contrato sem cache', async () => {
  const success = jsonResponse(apiPayload({ total: 1 })); const failure = jsonResponse(apiError('INVALID_ID', 'Inválido.'), 400); assert.equal(success.headers.get('cache-control'), 'no-store'); assert.deepEqual(await success.json(), { ok: true, data: { total: 1 } }); assert.deepEqual(await failure.json(), { ok: false, error: { code: 'INVALID_ID', message: 'Inválido.' } });
});

test('rate limit rigoroso bloqueia login e primeiro acesso sem armazenar senhas', () => {
  clearRateLimits(); assert.equal(consumeRateLimit('login:ip', { limit: 3, windowMs: 300_000 }, 100).allowed, true); assert.equal(consumeRateLimit('login:ip', { limit: 3, windowMs: 300_000 }, 101).allowed, true); assert.equal(consumeRateLimit('login:ip', { limit: 3, windowMs: 300_000 }, 102).allowed, true); assert.equal(consumeRateLimit('login:ip', { limit: 3, windowMs: 300_000 }, 103).allowed, false);
});

test('estado legado admin/admin não consumido migra para admin/123456', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: legacyPasswordHash('admin'), bootstrap_required: true, bootstrap_consumed: false, credential_version: 2, updated_at: timestamp });
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const loaded = await loadAdminCredentials(store); assert.equal(await verifyCredentials('admin', '123456', loaded), true); assert.equal(await verifyCredentials('admin', 'admin', loaded), false);
});

test('estado legado de senha ambiental não consumido migra e permite login real', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: await hashPassword('segredo-ambiental-legado'), bootstrap_required: true, bootstrap_consumed: false, credential_version: 3, updated_at: timestamp });
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const login = await authenticateAdmin(store, 'admin', '123456'); assert.equal(login.valid, true); assert.equal(login.credentials.credential_version, 4);
});

test('estado parcial não consumido é reparado automaticamente', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const loaded = await loadAdminCredentials(store); assert.equal(await verifyCredentials('admin', '123456', loaded), true); assert.ok(store.snapshot().credentials); assert.equal(store.snapshot().state.bootstrap_consumed, false);
});

test('credencial definitiva sem marcador preserva login e recupera estado consumido', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const passwordHash = await hashPassword('senha-definitiva-preservada');
  await store.createCredentials({ schema_version: 1, username: 'dono', password_hash: passwordHash, bootstrap_required: false, bootstrap_consumed: true, credential_version: 8, updated_at: timestamp });
  const loaded = await loadAdminCredentials(store); assert.equal(await verifyCredentials('dono', 'senha-definitiva-preservada', loaded), true); assert.equal(store.snapshot().state.bootstrap_consumed, true); assert.equal(store.snapshot().credentials.password_hash, passwordHash);
});

test('marcador consumido sem credencial falha fechado e nunca recria bootstrap', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: true, updated_at: timestamp });
  await assert.rejects(() => loadAdminCredentials(store), (error) => error instanceof AdminStorageError && error.code === 'INCOMPLETE_CONSUMED_STATE'); assert.equal(store.snapshot().credentials, null); assert.equal(store.snapshot().state.bootstrap_consumed, true);
});
test('logging administrativo registra somente diagnóstico permitido', () => {
  const entries = []; const original = console.info; console.info = (value) => entries.push(value);
  try { logAdminAuth('legacy_migration', { operation: 'read', repair: 'reset_unconsumed_bootstrap', password: 'nao-registrar', password_hash: 'hash-nao-registrar', secret: 'segredo-nao-registrar' }); } finally { console.info = original; }
  const serialized = entries.join('\n'); assert.match(serialized, /legacy_migration|reset_unconsumed_bootstrap/); assert.doesNotMatch(serialized, /nao-registrar|segredo-nao-registrar|password_hash/);
});
