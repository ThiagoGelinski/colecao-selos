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
const bootstrapSecret = 'segredo-bootstrap-sintetico-com-mais-de-32-caracteres';
const bootstrapEnv = { ADMIN_BOOTSTRAP_ENABLED: 'true', ADMIN_BOOTSTRAP_SECRET: bootstrapSecret, CONTEXT: 'local' };
const bootstrapOptions = { bootstrapEnv };
const authenticate = (store, username, password, options = bootstrapOptions) => authenticateAdmin(store, username, password, options);
const completeFirst = (store, username, password, confirmation, options = bootstrapOptions) => completeFirstAccess(store, username, password, confirmation, options);
const loadCredentials = (store, options = bootstrapOptions) => loadAdminCredentials(store, options);
function legacyPasswordHash(password) { const salt = randomBytes(16); const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); return `scrypt$${16384}$${8}$${1}$${salt.toString('base64url')}$${derived.toString('base64url')}`; }
const config = () => loadAuthConfig({ ADMIN_SESSION_SECRET: secret, ADMIN_ROLE: 'administrador', ADMIN_SESSION_TTL_SECONDS: '3600' });
async function definitiveStore() { const store = createMemoryAdminStore(); const result = await completeFirst(store, 'Curador.Principal', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(result.ok, true); return { store, credentials: result.credentials }; }

test('admin/segredo configurado funciona somente antes do cadastro definitivo', async () => {
  const store = createMemoryAdminStore(); const auth = await authenticate(store, 'admin', bootstrapSecret); assert.equal(auth.valid, true); assert.equal(auth.credentials.bootstrap_required, true); assert.equal(auth.credentials.bootstrap_consumed, false);
});

test('senha inicial diferente é recusada com resposta de autenticação genérica', async () => {
  const store = createMemoryAdminStore(); assert.equal((await authenticate(store, 'admin', 'segredo-incorreto')).valid, false); const response = jsonResponse(apiError('INVALID_CREDENTIALS', 'Usuário ou senha inválidos.'), 401); assert.doesNotMatch(await response.text(), /segredo-bootstrap-sintetico/);
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
  const store = createMemoryAdminStore(); const result = await completeFirst(store, 'x!', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_USERNAME');
});

test('senha curta e o segredo de bootstrap não podem ser senha definitiva', async () => {
  assert.equal(validateNewPassword('curta', 'curta', 'curador').valid, false); assert.equal((await completeFirst(createMemoryAdminStore(), 'curador', bootstrapSecret, bootstrapSecret)).ok, false);
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
  const { store } = await definitiveStore(); assert.equal((await authenticate(store, 'curador.principal', 'senha-definitiva-forte')).valid, true); assert.equal((await authenticate(store, 'Curador.Principal', 'senha-definitiva-forte')).valid, false);
});

test('admin/segredo configurado é recusado definitivamente após o cadastro', async () => {
  const { store } = await definitiveStore(); assert.equal((await authenticate(store, 'admin', bootstrapSecret)).valid, false);
});

test('bootstrap não reaparece após recarregar o estado', async () => {
  const { store } = await definitiveStore(); const before = store.snapshot(); const firstReload = await loadCredentials(store); const secondReload = await loadCredentials(store); assert.equal(firstReload.bootstrap_required, false); assert.equal(secondReload.bootstrap_consumed, true); assert.deepEqual(store.snapshot(), before);
});

test('bootstrap não reaparece após nova inicialização da aplicação sobre o mesmo store', async () => {
  const { store } = await definitiveStore(); const loadedByNewRuntime = await authenticate(store, 'curador.principal', 'senha-definitiva-forte'); assert.equal(loadedByNewRuntime.valid, true); assert.equal((await authenticate(store, 'admin', bootstrapSecret)).valid, false);
});

test('bootstrap_consumed=true nunca é revertido', async () => {
  const { store } = await definitiveStore(); for (let index = 0; index < 3; index += 1) await loadCredentials(store); assert.equal(store.snapshot().state.bootstrap_consumed, true); assert.equal(store.snapshot().credentials.bootstrap_consumed, true);
});

test('sessão de bootstrap é invalidada e sessão definitiva é válida', async () => {
  const store = createMemoryAdminStore(); const bootstrapCredentials = await loadCredentials(store); const oldSession = await createSession(config(), bootstrapCredentials); const completed = await completeFirst(store, 'curador', 'senha-definitiva-forte', 'senha-definitiva-forte'); assert.equal(completed.ok, true);
  assert.equal((await verifySession(oldSession.token, config(), completed.credentials)).valid, false); const newSession = await createSession(config(), completed.credentials); assert.equal((await verifySession(newSession.token, config(), completed.credentials)).valid, true);
});

test('alteração posterior exige senha atual e mantém o login', async () => {
  const { store } = await definitiveStore(); const wrong = await changeAdminPassword(store, 'incorreta', 'segunda-senha-definitiva', 'segunda-senha-definitiva'); assert.equal(wrong.ok, false); assert.equal(wrong.code, 'INVALID_CURRENT_PASSWORD');
  const changed = await changeAdminPassword(store, 'senha-definitiva-forte', 'segunda-senha-definitiva', 'segunda-senha-definitiva'); assert.equal(changed.ok, true); assert.equal(changed.credentials.username, 'curador.principal'); assert.equal((await authenticate(store, 'curador.principal', 'segunda-senha-definitiva')).valid, true); assert.equal((await authenticate(store, 'curador.principal', 'senha-definitiva-forte')).valid, false);
});

test('estado experimental não consumido migra uma vez para o segredo configurado', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const oldHash = await hashPassword('segredo-experimental-antigo'); await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp }); await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: oldHash, bootstrap_required: true, credential_version: 4, updated_at: timestamp });
  const migrated = await loadCredentials(store); assert.equal(migrated.credential_version, 5); assert.equal(migrated.state.bootstrap_mode_version, 3); assert.equal(await verifyCredentials('admin', bootstrapSecret, migrated), true); assert.equal(await verifyCredentials('admin', 'segredo-experimental-antigo', migrated), false); const version = migrated.credential_version; assert.equal((await loadCredentials(store)).credential_version, version);
});

test('estado já consumido é preservado e nunca sobrescrito pela migração', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const definitiveHash = await hashPassword('senha-definitiva-forte'); await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: true, bootstrap_secret_version: 1, updated_at: timestamp }); await store.createCredentials({ schema_version: 1, username: 'dono', password_hash: definitiveHash, bootstrap_required: false, credential_version: 7, updated_at: timestamp });
  const loaded = await loadCredentials(store); assert.equal(loaded.username, 'dono'); assert.equal(loaded.credential_version, 7); assert.equal(loaded.bootstrap_consumed, true); assert.equal(await verifyCredentials('dono', 'senha-definitiva-forte', loaded), true); assert.equal(await verifyCredentials('admin', bootstrapSecret, loaded), false);
});

test('Netlify Blobs indisponível falha fechado', async () => {
  const store = createMemoryAdminStore({ fail: true }); await assert.rejects(() => authenticate(store, 'admin', bootstrapSecret), AdminStorageError); const response = safeApiFailure(new AdminStorageError('detalhe-interno')); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /detalhe-interno|segredo-bootstrap-sintetico/);
});

test('segredo de bootstrap não é exposto em módulos cliente ou diagnóstico', async () => {
  const paths = ['../src/pages/admin/login.astro', '../src/pages/admin/primeiro-acesso.astro', '../src/lib/admin/catalog-service.ts', '../src/pages/admin/configuracoes.astro']; const contents = await Promise.all(paths.map((item) => readFile(new URL(item, import.meta.url), 'utf8'))); assert.doesNotMatch(contents.join('\n'), /ADMIN_BOOTSTRAP_SECRET|segredo-bootstrap-sintetico/);
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

test('estado legado admin/admin não consumido migra para o segredo configurado', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: legacyPasswordHash('admin'), bootstrap_required: true, bootstrap_consumed: false, credential_version: 2, updated_at: timestamp });
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const loaded = await loadCredentials(store); assert.equal(await verifyCredentials('admin', bootstrapSecret, loaded), true); assert.equal(await verifyCredentials('admin', 'admin', loaded), false);
});

test('estado legado de senha ambiental não consumido migra e permite login real', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: await hashPassword('segredo-ambiental-legado'), bootstrap_required: true, bootstrap_consumed: false, credential_version: 3, updated_at: timestamp });
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const login = await authenticate(store, 'admin', bootstrapSecret); assert.equal(login.valid, true); assert.equal(login.credentials.credential_version, 4);
});

test('estado parcial não consumido é reparado automaticamente', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_secret_version: 1, updated_at: timestamp });
  const loaded = await loadCredentials(store); assert.equal(await verifyCredentials('admin', bootstrapSecret, loaded), true); assert.ok(store.snapshot().credentials); assert.equal(store.snapshot().state.bootstrap_consumed, false);
});

test('credencial definitiva sem marcador preserva login e recupera estado consumido', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString(); const passwordHash = await hashPassword('senha-definitiva-preservada');
  await store.createCredentials({ schema_version: 1, username: 'dono', password_hash: passwordHash, bootstrap_required: false, bootstrap_consumed: true, credential_version: 8, updated_at: timestamp });
  const loaded = await loadCredentials(store); assert.equal(await verifyCredentials('dono', 'senha-definitiva-preservada', loaded), true); assert.equal(store.snapshot().state.bootstrap_consumed, true); assert.equal(store.snapshot().credentials.password_hash, passwordHash);
});

test('marcador consumido sem credencial falha fechado e nunca recria bootstrap', async () => {
  const store = createMemoryAdminStore(); const timestamp = new Date().toISOString();
  await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: true, updated_at: timestamp });
  await assert.rejects(() => loadCredentials(store), (error) => error instanceof AdminStorageError && error.code === 'INCOMPLETE_CONSUMED_STATE'); assert.equal(store.snapshot().credentials, null); assert.equal(store.snapshot().state.bootstrap_consumed, true);
});
test('logging administrativo registra somente diagnóstico permitido', () => {
  const entries = []; const original = console.info; console.info = (value) => entries.push(value);
  try { logAdminAuth('legacy_migration', { operation: 'read', repair: 'reset_unconsumed_bootstrap', password: 'nao-registrar', password_hash: 'hash-nao-registrar', secret: 'segredo-nao-registrar' }); } finally { console.info = original; }
  const serialized = entries.join('\n'); assert.match(serialized, /legacy_migration|reset_unconsumed_bootstrap/); assert.doesNotMatch(serialized, /nao-registrar|segredo-nao-registrar|password_hash/);
});
test('store vazio sem configuração falha fechado e não grava estado', async () => {
  const store = createMemoryAdminStore();
  await assert.rejects(() => loadAdminCredentials(store, { bootstrapEnv: {} }), AuthConfigurationError);
  assert.deepEqual(store.snapshot(), { credentials: null, state: null });
});

test('store vazio com bootstrap desabilitado falha fechado', async () => {
  const store = createMemoryAdminStore();
  await assert.rejects(() => loadAdminCredentials(store, { bootstrapEnv: { ADMIN_BOOTSTRAP_ENABLED: 'false', ADMIN_BOOTSTRAP_SECRET: bootstrapSecret, CONTEXT: 'local' } }), AuthConfigurationError);
  assert.deepEqual(store.snapshot(), { credentials: null, state: null });
});

test('segredo de bootstrap curto é recusado antes de qualquer escrita', async () => {
  const store = createMemoryAdminStore();
  await assert.rejects(() => loadAdminCredentials(store, { bootstrapEnv: { ADMIN_BOOTSTRAP_ENABLED: 'true', ADMIN_BOOTSTRAP_SECRET: 'curto', CONTEXT: 'local' } }), AuthConfigurationError);
  assert.deepEqual(store.snapshot(), { credentials: null, state: null });
});

test('bootstrap válido persiste somente hash e autentica apenas o segredo correto', async () => {
  const store = createMemoryAdminStore();
  const loaded = await loadCredentials(store);
  const serialized = JSON.stringify(store.snapshot());
  assert.match(loaded.password_hash, /^scrypt\$/);
  assert.doesNotMatch(serialized, new RegExp(bootstrapSecret));
  assert.equal((await authenticate(store, 'admin', bootstrapSecret)).valid, true);
  assert.equal((await authenticate(store, 'admin', `${bootstrapSecret}-incorreto`)).valid, false);
});

test('variáveis removidas após consumo não quebram login definitivo', async () => {
  const { store } = await definitiveStore();
  const login = await authenticateAdmin(store, 'curador.principal', 'senha-definitiva-forte', { bootstrapEnv: {} });
  assert.equal(login.valid, true);
});

test('estado consumido ignora configuração de bootstrap presente ou proibida', async () => {
  const { store } = await definitiveStore();
  const before = store.snapshot();
  const loaded = await loadAdminCredentials(store, { bootstrapEnv: { ADMIN_BOOTSTRAP_ENABLED: 'true', ADMIN_BOOTSTRAP_SECRET: 'outro-segredo-sintetico-com-mais-de-32-caracteres', CONTEXT: 'deploy-preview' } });
  assert.equal(loaded.bootstrap_consumed, true);
  assert.deepEqual(store.snapshot(), before);
});

test('dois primeiros acessos concorrentes produzem um único vencedor', async () => {
  const store = createMemoryAdminStore();
  await loadCredentials(store);
  const settled = await Promise.allSettled([
    completeFirst(store, 'primeiro.admin', 'senha-definitiva-primeiro', 'senha-definitiva-primeiro'),
    completeFirst(store, 'segundo.admin', 'senha-definitiva-segundo', 'senha-definitiva-segundo')
  ]);
  assert.equal(settled.filter((entry) => entry.status === 'fulfilled' && entry.value.ok).length, 1);
  assert.equal(settled.filter((entry) => entry.status === 'rejected').length, 1);
  assert.equal(store.snapshot().credentials.bootstrap_consumed, true);
  assert.equal(store.snapshot().state.bootstrap_consumed, true);
});

test('Deploy Preview não inicializa nem migra bootstrap', async () => {
  const store = createMemoryAdminStore();
  await assert.rejects(() => loadAdminCredentials(store, { bootstrapEnv: { ADMIN_BOOTSTRAP_ENABLED: 'true', ADMIN_BOOTSTRAP_SECRET: bootstrapSecret, CONTEXT: 'deploy-preview' } }), AuthConfigurationError);
  assert.deepEqual(store.snapshot(), { credentials: null, state: null });
});

test('respostas e logs nunca incluem o segredo de bootstrap', async () => {
  const entries = []; const original = console.info; console.info = (value) => entries.push(value);
  try { logAdminAuth('bootstrap_configuration_missing', { secret: bootstrapSecret, operation: 'initialize' }); } finally { console.info = original; }
  const response = safeApiFailure(new AuthConfigurationError(`segredo=${bootstrapSecret}`));
  assert.doesNotMatch(entries.join('\n'), new RegExp(bootstrapSecret));
  assert.doesNotMatch(await response.text(), new RegExp(bootstrapSecret));
});
