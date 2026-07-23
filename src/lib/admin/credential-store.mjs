import { getStore } from '@netlify/blobs';
import { hashBootstrapPassword } from './auth.mjs';
const STORE_NAME = 'colecao-selos-admin'; const CREDENTIALS_KEY = 'auth/credentials-v1'; const STATE_KEY = 'auth/bootstrap-state-v1';
const HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;
export class AdminStorageError extends Error { constructor(message = 'Armazenamento administrativo indisponível.') { super(message); this.name = 'AdminStorageError'; } }
function assertRecord(record) {
  if (!record || record.schema_version !== 1 || typeof record.username !== 'string' || !record.username || !HASH_PATTERN.test(record.password_hash) || typeof record.bootstrap_required !== 'boolean' || !Number.isInteger(record.credential_version) || record.credential_version < 1 || typeof record.updated_at !== 'string') throw new AdminStorageError('Estado administrativo inválido.');
  return record;
}
export function createNetlifyAdminStore() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const read = async (key) => { const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' }); return entry ? { value: entry.data, etag: entry.etag } : null; };
  return { readCredentials: () => read(CREDENTIALS_KEY), readBootstrapState: () => read(STATE_KEY), createCredentials: (value) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfNew: true }), createBootstrapState: (value) => store.setJSON(STATE_KEY, value, { onlyIfNew: true }), replaceCredentials: (value, etag) => store.setJSON(CREDENTIALS_KEY, value, { onlyIfMatch: etag }), replaceBootstrapState: (value, etag) => store.setJSON(STATE_KEY, value, { onlyIfMatch: etag }) };
}
export function createMemoryAdminStore({ fail = false } = {}) {
  let credentials = null; let state = null; let sequence = 0; const ensure = () => { if (fail) throw new AdminStorageError(); };
  const entry = (value) => value ? { value: structuredClone(value.value), etag: value.etag } : null;
  const create = (current, value) => { ensure(); if (current) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; };
  const replace = (current, value, etag) => { ensure(); if (!current || current.etag !== etag) return { current, result: { modified: false } }; const next = { value: structuredClone(value), etag: `"${++sequence}"` }; return { current: next, result: { modified: true, etag: next.etag } }; };
  return { async readCredentials() { ensure(); return entry(credentials); }, async readBootstrapState() { ensure(); return entry(state); }, async createCredentials(value) { const out = create(credentials, value); credentials = out.current; return out.result; }, async createBootstrapState(value) { const out = create(state, value); state = out.current; return out.result; }, async replaceCredentials(value, etag) { const out = replace(credentials, value, etag); credentials = out.current; return out.result; }, async replaceBootstrapState(value, etag) { const out = replace(state, value, etag); state = out.current; return out.result; }, snapshot() { return { credentials: entry(credentials)?.value ?? null, state: entry(state)?.value ?? null }; } };
}
export async function loadAdminCredentials(store = createNetlifyAdminStore(), now = new Date()) {
  try {
    let [credentials, state] = await Promise.all([store.readCredentials(), store.readBootstrapState()]);
    if (!credentials && !state) {
      const timestamp = now.toISOString(); const stateResult = await store.createBootstrapState({ schema_version: 1, initialized: true, bootstrap_consumed: false, updated_at: timestamp });
      if (stateResult.modified) await store.createCredentials({ schema_version: 1, username: 'admin', password_hash: await hashBootstrapPassword(), bootstrap_required: true, credential_version: 1, updated_at: timestamp });
      [credentials, state] = await Promise.all([store.readCredentials(), store.readBootstrapState()]);
    }
    if (!credentials || !state || state.value?.schema_version !== 1 || state.value?.initialized !== true) throw new AdminStorageError('Estado administrativo incompleto.');
    return { ...assertRecord(credentials.value), passwordHash: credentials.value.password_hash, etag: credentials.etag, state: state.value, stateEtag: state.etag };
  } catch (error) { if (error instanceof AdminStorageError) throw error; throw new AdminStorageError(); }
}
export async function persistDefinitivePassword(store, current, passwordHash, now = new Date()) {
  const timestamp = now.toISOString(); const next = { schema_version: 1, username: current.username, password_hash: passwordHash, bootstrap_required: false, credential_version: current.credential_version + 1, updated_at: timestamp }; const marker = { schema_version: 1, initialized: true, bootstrap_consumed: true, updated_at: timestamp };
  try {
    const written = await store.replaceCredentials(next, current.etag); if (!written.modified) throw new AdminStorageError('Credencial alterada por outra sessão.');
    const stateWritten = await store.replaceBootstrapState(marker, current.stateEtag); if (!stateWritten.modified) throw new AdminStorageError('Estado alterado por outra sessão.');
    return { ...next, passwordHash: next.password_hash, etag: written.etag, state: marker, stateEtag: stateWritten.etag };
  } catch (error) { if (error instanceof AdminStorageError) throw error; throw new AdminStorageError(); }
}
