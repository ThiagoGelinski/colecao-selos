import { access, mkdir, readFile, rename, writeFile, readdir, link, unlink, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { ID_MANIFEST } from './paths.mjs';
import { jsonDigest } from './digest.mjs';

export const isServerlessEngine = () => {
    if (globalThis.__MOCK_NETLIFY_ENV) return true;
    if (typeof process !== 'undefined' && process.env && (process.env.NETLIFY === 'true' || process.env.SITE_ID)) return true;
    return false;
};

const CATALOG_STORES = new Set(['colecao-selos-catalogo', 'colecao-selos-catalogo-v2']);
/** Select a known catalogue generation explicitly; never silently create arbitrary stores. */
export function catalogStoreName(env = process.env) {
    const name = env.CATALOG_BLOB_STORE?.trim() || 'colecao-selos-catalogo';
    if (!CATALOG_STORES.has(name)) throw Object.assign(new Error('Configuração de armazenamento do catálogo inválida.'), { code: 'CATALOG_STORE_INVALID', status: 503 });
    return name;
}
let _blobStore = null;
let _blobStoreName = null;
const getBlobStore = () => {
    const name = catalogStoreName();
    if (globalThis.__MOCK_BLOB_STORE) return globalThis.__MOCK_BLOB_STORE;
    if (!_blobStore || _blobStoreName !== name) {
        _blobStore = getStore({ name, consistency: 'strong' });
        _blobStoreName = name;
    }
    return _blobStore;
};

const getBlobKey = (target) => {
    if (typeof target !== 'string') return null;
    const normalized = target.replace(/\\/g, '/');

    if (normalized.match(/manifests\/ids\.json$/) || normalized === 'manifests/ids.json') {
        return 'manifests/ids.json';
    }

    const seloMatch = normalized.match(/\/data\/selos\/(SEL-[a-zA-Z0-9_-]+\.json)$/);
    if (seloMatch && !seloMatch[1].includes('/')) {
        return 'manifests/' + seloMatch[1];
    }

    return null;
};

const getAssetBlobKey = (target) => {
    if (typeof target !== 'string') return null;
    const normalized = target.replace(/\\/g, '/');
    const assetMatch = normalized.match(/\/assets\/selos\/(SEL-[0-9]{6})\/(\1-(?:frente|verso|card|thumb)\.(?:webp|png|jpg|jpeg))$/);
    if (assetMatch) {
        return assetMatch[0].startsWith('/') ? assetMatch[0].slice(1) : assetMatch[0];
    }
    return null;
};

const assetFilesystemCandidates = (target, blobKey) => {
    const candidates = [target];
    if (process.env.LAMBDA_TASK_ROOT) candidates.push(path.join(process.env.LAMBDA_TASK_ROOT, 'public', ...blobKey.split('/')));
    return [...new Set(candidates)];
};

const readAssetFromFilesystem = async (target, blobKey) => {
    let lastError = null;
    for (const candidate of assetFilesystemCandidates(target, blobKey)) {
        try { return await readFile(candidate); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; lastError = error; }
    }
    throw lastError ?? Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};

const readBlobWithEtag = async (store, key, type) => {
    const payload = await store.getWithMetadata(key, { type, consistency: 'strong' });
    if (!payload?.data || payload.etag) return payload;
    const descriptor = typeof store.getMetadata === 'function' ? await store.getMetadata(key, { consistency: 'strong' }) : null;
    let etag = descriptor?.etag;
    if (!etag && typeof store.list === 'function') {
        const listing = await store.list({ prefix: key });
        etag = listing?.blobs?.find((entry) => entry.key === key)?.etag;
    }
    return { ...payload, etag, metadata: payload.metadata ?? descriptor?.metadata ?? {} };
};

const baselineHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const isDeepEqual = (a, b) => {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (let key of keysA) {
        if (!keysB.includes(key) || !isDeepEqual(a[key], b[key])) return false;
    }
    return true;
};

// A deployed baseline may advance only to the exact reviewed Blob snapshot.
// CAS updates metadata without erasing an edit that arrived during reconciliation.
const reconcileBaseline = async (store, key, payload, baseline, target) => {
    const digest = baselineHash(baseline);
    for (let attempt = 0; attempt < 5; attempt++) {
        const previous = payload?.metadata?.baseline_hash;
        const approvedManifest = key === 'manifests/ids.json' && payload?.metadata?.pending_baseline_hash === digest;
        if (previous === digest && !approvedManifest) return payload;
        if (!payload?.data || (!approvedManifest && !isDeepEqual(payload.data, baseline))) {
            throw conflictError('Inconsistência Crítica (Dual-Source): baseline alterado após materialização em ' + target, 'RECORD_CONFLICT');
        }
        if (!payload.etag) throw conflictError('ETag indisponível para reconciliar o baseline.', 'RECORD_CONFLICT');
        const metadata = { ...payload.metadata, baseline_hash: digest };
        if (approvedManifest) delete metadata.pending_baseline_hash;
        const reconciled = await store.setJSON(key, payload.data, { onlyIfMatch: payload.etag, metadata });
        if (reconciled?.modified === true) return { ...payload, etag: reconciled.etag, metadata };
        payload = await readBlobWithEtag(store, key, 'json');
        if (!payload?.data) throw conflictError('Registro indisponível durante reconciliação.', 'RECORD_CONFLICT');
    }
    throw conflictError('Concorrência intensa durante reconciliação do baseline.', 'RECORD_CONFLICT');
};

export const exists = async (target) => access(target, constants.F_OK).then(() => true).catch(() => false);

export const readJson = async (target) => {
    let baselineData = null;
    let baselineError = null;

    try {
        const fsRaw = await readFile(target, 'utf8');
        baselineData = JSON.parse(fsRaw);
    } catch (err) {
        baselineError = err;
    }

    if (!isServerlessEngine()) {
        if (baselineError) throw baselineError;
        return baselineData;
    }

    // Fail-Closed: only ENOENT is a valid baseline absence. EACCES, SyntaxError, etc must fail the operation immediately.
    if (baselineError && baselineError.code !== 'ENOENT') {
        throw baselineError;
    }

    const blobKey = getBlobKey(target);
    if (!blobKey) {
        if (baselineError) throw baselineError;
        return baselineData;
    }

    const blobStore = await getBlobStore();
    let payload = typeof blobStore.getWithMetadata === 'function'
        ? await readBlobWithEtag(blobStore, blobKey, 'json')
        : await blobStore.get(blobKey).then((raw) => raw == null ? null : ({ data: typeof raw === 'string' ? JSON.parse(raw) : raw, metadata: {} }));
    if (!payload?.data) { if (baselineError) throw baselineError; return baselineData; }
    if (!baselineError) {
        const materializedHash = payload.metadata?.baseline_hash;
        if (materializedHash) {
            payload = await reconcileBaseline(blobStore, blobKey, payload, baselineData, target);
        } else if (!isDeepEqual(payload.data, baselineData)) throw new Error('Inconsistência Crítica (Dual-Source): Divergência de dados inaceitável no alvo ' + target);
    }
    return payload.data;
};

export async function writeJsonAtomic(target, value) { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await rename(temporary, target); }

export const listJsonNames = async (dir) => {
    let fsNames = [];
    try {
        fsNames = (await readdir(dir, { withFileTypes: true }))
            .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.json'))
            .map((dirent) => dirent.name);
    } catch (err) {
        if (!isServerlessEngine()) throw err;
        if (err.code !== 'ENOENT') throw err;
    }

    if (!isServerlessEngine()) return fsNames.sort();

    const parts = dir.split(/[\\/]data[\\/]selos/);
    if (parts.length !== 2) return fsNames.sort();

    const isRoot = parts[1] === '' || parts[1] === '/' || parts[1] === '\\';
    if (!isRoot) return fsNames.sort();

    const blobStore = getBlobStore();
    const { blobs } = await blobStore.list();

    const blobNames = (blobs || [])
        .map((blob) => /^manifests\/(SEL-[0-9]{6}\.json)$/.exec(blob?.key ?? '')?.[1] ?? null)
        .filter(Boolean);

    return [...new Set([...fsNames, ...blobNames])].sort();
};

export async function writeJsonExclusive(target, value) {
    if (!isServerlessEngine()) {
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
            await link(temporary, target);
        } finally {
            await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        }
        return;
    }

    const parts = target.split(/[\\/]data[\\/]selos[\\/]/);
    const isValidStamp = parts.length === 2 && /^SEL-[a-zA-Z0-9_-]+\.json$/.test(parts[1]) && !parts[1].includes('/');
    if (!isValidStamp) {
        throw new Error(`Alvo inválido para gravação exclusiva de json final no Netlify: ${target}`);
    }

    const blobKey = 'manifests/' + parts[1];

    let baselineExists = false;
    try {
        await access(target, constants.F_OK);
        baselineExists = true;
    } catch {
        baselineExists = false;
    }
    if (baselineExists) {
        const err = new Error('EEXIST');
        err.code = 'EEXIST';
        throw err;
    }

    const blobStore = getBlobStore();
    const result = await blobStore.setJSON(blobKey, value, { onlyIfNew: true });

    if (result && result.modified === false) {
        const err = new Error('EEXIST');
        err.code = 'EEXIST';
        throw err;
    }
}

export const readMutableManifest = async (target) => {
    if (!isServerlessEngine()) {
        // Regra FS estrita local - usando a leitura primitiva local
        const fsRaw = await readFile(target, 'utf8');
        return JSON.parse(fsRaw);
    }

    const blobKey = getBlobKey(target);
    if (!blobKey || !blobKey.includes('manifests/')) {
        throw new Error('readMutableManifest suporta apenas manifests do catálogo');
    }

    const blobStore = getBlobStore();

    const blobRaw = await blobStore.get(blobKey);
    if (blobRaw !== null && blobRaw !== undefined) {
        return JSON.parse(blobRaw);
    }

    let baselineData;
    try {
        const fsRaw = await readFile(target, 'utf8');
        baselineData = JSON.parse(fsRaw);
    } catch (err) {
        throw err; // Fail explicitly Se o baseline não existir
    }

    const res = await blobStore.setJSON(blobKey, baselineData, { onlyIfNew: true });

    if (res && res.modified === false) {
        // Criou simultaneamente e perdemos
        const survivorRaw = await blobStore.get(blobKey);
        if (survivorRaw !== null && survivorRaw !== undefined) {
            return JSON.parse(survivorRaw);
        }
        throw new Error('Falha colisional no bootstrap: blob inexistente após concorrência');
    }

    return baselineData; // Vencedor da corrida de criação
};

export const updateMutableManifestAtomic = async (target, modifier) => {
    if (!isServerlessEngine()) {
        const fsRaw = await readFile(target, 'utf8');
        const nextData = modifier(JSON.parse(fsRaw));
        await writeJsonAtomic(target, nextData);
        return nextData;
    }

    const blobKey = getBlobKey(target);
    if (!blobKey || !blobKey.includes('manifests/')) {
        throw new Error('updateMutableManifestAtomic suporta apenas manifests do catálogo');
    }

    const blobStore = getBlobStore();
    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const payload = await readBlobWithEtag(blobStore, blobKey, 'json');

        if (!payload || !payload.data) {
            throw new Error(`Manifest inexistente no Blob Storage para atualização atômica: ${target}`);
        }

        const currentEtag = payload.etag;
        const currentData = payload.data;

        if (!currentEtag) {
            throw new Error(`ETag indisponível para atualização atômica de ${target}`);
        }

        const nextData = modifier(currentData);

        const result = await blobStore.setJSON(blobKey, nextData, { onlyIfMatch: currentEtag, ...(payload.metadata ? { metadata: payload.metadata } : {}) });

        if (result && result.modified === false) {
            if (attempt === MAX_RETRIES) {
                throw new Error(`Concorrência intensa no Blob Store: max retries atingido para ${target}`);
            }
            continue;
        }

        return nextData;
    }
};

const mutableRecordPayload = async (target) => {
    const blobKey = getBlobKey(target);
    if (!blobKey || !/^manifests\/SEL-[0-9]{6}\.json$/.test(blobKey)) throw new Error(`Alvo inválido para materialização: ${target}`);
    const store = getBlobStore();
    let payload = await readBlobWithEtag(store, blobKey, 'json');
    if (payload?.data && payload.etag) return { store, blobKey, payload };
    const baseline = JSON.parse(await readFile(target, 'utf8'));
    const digest = baselineHash(baseline);
    const created = await store.setJSON(blobKey, baseline, { onlyIfNew: true, metadata: { baseline_hash: digest } });
    payload = await readBlobWithEtag(store, blobKey, 'json');
    if (!payload?.data || !payload.etag) throw new Error(`Registro indisponível após materialização: ${target}`);
    const recordedHash = payload.metadata?.baseline_hash;
    if (!isDeepEqual(payload.data, baseline) && recordedHash !== digest) throw conflictError('Divergência durante materialização do baseline.', 'RECORD_CONFLICT');
    if (created?.modified === false && recordedHash && recordedHash !== digest) throw conflictError('Baseline divergiu durante materialização.', 'RECORD_CONFLICT');
    return { store, blobKey, payload };
};
export const updateRecordAtomic = async (target, modifier) => {
    if (!isServerlessEngine()) {
        const fsRaw = await readFile(target, 'utf8');
        const nextData = modifier(JSON.parse(fsRaw));
        await writeJsonAtomic(target, nextData);
        return nextData;
    }

    const parts = target.split(/[\\/]data[\\/]selos[\\/]/);
    if (parts.length !== 2 || !/^SEL-[a-zA-Z0-9_-]+\.json$/.test(parts[1]) || parts[1].includes('/')) {
        throw new Error('Alvo inválido para updateRecordAtomic: ' + target);
    }
    const blobKey = 'manifests/' + parts[1];

    const { store: blobStore } = await mutableRecordPayload(target);
    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const payload = await readBlobWithEtag(blobStore, blobKey, 'json');

        if (!payload || !payload.data) {
            throw new Error(`Registro inexistente no Blob Storage para atualização atômica: ${target}`);
        }

        const currentEtag = payload.etag;
        const currentData = payload.data;

        if (!currentEtag) {
            throw new Error(`ETag indisponível para atualização atômica de ${target}`);
        }

        const nextData = modifier(currentData);

        const result = await blobStore.setJSON(blobKey, nextData, { onlyIfMatch: currentEtag, ...(payload.metadata ? { metadata: payload.metadata } : {}) });

        if (result && result.modified === false) {
            if (attempt === MAX_RETRIES) {
                throw new Error(`Concorrência intensa no Blob Store (Record): max retries atingido para ${target}`);
            }
            continue;
        }

        return nextData;
    }
};

export const existsAssetBinary = async (target) => {
    if (!isServerlessEngine()) {
        return access(target, constants.F_OK).then(() => true).catch(() => false);
    }
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para checagem de asset em nuvem: ${target}`);
    const blobStore = getBlobStore();
    if (typeof blobStore.getMetadata === 'function') {
        const meta = await blobStore.getMetadata(blobKey, { consistency: 'strong' });
        if (meta !== null && meta.etag !== undefined) return true;
    }
    if ((await blobStore.get(blobKey, { type: 'arrayBuffer', consistency: 'strong' })) != null) return true;
    for (const candidate of assetFilesystemCandidates(target, blobKey)) {
        if (await access(candidate, constants.F_OK).then(() => true).catch(() => false)) return true;
    }
    return false;
};

/** Public media comes exclusively from the approved Git build, never draft Blobs. */
export const readPublishedAssetBinary = async (target) => {
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error('Alvo inválido para leitura de asset publicado: ' + target);
    return readAssetFromFilesystem(target, blobKey);
};

export const readAssetBinary = async (target) => {
    if (!isServerlessEngine()) {
        return readFile(target);
    }
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para leitura de asset em nuvem: ${target}`);
    const blobStore = getBlobStore();
    const arr = await blobStore.get(blobKey, { type: 'arrayBuffer', consistency: 'strong' });
    if (arr) return Buffer.from(arr);
    return readAssetFromFilesystem(target, blobKey);
};

export const writeAssetBinary = async (target, buffer, mimeType = null) => {
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para escrita de asset: ${target}`);

    if (!isServerlessEngine()) {
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, buffer);
            await rename(temporary, target);
        } catch (err) {
            await unlink(temporary).catch(() => { });
            throw err;
        }
        return;
    }

    const blobStore = getBlobStore();
    const options = {};
    if (mimeType) {
        options.metadata = { 'content-type': mimeType };
    }
    await blobStore.set(blobKey, buffer, options);
};
/** @param {string} target @param {Buffer|Uint8Array} buffer @param {string|null} mimeType */
export const beginAssetCreation = async (target, buffer, mimeType = null) => {
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para criação de asset: ${target}`);
    if (!isServerlessEngine()) {
        await mkdir(path.dirname(target), { recursive: true });
        try { await writeFile(target, buffer, { flag: 'wx' }); }
        catch (error) { if (error?.code === 'EEXIST') throw conflictError('Asset já existe.', 'ASSET_CONFLICT'); throw error; }
        const snapshot = await stat(target, { bigint: true });
        return { commit: async () => {}, rollback: async () => {
            const quarantine = `${target}.${process.pid}.${randomUUID()}.rollback`;
            await rename(target, quarantine);
            if (!sameFile(snapshot, await stat(quarantine, { bigint: true }))) { await rename(quarantine, target); throw conflictError('Asset mudou; rollback recusado.', 'ASSET_CONFLICT'); }
            await unlink(quarantine);
        } };
    }
    const store = getBlobStore();
    const created = await store.set(blobKey, buffer, { onlyIfNew: true, ...(mimeType ? { metadata: { 'content-type': mimeType } } : {}) });
    if (!created || created.modified === false || !created.etag) throw conflictError('Asset já existe.', 'ASSET_CONFLICT');
    return { commit: async () => {}, rollback: async () => {
        const tombstone = Buffer.from(`rollback:${randomUUID()}`);
        const claimed = await store.set(blobKey, tombstone, { onlyIfMatch: created.etag, metadata: { transaction_state: 'rollback' } });
        if (!claimed || claimed.modified === false || !claimed.etag) throw conflictError('Asset mudou; rollback recusado.', 'ASSET_CONFLICT');
        const current = await store.getMetadata(blobKey, { consistency: 'strong' });
        if (!current || current.etag !== claimed.etag) throw conflictError('Asset mudou após compensação; remoção recusada.', 'ASSET_CONFLICT');
        await store.delete(blobKey);
    } };
};
const conflictError = (message, code) => Object.assign(new Error(message), { code });
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

export const updateRecordExpected = async (target, expectedUpdatedAt, modifier) => {
    if (!isServerlessEngine()) {
        const snapshot = await stat(target, { bigint: true });
        const current = JSON.parse(await readFile(target, 'utf8'));
        if (current.auditoria?.ultima_revisao !== expectedUpdatedAt) throw conflictError('O registro mudou desde que foi aberto.', 'RECORD_CONFLICT');
        const next = modifier(structuredClone(current));
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        try {
            await rename(target, backup);
            if (!sameFile(snapshot, await stat(backup, { bigint: true }))) {
                await rename(backup, target);
                throw conflictError('O registro mudou durante a retificação.', 'RECORD_CONFLICT');
            }
            await link(temporary, target);
            await unlink(temporary);
            await unlink(backup);
            return next;
        } catch (error) {
            await unlink(temporary).catch(() => {});
            if (!(await access(target).then(() => true).catch(() => false)) && await access(backup).then(() => true).catch(() => false)) await rename(backup, target);
            throw error;
        }
    }
    const blobKey = getBlobKey(target);
    if (!blobKey || !/^manifests\/SEL-[0-9]{6}\.json$/.test(blobKey)) throw new Error(`Alvo inválido para atualização condicional: ${target}`);
    const { store, payload } = await mutableRecordPayload(target);
    if (!payload?.data || !payload.etag) throw new Error(`Registro ou ETag indisponível: ${target}`);
    if (payload.data.auditoria?.ultima_revisao !== expectedUpdatedAt) throw conflictError('O registro mudou desde que foi aberto.', 'RECORD_CONFLICT');
    const next = modifier(structuredClone(payload.data));
    const result = await store.setJSON(blobKey, next, { onlyIfMatch: payload.etag, ...(payload.metadata ? { metadata: payload.metadata } : {}) });
    if (!result || result.modified === false) throw conflictError('O registro mudou durante a retificação.', 'RECORD_CONFLICT');
    return next;
};

/**
 * @param {string} target
 * @param {Buffer|Uint8Array} replacement
 * @param {string|null} mimeType
 * @param {{ expectedSha256?: string | null }} [options]
 */
export const beginAssetReplacement = async (target, replacement, mimeType = null, { expectedSha256 = null } = {}) => {
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para substituição de asset: ${target}`);
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw conflictError('Hash esperado inválido.', 'ASSET_CONFLICT');
    const matchesExpected = (bytes) => expectedSha256 === null || createHash('sha256').update(bytes).digest('hex') === expectedSha256;
    if (!isServerlessEngine()) {
        const snapshot = await stat(target, { bigint: true });
        if (!matchesExpected(await readFile(target))) throw conflictError('O asset mudou após arquivamento.', 'ASSET_CONFLICT');
        const backup = `${target}.${process.pid}.${randomUUID()}.backup`;
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, replacement);
        try {
            await rename(target, backup);
            if (!sameFile(snapshot, await stat(backup, { bigint: true })) || !matchesExpected(await readFile(backup))) {
                await rename(backup, target);
                throw conflictError('O asset mudou durante a retificação.', 'ASSET_CONFLICT');
            }
            await link(temporary, target);
            await unlink(temporary);
        } catch (error) {
            await unlink(temporary).catch(() => {});
            if (!(await access(target).then(() => true).catch(() => false)) && await access(backup).then(() => true).catch(() => false)) await rename(backup, target);
            throw error;
        }
        const replacementSnapshot = await stat(target, { bigint: true });
        return {
            commit: async () => { await unlink(backup); },
            rollback: async () => {
                const quarantine = `${target}.${process.pid}.${randomUUID()}.rollback`;
                await rename(target, quarantine);
                if (!sameFile(replacementSnapshot, await stat(quarantine, { bigint: true }))) {
                    await rename(quarantine, target);
                    throw conflictError('O asset foi alterado por outro processo; rollback recusado.', 'ASSET_CONFLICT');
                }
                await rename(backup, target);
                await unlink(quarantine);
            }
        };
    }
    const store = getBlobStore();
    let snapshot = await readBlobWithEtag(store, blobKey, 'arrayBuffer');
    if (!snapshot?.data) {
        // Materialize the deployed asset once; the Git original remains untouched.
        const baseline = await readAssetFromFilesystem(target, blobKey);
        const created = await store.set(blobKey, baseline, { onlyIfNew: true, ...(mimeType ? { metadata: { 'content-type': mimeType } } : {}) });
        snapshot = await readBlobWithEtag(store, blobKey, 'arrayBuffer');
        if (!created?.modified || !snapshot?.data || !snapshot.etag ||
            (created.etag && snapshot.etag !== created.etag) || !Buffer.from(snapshot.data).equals(baseline)) {
            throw conflictError('O asset mudou durante a materialização.', 'ASSET_CONFLICT');
        }
    }
    if (!snapshot.etag) throw conflictError('ETag indisponível para retificação de asset.', 'ASSET_CONFLICT');
    if (!matchesExpected(Buffer.from(snapshot.data))) throw conflictError('O asset mudou após arquivamento.', 'ASSET_CONFLICT');
    const replaced = await store.set(blobKey, replacement, { onlyIfMatch: snapshot.etag, ...(mimeType ? { metadata: { 'content-type': mimeType } } : {}) });
    if (!replaced || replaced.modified === false || !replaced.etag) throw conflictError('O asset mudou durante a retificação.', 'ASSET_CONFLICT');
    return {
        commit: async () => {},
        rollback: async () => {
            const restored = await store.set(blobKey, Buffer.from(snapshot.data), { onlyIfMatch: replaced.etag, ...(mimeType ? { metadata: { 'content-type': mimeType } } : {}) });
            if (!restored || restored.modified === false) throw conflictError('O asset foi alterado por outro processo; rollback recusado.', 'ASSET_CONFLICT');
        }
    };
};
/** Stage only an explicitly validated published manifest, preserving every draft reservation. */
export async function stageManifestBaseline(expectedDigest, publishedManifest, { target = ID_MANIFEST } = {}) {
    if (getBlobKey(target) !== 'manifests/ids.json' || !isServerlessEngine()) throw conflictError('Preparação de baseline exige manifesto administrativo em Blobs.', 'RECORD_CONFLICT');
    if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) throw conflictError('Hash esperado do manifesto inválido.', 'RECORD_CONFLICT');
    const baseline = JSON.parse(await readFile(target, 'utf8'));
    await readMutableManifest(target);
    const store = getBlobStore();
    for (let attempt = 0; attempt < 5; attempt++) {
        let payload = await readBlobWithEtag(store, 'manifests/ids.json', 'json');
        if (!payload?.data || !payload.etag) throw conflictError('Manifesto ou ETag indisponível.', 'RECORD_CONFLICT');
        if (payload.metadata?.baseline_hash) payload = await reconcileBaseline(store, 'manifests/ids.json', payload, baseline, target);
        if (jsonDigest(payload.data) !== expectedDigest) throw conflictError('O manifesto mudou durante a preparação da publicação.', 'RECORD_CONFLICT');
        const currentBaseline = baselineHash(baseline), nextBaseline = baselineHash(publishedManifest);
        const pending = payload.metadata?.pending_baseline_hash;
        if (pending && pending !== currentBaseline && pending !== nextBaseline) throw conflictError('Há outra publicação com manifesto pendente de integração. Confirme seu estado no GitHub antes de continuar.', 'MANIFEST_PUBLICATION_PENDING');
        const metadata = { ...payload.metadata, baseline_hash: currentBaseline };
        if (nextBaseline !== currentBaseline) metadata.pending_baseline_hash = nextBaseline;
        else delete metadata.pending_baseline_hash;
        const result = await store.setJSON('manifests/ids.json', payload.data, { onlyIfMatch: payload.etag, metadata });
        if (result?.modified === true) return { baseline_hash: metadata.baseline_hash, pending_baseline_hash: metadata.pending_baseline_hash };
    }
    throw conflictError('Concorrência intensa no manifesto antes da publicação.', 'RECORD_CONFLICT');
}
