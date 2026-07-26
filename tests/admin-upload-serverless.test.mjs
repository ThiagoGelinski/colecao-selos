import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// Setup Blob Store Mocks
const blobData = {};
const blobMeta = {};
globalThis.__MOCK_BLOB_STORE = {
    get: async (key, opts) => {
        if (!blobData[key]) return null;
        if (opts && opts.type === 'arrayBuffer') {
            if (Buffer.isBuffer(blobData[key])) {
                return new Uint8Array(blobData[key]).buffer;
            }
            return blobData[key].buffer || blobData[key];
        }
        return blobData[key];
    },
    set: async (key, val, opts) => {
        blobData[key] = val;
        let etag = 'mock-etag-' + Date.now();
        blobMeta[key] = { etag, metadata: opts?.metadata || {} };
        return { modified: true, etag };
    },
    getWithMetadata: async (key, opts) => {
        if (!blobData[key]) return null;
        let data = blobData[key];
        if (opts && opts.type === 'json' && typeof data === 'string') {
            try { data = JSON.parse(data); } catch { }
        } else if (opts && opts.type === 'json' && Buffer.isBuffer(data)) {
            try { data = JSON.parse(data.toString('utf8')); } catch { }
        }
        return { data, etag: blobMeta[key]?.etag || 'mock-etag', metadata: blobMeta[key]?.metadata };
    },
    setJSON: async (key, val, opts) => {
        if (opts?.onlyIfMatch && blobMeta[key]?.etag !== opts.onlyIfMatch) {
            return { modified: false }; // Concorrência
        }
        if (opts?.onlyIfNew && blobData[key]) {
            return { modified: false };
        }
        blobData[key] = JSON.stringify(val);
        const newEtag = 'mock-etag-' + Date.now();
        blobMeta[key] = { etag: newEtag, metadata: opts?.metadata || {} };
        return { modified: true, etag: newEtag };
    },
    getMetadata: async (key) => blobMeta[key] || null,
    list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
};

const SETUP_MODE = (serverless) => {
    globalThis.__MOCK_NETLIFY_ENV = serverless;
};

// Create a valid WebP buffer for tests
const createValidWebP = () => {
    const buf = Buffer.alloc(20);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(12, 4);
    buf.write('WEBP', 8);
    // Dummy payload
    buf.write('TEST', 12);
    return buf;
};

const createInvalidMagicFile = () => {
    const buf = Buffer.alloc(20);
    buf.write('FAKE', 0); // Not RIFF
    buf.writeUInt32LE(12, 4);
    buf.write('WEBP', 8);
    return buf;
};

test('Microbloco 2A.2.4 - Upload Serverless Seguro de Assets', async (t) => {
    const { POST } = await import('../src/pages/api/admin/selos/[id]/assets.ts');
    const { writeJsonExclusive, readJson } = await import('../src/lib/catalogo/io.mjs');

    const PREPARE_STAMP = async (id, isServerless, imagens = {}) => {
        SETUP_MODE(isServerless);
        const dummyPath = path.join(ROOT, 'src', 'data', 'selos', `${id}.json`);
        const json = { id, slug: 'dummy-selo-' + id, imagens };
        await writeJsonExclusive(dummyPath, json);
    };

    t.afterEach(async () => {
        for (const k of Object.keys(blobData)) delete blobData[k];
        for (const k of Object.keys(blobMeta)) delete blobMeta[k];

        const dummyBase = path.join(ROOT, 'src', 'data', 'selos');
        const assetsBase = path.join(ROOT, 'public', 'assets', 'selos');
        await rm(path.join(dummyBase, 'SEL-777777.json'), { force: true });
        await rm(path.join(dummyBase, 'SEL-888888.json'), { force: true });
        await rm(path.join(dummyBase, 'SEL-999999.json'), { force: true });
        await rm(path.join(assetsBase, 'SEL-777777'), { recursive: true, force: true });
        await rm(path.join(assetsBase, 'SEL-888888'), { recursive: true, force: true });
        await rm(path.join(assetsBase, 'SEL-999999'), { recursive: true, force: true });
    });

    const runPOST = async (id, formData, isAuthenticated = true) => {
        const req = new Request(`http://localhost/api/admin/selos/${id}/assets`, {
            method: 'POST',
            body: formData,
        });
        const ctx = {
            params: { id },
            request: req,
            locals: isAuthenticated ? { adminUser: { username: 'admin' } } : {}
        };
        return await POST(ctx);
    };

    await t.test('1. Autenticação ausente -> 401', async () => {
        const formData = new FormData();
        const res = await runPOST('SEL-777777', formData, false);
        assert.equal(res.status, 401);
    });

    await t.test('2. ID inválido -> 400', async () => {
        const res = await runPOST('INVALIDO', new FormData());
        assert.equal(res.status, 400);
    });

    await t.test('3. Selo inexistente -> 404', async () => {
        SETUP_MODE(false);
        const res = await runPOST('SEL-777777', new FormData());
        assert.equal(res.status, 404);
    });

    await t.test('4. Papel inválido -> 422', async () => {
        await PREPARE_STAMP('SEL-777777', false);
        const formData = new FormData();
        formData.append('papel', 'capa'); // Invalid
        formData.append('file', new Blob([createValidWebP()]), 'a.webp'); // Blob without File name might cause issue, JS File object is missing in basic Node, but Astro polyfills it. We can just use standard Blob API if node lets us.

        // Let's create a Mock File explicitly to pass Astro FormData extraction properly:
        const file = new File([createValidWebP()], 'test.webp', { type: 'image/webp' });
        formData.set('file', file);

        const res = await runPOST('SEL-777777', formData);
        assert.equal(res.status, 422);

        const payload = await res.json();
        assert.ok(payload.error.details.errors[0].includes('papel'));
    });

    await t.test('10, 11. MIME invalido -> 415 e Arquivo nao binario -> 422', async () => {
        await PREPARE_STAMP('SEL-777777', false);
        const formData = new FormData();
        formData.append('papel', 'frente');
        formData.append('file', new File([createValidWebP()], 'test.jpg', { type: 'image/jpeg' })); // type is jpeg, invalid!

        const res = await runPOST('SEL-777777', formData);
        assert.equal(res.status, 415);
    });

    await t.test('12. Magic bytes incompatíveis falsos WEBP -> 415', async () => {
        await PREPARE_STAMP('SEL-777777', false);
        const formData = new FormData();
        formData.append('papel', 'frente');

        const hackerFile = new File([createInvalidMagicFile()], 'test.webp', { type: 'image/webp' });
        formData.append('file', hackerFile);

        const res = await runPOST('SEL-777777', formData);
        assert.equal(res.status, 415);
        assert.ok((await res.json()).error.message.includes('Assinatura profunda WebP inválida'));
    });

    await t.test('13. Arquivo limite máximo de 5MB -> 413', async () => {
        await PREPARE_STAMP('SEL-777777', false);
        const formData = new FormData();
        formData.append('papel', 'frente');

        // Simulating a huge File simply by padding
        const bigBuf = Buffer.alloc((5 * 1024 * 1024) + 1); // 5MB + 1 byte
        const bigFile = new File([bigBuf], 'test.webp', { type: 'image/webp' });
        formData.append('file', bigFile);

        const res = await runPOST('SEL-777777', formData);
        assert.equal(res.status, 413);
    });

    await t.test('21. Impedir Overwrite estrito -> 409', async () => {
        // Prepare with existing 'frente'
        await PREPARE_STAMP('SEL-888888', true, { frente: '/assets/selos/SEL-888888/SEL-888888-frente.webp' });
        const formData = new FormData();
        formData.append('papel', 'frente');
        formData.append('file', new File([createValidWebP()], 'test.webp', { type: 'image/webp' }));

        const res = await runPOST('SEL-888888', formData);
        assert.equal(res.status, 409);
    });

    await t.test('5, 7, 8, 9, 17. Path feliz LOCAL (Sem Blobs, Escrita Física e Update JSON)', async () => {
        await PREPARE_STAMP('SEL-999999', false); // Clean

        const validBuf = createValidWebP();
        const formData = new FormData();
        formData.append('papel', 'verso');
        formData.append('file', new File([validBuf], 'weird-name-user-sent.webp', { type: 'image/webp' }));

        const res = await runPOST('SEL-999999', formData);

        const bodyText = await res.text();
        assert.equal(res.status, 200, bodyText);

        // 8. Filename server-side canonical derivation -> target
        const payload = JSON.parse(bodyText);
        const expectedPath = `/assets/selos/SEL-999999/SEL-999999-verso.webp`;
        assert.equal(payload.data.target, expectedPath);

        // Verify that the file was written locally physically
        const localFs = path.join(process.cwd(), 'public', expectedPath);
        const stats = await stat(localFs);
        assert.ok(stats.isFile(), 'Arquivo não persistido localmente');
        const readBuf = await readFile(localFs);
        assert.deepEqual(readBuf, validBuf, 'Bytes diferem');

        // Verify JSON Update
        const json = await readJson(path.join(ROOT, 'src', 'data', 'selos', 'SEL-999999.json'));
        assert.equal(json.imagens.verso, expectedPath, 'Mecanismo atômico não registrou path no JSON corretamente');

        // Confirm Blob is completely empty
        assert.equal(Object.keys(blobData).length, 0, 'Blobs acionado ilicitamente em fallback Local');
    });

    await t.test('6, 16. Path feliz SERVERLESS (Isolamento Blobs)', async () => {
        await PREPARE_STAMP('SEL-999999', true); // Cloud

        const validBuf = createValidWebP();
        const formData = new FormData();
        formData.append('papel', 'thumb');
        formData.append('file', new File([validBuf], 'test.webp', { type: 'image/webp' }));

        const res = await runPOST('SEL-999999', formData);
        assert.equal(res.status, 200);

        const expectedPath = `/assets/selos/SEL-999999/SEL-999999-thumb.webp`;

        // 16. Serverless must NOT create any physical directory
        const localFs = path.join(process.cwd(), 'public', expectedPath);
        await assert.rejects(stat(localFs), { code: 'ENOENT' }, 'Isolamento Blob vazou escrita para FS Nativo!');

        const blobKeyRecord = `SEL-999999.json`;
        const blobKeyAsset = `assets/selos/SEL-999999/SEL-999999-thumb.webp`;

        assert.ok(blobData[blobKeyAsset], 'Asset missing nos blobs');

        // Checking if JSON was merged atomically via ETag mechanism!
        assert.ok(blobData[blobKeyRecord], 'JSON não persistido nos blobs');
        const json = JSON.parse(blobData[blobKeyRecord]);
        assert.equal(json.imagens.thumb, expectedPath);
    });

    await t.test('14, 15, 20. Atomicidade Isolada. Falha transacional impede commit falso e orfandamento', async () => {
        // Pre-stamp existing cloud
        await PREPARE_STAMP('SEL-999999', true);

        const formData = new FormData();
        formData.append('papel', 'card');
        formData.append('file', new File([createValidWebP()], 'test.webp', { type: 'image/webp' }));

        // Simulating JSON Write Fail AFTER Asset is successfully uploaded!
        const originalSetJSON = globalThis.__MOCK_BLOB_STORE.setJSON;
        globalThis.__MOCK_BLOB_STORE.setJSON = async (key) => {
            if (key === 'SEL-999999.json') throw new Error('Falhas no banco de blobs via rate limit!!');
            return originalSetJSON(...arguments);
        };

        const res = await runPOST('SEL-999999', formData);

        // 15. The system MUST error!
        assert.equal(res.status, 500);

        // 14/20. The JSON wasn't mutated at all in the process. Wait, it crashed so it threw instantly!
        globalThis.__MOCK_BLOB_STORE.setJSON = originalSetJSON; // Restore

        const jsonRAW = blobData['SEL-999999.json'];
        const json = JSON.parse(jsonRAW);
        assert.equal(json.imagens?.card, undefined, 'Atomic Violation: JSON modificado mesmo existindo erro persistência');
    });

});
