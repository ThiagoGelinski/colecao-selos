import { getStore } from '@netlify/blobs';
import { hashInitialBootstrapPassword } from './auth.mjs';
const STORE_NAME = 'colecao-selos-admin'; const CREDENTIALS_KEY = 'auth/credentials-v1'; const STATE_KEY = 'auth/bootstrap-state-v1'; const BOOTSTRAP_MODE_VERSION = 2;
const HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;
export class AdminStorageError extends Error { constructor(message = 'Armazenamento administrativo indisponível.') { super(message); this.name = 'AdminStorageError'; } }
function assertRecord(record) { if (!record || record.schema_version !== 1 || typeof record.username !== 'string' || !record.username || !HASH_PATTERN.test(record.password_hash) || typeof record.bootstrap_required !== 'boolean' || typeof record.bootstrap_consumed !== 'boolean' || !Number.isInteger(record.credential_version) || record.credential_version < 1 || typeof record.updated_at !== 'string') throw new AdminStorageError('Estado administrativo inválido.'); return record; }
export function createNetlifyAdminStore() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' }); const read = async (key) => { const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' }); return entry ? { value: entry.data, etag: entry.etag } : null; };
  return { readCredentials: () => read(CREDENTIALS_KEY), readBootstrapState: () => read(STATE_KEY), createCredentials: (value) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfNew: true }), createBootstrapState: (value) => store.setJSON(STATE_KEY, value, { onlyIfNew: true }), replaceCredentials: (value, etag) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfMatch: etag }), replaceBootstrapState: (value, etag) => store.setJSON(STATE_KEY, value, { onlyIfMatch: etag }) };
}
export function createMemoryAdminStore({ fail = false } = {}) {
  let credentials = null; let state = null; let sequence = 0; const ensure = () => { if (fail) throw new AdminStorageError(); }; const entry = (value) => value ? { value: structuredClone(value.value), etag: value.etag } : null;
  const create = (current, value) => { ensure(); if (current) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; }; const replace = (current, value, etag) => { ensure(); if (!current || current.etag !== etag) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; };
  return { async readCredentials() { ensure(); return entry(credentials); }, async readBootstrapState() { ensure(); return entry(state); }, async createCredentials(value) { const out = create(credentials, value); credentials = out.current; return out.result; }, async createBootstrapState(value) { const out = create(state, value); state = out.current; return out.result; }, async replaceCredentials(value, etag) { const out = replace(credentials, value, etag); credentials = out.current; return out.result; }, async replaceBootstrapState(value, etag) { const out = replace(state, value, etag); state = out.current; return out.result; }, snapshot() { return { credentials: entry(credentials)?.value ?? null, state: entry(state)?.value ?? null }; } };
}
async function replacePair(store, credentials, state, nextCredentials, nextState) {
  const written = await store.replaceCredentials(nextCredentials, credentials.etag); if (!written.modified) throw new AdminStorageError('Credencial alterada por outra sessão.'); const stateWritten = await store.replaceBootstrapState(nextState, state.etag); if (!stateWritten.modified) throw new AdminStorageError('Estado alterado por outra sessão.');
  return { credentials: { value: nextCredentials, etag: written.etag }, state: { value: nextState, etag: stateWritten.etag } };
}
async function normalizePersistedState(store, credentials, state, now) {
  const consumed = state.value.bootstrap_consumed === true || credentials.value.bootstrap_required === false;
  if (consumed) {
    if (credentials.value.bootstrap_required === true) throw new AdminStorageError('Estado administrativo incompatível.');
    if (state.value.bootstrap_consumed === true && credentials.value.bootstrap_consumed === true) return { credentials, state };
    const timestamp = now.toISOString(); return replacePair(store, credentials, state, { ...credentials.value, bootstrap_consumed: true, updated_at: timestamp }, { ...state.value, bootstrap_consumed: true, updated_at: timestamp });
  }
  if (state.value.bootstrap_consumed !== false || credentials.value.bootstrap_required !== true) throw new AdminStorageError('Estado administrativo incompatível.');
  if (state.value.bootstrap_mode_version === BOOTSTRAP_MODE_VERSION && credentials.value.bootstrap_consumed === false) return { credentials, state };
  const timestamp = now.toISOString(); const passwordHash = await hashInitialBootstrapPassword();
  return replacePair(store, credentials, state, { ...credentials.value, username: 'admin', password_hash: passwordHash, bootstrap_required: true, bootstrap_consumed: false, credential_version: credentials.value.credential_version + 1, updated_at: timestamp }, { ...state.value, bootstrap_consumed: false, bootstrap_mode_version: BOOTSTRAP_MODE_VERSION, updated_at: timestamp });
}
export async function loadAdminCredentials(store = createNetlifyAdminStore(), { now = new Date() } = {}) {
  try {
    let [credentials, state] = await Promise.all([store.readCredentials(), store.readBootstrapState()]);
    if (!credentials && !state) {
      const timestamp = now.toISOString(); const initialState = { schema_version: 1, initialized: true, bootstrap_consumed: false, bootstrap_mode_version: BOOTSTRAP_MODE_VERSION, updated_at: timestamp }; const passwordHash = await hashInitialBootstrapPassword();
      const stateResult = await store.createBootstrapState(initialState); if (stateResult.modified) await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: passwordHash, bootstrap_required: true, bootstrap_consumed: false, credential_version: 1, updated_at: timestamp }); [credentials, state] = await Promise.all([store.readCredentials(), store.readBootstrapState()]);
    }
    if (!credentials || !state || state.value?.schema_version !== 1 || state.value?.initialized !== true) throw new AdminStorageError('Estado administrativo incompleto.');
    ({ credentials, state } = await normalizePersistedState(store, credentials, state, now)); const record = assertRecord(credentials.value); if (record.bootstrap_consumed !== state.value.bootstrap_consumed) throw new AdminStorageError('Estado administrativo incompatível.');
    return { ...record, passwordHash: record.password_hash, etag: credentials.etag, state: state.value, stateEtag: state.etag };
  } catch (error) { if (error instanceof AdminStorageError) throw error; throw new AdminStorageError(); }
}
export async function persistDefinitiveAdmin(store, current, username, passwordHash, now = new Date()) {
  if (!current.bootstrap_required || current.bootstrap_consumed || current.state.bootstrap_consumed) throw new AdminStorageError('Primeiro acesso já concluído.'); const timestamp = now.toISOString(); const next = { schema_version: 1, username, password_hash: passwordHash, bootstrap_required: false, bootstrap_consumed: true, credential_version: current.credential_version + 1, updated_at: timestamp }; const marker = { ...current.state, bootstrap_consumed: true, updated_at: timestamp };
  try { const pair = await replacePair(store, { value: current, etag: current.etag }, { value: current.state, etag: current.stateEtag }, next, marker); return { ...next, passwordHash: next.password_hash, etag: pair.credentials.etag, state: marker, stateEtag: pair.state.etag }; } catch (error) { if (error instanceof AdminStorageError) throw error; throw new AdminStorageError(); }
}
export async function persistPasswordChange(store, current, passwordHash, now = new Date()) {
  if (current.bootstrap_required || !current.bootstrap_consumed || !current.state.bootstrap_consumed) throw new AdminStorageError('Cadastro definitivo ausente.'); const timestamp = now.toISOString(); const next = { ...current, password_hash: passwordHash, passwordHash: undefined, credential_version: current.credential_version + 1, updated_at: timestamp }; delete next.etag; delete next.state; delete next.stateEtag; delete next.passwordHash;
  try { const written = await store.replaceCredentials(next, current.etag); if (!written.modified) throw new AdminStorageError('Credencial alterada por outra sessão.'); return { ...next, passwordHash: next.password_hash, etag: written.etag, state: current.state, stateEtag: current.stateEtag }; } catch (error) { if (error instanceof AdminStorageError) throw error; throw new AdminStorageError(); }
}
