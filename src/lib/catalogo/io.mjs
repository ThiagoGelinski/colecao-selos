import { access, mkdir, readFile, rename, writeFile, readdir, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const isServerlessEngine = () => {
    if (globalThis.__MOCK_NETLIFY_ENV) return true;
    if (typeof process !== 'undefined' && process.env && (process.env.NETLIFY === 'true' || process.env.SITE_ID)) return true;
    return false;
};

let _blobStore = null;
const getBlobStore = () => {
    if (globalThis.__MOCK_BLOB_STORE) return globalThis.__MOCK_BLOB_STORE;
    if (!_blobStore) {
        _blobStore = getStore('colecao-selos-catalogo');
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
        return seloMatch[1];
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

    const blobStore = getBlobStore();
    const blobRaw = await blobStore.get(blobKey);

    if (blobRaw === null || blobRaw === undefined) {
        if (baselineError) throw baselineError;
        return baselineData;
    }

    const blobData = JSON.parse(blobRaw);

    if (!baselineError) {
        if (!isDeepEqual(blobData, baselineData)) {
            throw new Error(`Inconsistência Crítica (Dual-Source): Divergência de dados inaceitável no alvo ${target}`);
        }
    }

    return blobData;
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
        .filter(b => b.key && b.key.endsWith('.json') && !b.key.includes('/'))
        .map(b => b.key);

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

    const blobKey = parts[1];

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
        const payload = await blobStore.getWithMetadata(blobKey, { type: 'json' });

        if (!payload || !payload.data) {
            throw new Error(`Manifest inexistente no Blob Storage para atualização atômica: ${target}`);
        }

        const currentEtag = payload.etag;
        const currentData = payload.data;

        if (!currentEtag) {
            throw new Error(`ETag indisponível para atualização atômica de ${target}`);
        }

        const nextData = modifier(currentData);

        const result = await blobStore.setJSON(blobKey, nextData, { onlyIfMatch: currentEtag });

        if (result && result.modified === false) {
            if (attempt === MAX_RETRIES) {
                throw new Error(`Concorrência intensa no Blob Store: max retries atingido para ${target}`);
            }
            continue;
        }

        return nextData;
    }
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
    const blobKey = parts[1];

    const blobStore = getBlobStore();
    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const payload = await blobStore.getWithMetadata(blobKey, { type: 'json' });

        if (!payload || !payload.data) {
            throw new Error(`Registro inexistente no Blob Storage para atualização atômica: ${target}`);
        }

        const currentEtag = payload.etag;
        const currentData = payload.data;

        if (!currentEtag) {
            throw new Error(`ETag indisponível para atualização atômica de ${target}`);
        }

        const nextData = modifier(currentData);

        const result = await blobStore.setJSON(blobKey, nextData, { onlyIfMatch: currentEtag });

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
    const meta = await blobStore.getMetadata(blobKey);
    return meta !== null && meta.etag !== undefined;
};

export const readAssetBinary = async (target) => {
    if (!isServerlessEngine()) {
        return readFile(target);
    }
    const blobKey = getAssetBlobKey(target);
    if (!blobKey) throw new Error(`Alvo inválido para leitura de asset em nuvem: ${target}`);
    const blobStore = getBlobStore();
    const arr = await blobStore.get(blobKey, { type: 'arrayBuffer' });
    if (!arr) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    }
    return Buffer.from(arr);
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
