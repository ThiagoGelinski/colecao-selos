import { getStore } from '@netlify/blobs';
import { hashInitialBootstrapPassword } from './auth.mjs';
import { logAdminAuth } from './logging.mjs';
const STORE_NAME = 'colecao-selos-admin'; const CREDENTIALS_KEY = 'auth/credentials-v1'; const STATE_KEY = 'auth/bootstrap-state-v1'; const BOOTSTRAP_MODE_VERSION = 2;
const HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;
export class AdminStorageError extends Error { constructor(message = 'Armazenamento administrativo indisponível.', code = 'STORE_UNAVAILABLE') { super(message); this.name = 'AdminStorageError'; this.code = code; } }
function validRecord(record) { return Boolean(record && record.schema_version === 1 && typeof record.username === 'string' && record.username && HASH_PATTERN.test(record.password_hash) && typeof record.bootstrap_required === 'boolean' && typeof record.bootstrap_consumed === 'boolean' && Number.isInteger(record.credential_version) && record.credential_version >= 1 && typeof record.updated_at === 'string'); }
function validState(state) { return Boolean(state && state.schema_version === 1 && state.initialized === true && typeof state.bootstrap_consumed === 'boolean' && typeof state.updated_at === 'string'); }
function assertRecord(record) { if (!validRecord(record)) throw new AdminStorageError('Estado administrativo inválido.', 'INVALID_STATE'); return record; }
export function createNetlifyAdminStore() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' }); const read = async (key) => { const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' }); return entry ? { value: entry.data, etag: entry.etag } : null; };
  return { readCredentials: () => read(CREDENTIALS_KEY), readBootstrapState: () => read(STATE_KEY), createCredentials: (value) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfNew: true }), createBootstrapState: (value) => store.setJSON(STATE_KEY, value, { onlyIfNew: true }), replaceCredentials: (value, etag) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfMatch: etag }), replaceBootstrapState: (value, etag) => store.setJSON(STATE_KEY, value, { onlyIfMatch: etag }) };
}
export function createMemoryAdminStore({ fail = false } = {}) {
  let credentials = null; let state = null; let sequence = 0; const ensure = () => { if (fail) throw new AdminStorageError(); }; const entry = (value) => value ? { value: structuredClone(value.value), etag: value.etag } : null;
  const create = (current, value) => { ensure(); if (current) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; }; const replace = (current, value, etag) => { ensure(); if (!current || current.etag !== etag) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; };
  return { async readCredentials() { ensure(); return entry(credentials); }, async readBootstrapState() { ensure(); return entry(state); }, async createCredentials(value) { const out = create(credentials, value); credentials = out.current; return out.result; }, async createBootstrapState(value) { const out = create(state, value); state = out.current; return out.result; }, async replaceCredentials(value, etag) { const out = replace(credentials, value, etag); credentials = out.current; return out.result; }, async replaceBootstrapState(value, etag) { const out = replace(state, value, etag); state = out.current; return out.result; }, snapshot() { return { credentials: entry(credentials)?.value ?? null, state: entry(state)?.value ?? null }; } };
}
function initialState(timestamp) { return { schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_mode_version: BOOTSTRAP_MODE_VERSION, updated_at: timestamp }; }
async function initialCredentials(timestamp, version = 1) { return { schema_version: 1, username: 'admin', password_hash: await hashInitialBootstrapPassword(), bootstrap_required: true, bootstrap_consumed: false, credential_version: Math.max(1, version), updated_at: timestamp }; }
async function replaceEntry(operation, replace, value, etag) { const written = await replace(value, etag); if (!written.modified) { logAdminAuth('etag_conflict', { operation }); throw new AdminStorageError('Estado alterado por outra sessão.', 'ETAG_CONFLICT'); } return { value, etag: written.etag }; }
async function replacePair(store, credentials, state, nextCredentials, nextState) {
  const nextCredentialEntry = await replaceEntry('replace_credentials', store.replaceCredentials, nextCredentials, credentials.etag); const nextStateEntry = await replaceEntry('replace_state', store.replaceBootstrapState, nextState, state.etag); return { credentials: nextCredentialEntry, state: nextStateEntry };
}
async function readPair(store) {
  try { return await Promise.all([store.readCredentials(), store.readBootstrapState()]); } catch { logAdminAuth('store_unavailable', { operation: 'read' }); throw new AdminStorageError(); }
}
async function repairPartialState(store, credentials, state, now) {
  const timestamp = now.toISOString();
  if (!credentials && !state) {
    logAdminAuth('bootstrap_initialization', { has_credentials: false, has_state: false }); const credentialResult = await store.createCredentials(await initialCredentials(timestamp)); if (credentialResult.modified) await store.createBootstrapState(initialState(timestamp)); return readPair(store);
  }
  if (!credentials && state) {
    if (state.value?.bootstrap_consumed === true) { logAdminAuth('incomplete_consumed_state', { has_credentials: false, has_state: true, bootstrap_consumed: true }); throw new AdminStorageError('Estado consumido sem credencial.', 'INCOMPLETE_CONSUMED_STATE'); }
    logAdminAuth('partial_state_repair', { has_credentials: false, has_state: true, repair: 'create_credentials' }); await store.createCredentials(await initialCredentials(timestamp)); return readPair(store);
  }
  if (credentials && !state) {
    const definitive = credentials.value?.bootstrap_required === false || credentials.value?.bootstrap_consumed === true;
    logAdminAuth('partial_state_repair', { has_credentials: true, has_state: false, repair: definitive ? 'create_consumed_state' : 'create_bootstrap_state' }); await store.createBootstrapState(definitive ? { ...initialState(timestamp), bootstrap_consumed: true } : initialState(timestamp)); return readPair(store);
  }
  return [credentials, state];
}
async function normalizePersistedState(store, credentials, state, now) {
  const timestamp = now.toISOString(); const stateConsumed = state.value?.bootstrap_consumed === true; const credentialDefinitive = credentials.value?.bootstrap_required === false || credentials.value?.bootstrap_consumed === true;
  if (stateConsumed) {
    if (!credentialDefinitive) { logAdminAuth('incompatible_consumed_state', { bootstrap_consumed: true, bootstrap_required: credentials.value?.bootstrap_required ?? null }); throw new AdminStorageError('Estado consumido incompatível.', 'INCOMPATIBLE_CONSUMED_STATE'); }
    if (validRecord(credentials.value) && credentials.value.bootstrap_consumed === true && validState(state.value)) return { credentials, state };
    logAdminAuth('legacy_migration', { bootstrap_consumed: true, repair: 'normalize_consumed_state' });
    const normalizedCredentials = validRecord(credentials.value) && credentials.value.bootstrap_consumed === true ? credentials : await replaceEntry('normalize_definitive_credentials', store.replaceCredentials, { ...credentials.value, schema_version: 1, bootstrap_required: false, bootstrap_consumed: true, updated_at: timestamp }, credentials.etag);
    const normalizedState = validState(state.value) ? state : await replaceEntry('normalize_consumed_state', store.replaceBootstrapState, { ...state.value, schema_version: 1, initialized: true, bootstrap_consumed: true, updated_at: timestamp }, state.etag); return { credentials: normalizedCredentials, state: normalizedState };
  }
  if (credentialDefinitive) {
    logAdminAuth('legacy_migration', { bootstrap_consumed: false, bootstrap_required: false, repair: 'promote_consumed_state' }); const normalizedCredentials = validRecord(credentials.value) ? credentials : await replaceEntry('normalize_definitive_credentials', store.replaceCredentials, { ...credentials.value, bootstrap_required: false, bootstrap_consumed: true, updated_at: timestamp }, credentials.etag); const normalizedState = await replaceEntry('promote_consumed_state', store.replaceBootstrapState, { ...state.value, schema_version: 1, initialized: true, bootstrap_consumed: true, updated_at: timestamp }, state.etag); return { credentials: normalizedCredentials, state: normalizedState };
  }
  const currentVersion = Number.isInteger(credentials.value?.credential_version) ? credentials.value.credential_version : 0; if (validRecord(credentials.value) && validState(state.value) && state.value.bootstrap_consumed === false && state.value.bootstrap_mode_version === BOOTSTRAP_MODE_VERSION) return { credentials, state };
  logAdminAuth('legacy_migration', { bootstrap_consumed: false, bootstrap_required: credentials.value?.bootstrap_required ?? null, repair: 'reset_unconsumed_bootstrap' }); return replacePair(store, credentials, state, await initialCredentials(timestamp, currentVersion + 1), { ...initialState(timestamp), ...state.value, schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_mode_version: BOOTSTRAP_MODE_VERSION, updated_at: timestamp });
}
export async function loadAdminCredentials(store = createNetlifyAdminStore(), { now = new Date() } = {}) {
  try {
    let [credentials, state] = await readPair(store);
    for (let attempt = 0; attempt < 3 && (!credentials || !state); attempt += 1) { [credentials, state] = await repairPartialState(store, credentials, state, now); }
    if (!credentials || !state) { logAdminAuth('incomplete_state', { has_credentials: Boolean(credentials), has_state: Boolean(state) }); throw new AdminStorageError('Estado administrativo incompleto.', 'INCOMPLETE_STATE'); }
    ({ credentials, state } = await normalizePersistedState(store, credentials, state, now)); const record = assertRecord(credentials.value); if (record.bootstrap_consumed !== state.value.bootstrap_consumed) throw new AdminStorageError('Estado administrativo incompatível.', 'INCOMPATIBLE_STATE'); return { ...record, passwordHash: record.password_hash, etag: credentials.etag, state: state.value, stateEtag: state.etag };
  } catch (error) { if (error instanceof AdminStorageError) throw error; logAdminAuth('store_unavailable', { operation: 'write_or_migrate' }); throw new AdminStorageError(); }
}
export async function persistDefinitiveAdmin(store, current, username, passwordHash, now = new Date()) {
  if (!current.bootstrap_required || current.bootstrap_consumed || current.state.bootstrap_consumed) throw new AdminStorageError('Primeiro acesso já concluído.', 'BOOTSTRAP_CONSUMED'); const timestamp = now.toISOString(); const next = { schema_version: 1, username, password_hash: passwordHash, bootstrap_required: false, bootstrap_consumed: true, credential_version: current.credential_version + 1, updated_at: timestamp }; const marker = { ...current.state, bootstrap_consumed: true, updated_at: timestamp };
  try { const pair = await replacePair(store, { value: current, etag: current.etag }, { value: current.state, etag: current.stateEtag }, next, marker); return { ...next, passwordHash: next.password_hash, etag: pair.credentials.etag, state: marker, stateEtag: pair.state.etag }; } catch (error) { if (error instanceof AdminStorageError) throw error; logAdminAuth('store_unavailable', { operation: 'persist_definitive_admin' }); throw new AdminStorageError(); }
}
export async function persistPasswordChange(store, current, passwordHash, now = new Date()) {
  if (current.bootstrap_required || !current.bootstrap_consumed || !current.state.bootstrap_consumed) throw new AdminStorageError('Cadastro definitivo ausente.', 'BOOTSTRAP_REQUIRED'); const timestamp = now.toISOString(); const next = { ...current, password_hash: passwordHash, passwordHash: undefined, credential_version: current.credential_version + 1, updated_at: timestamp }; delete next.etag; delete next.state; delete next.stateEtag; delete next.passwordHash;
  try { const written = await replaceEntry('change_password', store.replaceCredentials, next, current.etag); return { ...next, passwordHash: next.password_hash, etag: written.etag, state: current.state, stateEtag: current.stateEtag }; } catch (error) { if (error instanceof AdminStorageError) throw error; logAdminAuth('store_unavailable', { operation: 'change_password' }); throw new AdminStorageError(); }
}
