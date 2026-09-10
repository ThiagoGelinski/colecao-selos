import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORIGINAL_CWD = process.cwd();
const ROOT = await mkdtemp(path.join(tmpdir(), 'selos-2a2-'));
process.chdir(ROOT);

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
    getMetadata: async (key) => blobMeta[key] || null
};

const SETUP_MODE = (serverless) => {
    globalThis.__MOCK_NETLIFY_ENV = serverless;
};

// Expose GET directly for unit tests
const runGET = async (id, filename) => {
    const { GET } = await import('../src/pages/assets/selos/[id]/[filename].ts');

    // Simulate Request
    const req = new Request(`http://localhost/assets/selos/${id}/${filename}`);
    const response = await GET({ params: { id, filename }, request: req });
    return response;
};

test('Microbloco 2A.2.3 - HTTP Serving Proxy', async (t) => {
    t.after(async () => { process.chdir(ORIGINAL_CWD); await rm(ROOT, { recursive: true, force: true }); });
    const { writeAssetBinary } = await import('../src/lib/catalogo/io.mjs');

    t.afterEach(async () => {
        for (const k of Object.keys(blobData)) delete blobData[k];
        for (const k of Object.keys(blobMeta)) delete blobMeta[k];
        const dummyDirA = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-999902');
        const dummyDirB = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-999903');
        await rm(dummyDirA, { recursive: true, force: true });
        await rm(dummyDirB, { recursive: true, force: true });
    });

    await t.test('1, 4, 9. Route GET (Local): Deve retornar 200, ArrayBuffer idêntico, Mime Correto e NUNCA tocar no Blob Store', async () => {
        SETUP_MODE(false);
        const originalBytes = Buffer.from([0x0A, 0x0B, 0x0C]);
        const testPath = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-999902', 'SEL-999902-frente.webp');

        await writeAssetBinary(testPath, originalBytes);

        const res = await runGET('SEL-999902', 'SEL-999902-frente.webp');
        assert.equal(res.status, 200, 'Esperava status 200');
        assert.equal(res.headers.get('content-type'), 'image/webp', 'Mime deve inferir .webp => image/webp');

        const resBuffer = Buffer.from(await res.arrayBuffer());
        assert.deepEqual(resBuffer, originalBytes, 'Bytes respondidos diferem dos originários FS');

        assert.equal(Object.keys(blobData).length, 0, 'O blob store NÃO PODE ter sido consultado em Local!');
    });

    await t.test('2. Rota pública nunca expõe um asset disponível somente em Blobs', async () => {
        SETUP_MODE(true);
        const draftBytes = Buffer.from([0xFF, 0x00, 0xAA]);
        const testPath = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-999903', 'SEL-999903-card.png');
        await writeAssetBinary(testPath, draftBytes, 'image/png');
        assert.ok(blobData['assets/selos/SEL-999903/SEL-999903-card.png']);
        const response = await runGET('SEL-999903', 'SEL-999903-card.png');
        assert.equal(response.status, 404, 'Rascunho privado não pode vazar pela URL pública');
        await assert.rejects(stat(testPath), { code: 'ENOENT' });
    });

    await t.test('3. Asset inexistente na Rota devolve 404 (Local e Cloud)', async () => {
        // Cloud Tests Fallback 404
        SETUP_MODE(true);
        const res1 = await runGET('SEL-008080', 'SEL-008080-thumb.webp');
        assert.equal(res1.status, 404, 'Deveria retornar 404 de Blobs');

        // Local Tests Fallback 404
        SETUP_MODE(false);
        const res2 = await runGET('SEL-008080', 'SEL-008080-thumb.webp');
        assert.equal(res2.status, 404, 'Deveria retornar 404 de FS local');
    });

    await t.test('5, 6, 7. Segurança Integrada de Requests SSG', async () => {
        SETUP_MODE(true);

        // 5. Traversal
        const res3 = await runGET('SEL-999902', '%2e%2e/%2e%2e/passwd');
        assert.equal(res3.status, 404, 'Falha segurança: Traversal id via uri block');

        const res4 = await runGET('../SEL-999902', 'SEL-999902-frente.webp');
        assert.equal(res4.status, 404, 'Falha segurança: Traversal path block');

        // 6. ID Divergente
        const res5 = await runGET('SEL-111111', 'SEL-222222-frente.webp');
        assert.equal(res5.status, 404, 'Falha segurança: ID do arquivo diverge do ID da pasta');

        // 7. Extensão Bloqueada // Tipo Bloqueado // Nome Arbitrário
        const res6 = await runGET('SEL-111111', 'SEL-111111-frente.mp4');
        assert.equal(res6.status, 404, 'Falha segurança: Video mp4 nao pode');

        const res7 = await runGET('SEL-111111', 'SEL-111111-secreto.webp');
        assert.equal(res7.status, 404, 'Falha segurança: Papel (secreto) invalido');

        const res8 = await runGET('SEL-111111', 'thumbnail.webp');
        assert.equal(res8.status, 404, 'Falha segurança: Nome base divergente');
    });
});
