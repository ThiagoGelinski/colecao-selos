import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/pages/api/admin/selos/index.ts';

// Constantes e Mocks de Baseline
const ID_MANIFEST = 'manifests/ids.json';
const SELO_EXISTENTE = { id: 'SEL-000001', slug: 'brasil-campos-salles-20-centavos-1967' };

// Helpers de Configuração de Contexto Astro
const createContext = (bodyObj, isAuthenticated = true) => {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const reqHeaders = new Headers({
        'content-type': 'application/json',
        'content-length': String(bodyStr.length)
    });

    return {
        request: {
            headers: reqHeaders,
            text: async () => bodyStr
        },
        locals: isAuthenticated ? { adminUser: { username: 'tester' } } : {}
    };
};

// Extrator do Astro JSON Response
const parseJsonResponse = async (response) => {
    return JSON.parse(await response.clone().text());
};

test('Microbloco 2A.1.13 - POST Administrativo (Integração Serverless Blobs)', async (t) => {
    let blobData = {};
    let mockEtagSequence = 1;

    t.beforeEach(async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        blobData = {
            'manifests/ids.json': {
                next_sequence: 100,
                reserved: []
            }
        }; // Force clean baseline mapping
        mockEtagSequence = 1; // Reset ETag sequence counter

        globalThis.__MOCK_BLOB_STORE = {
            get: async (key, opts) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            getWithMetadata: async (key) => {
                if (blobData[key]) return { data: structuredClone(blobData[key]), metadata: {}, etag: `mock-etag-${mockEtagSequence}` };
                return null;
            },
            setJSON: async (key, val, opts) => {
                blobData[key] = structuredClone(val);
                mockEtagSequence++;
                return;
            },
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };
    });

    t.afterEach(async () => {
        globalThis.__MOCK_NETLIFY_ENV = false;
        globalThis.__MOCK_BLOB_STORE = null;
    });

    await t.test('1. POST Válido (Autenticado, Payload Correto)', async () => {
        const ctx = createContext({ titulo: 'Meu Selo Válido', slug: 'meu-selo' });
        const res = await POST(ctx);
        if (res.status !== 201) console.error(await parseJsonResponse(res));
        assert.equal(res.status, 201);

        const payload = await parseJsonResponse(res);
        assert.ok(payload.data.id.startsWith('SEL-'));
        assert.equal(payload.data.slug, 'meu-selo');

        // Assert Persistence
        const manifest = blobData[ID_MANIFEST];
        assert.ok(manifest);
        assert.equal(manifest.reserved.length, 1);
        assert.equal(manifest.reserved[0].status, 'criado');
        assert.ok(blobData[`manifests/${payload.data.id}.json`]);
    });

    await t.test('2. Autenticação/Autorização (401 se ausente)', async () => {
        const ctx = createContext({ titulo: 'Unauthorized', slug: 'n' }, false);
        const res = await POST(ctx);
        assert.equal(res.status, 401);
    });

    await t.test('3. Payload Inválido (422, sem título)', async () => {
        const ctx = createContext({ slug: 'meu-selo' }); // Missing Titulo
        const res = await POST(ctx);
        assert.equal(res.status, 422);
    });

    await t.test('4. Payload Inválido (422, slug inválido sintaticamente após sanitização)', async () => {
        const ctx = createContext({ titulo: '???', slug: '!!!' });
        const res = await POST(ctx);
        assert.equal(res.status, 422);
    });

    await t.test('5. Duplicidade Baseline (409)', async () => {
        const ctx = createContext({ titulo: 'Conflito', slug: SELO_EXISTENTE.slug });
        const res = await POST(ctx);
        assert.equal(res.status, 409);
        const err = await parseJsonResponse(res);
        assert.ok(err.error.message.includes('Slug já utilizado'));
    });

    await t.test('6. Duplicidade Blob (409)', async () => {
        // First successful
        const ctx1 = createContext({ titulo: 'First', slug: 'mesmo-slug' });
        await POST(ctx1);

        // Second should fail with 409
        const ctx2 = createContext({ titulo: 'Second', slug: 'mesmo-slug' });
        const res = await POST(ctx2);
        assert.equal(res.status, 409);
    });

    await t.test('7. Dois POSTs Sequenciais (Avanço Funcional ID)', async () => {
        const ctx1 = createContext({ titulo: 'Seq 1', slug: 'seq-1' });
        const res1 = await POST(ctx1);
        const pay1 = await parseJsonResponse(res1);

        const ctx2 = createContext({ titulo: 'Seq 2', slug: 'seq-2' });
        const res2 = await POST(ctx2);
        const pay2 = await parseJsonResponse(res2);

        assert.notEqual(pay1.data.id, pay2.data.id);
        const man = blobData[ID_MANIFEST];
        assert.equal(man.reserved.length, 2);
    });

    await t.test('8. Dois POSTs Concorrentes (Race Conditions resolvidos)', async () => {
        let globalETagValidationCount = 0;
        let etagState = 1;

        // Concurrency Strict Mock Handler exactly as transactions-serverless
        globalThis.__MOCK_BLOB_STORE.setJSON = async (key, val, opts) => {
            if (key === ID_MANIFEST && opts?.onlyIfMatch) {
                globalETagValidationCount++;
                if (opts.onlyIfMatch === `mock-etag-${etagState}`) {
                    etagState++;
                    blobData[key] = structuredClone(val);
                    return { modified: true, etag: `mock-etag-${etagState}` };
                }
                return { modified: false };
            }
            blobData[key] = structuredClone(val);
            etagState++;
            return { modified: true };
        };

        globalThis.__MOCK_BLOB_STORE.getWithMetadata = async (key) => {
            if (blobData[key]) return { data: structuredClone(blobData[key]), metadata: {}, etag: `mock-etag-${etagState}` };
            return null;
        };
        globalThis.__MOCK_BLOB_STORE.get = async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null;

        const ctx1 = createContext({ titulo: 'Race 1', slug: 'race-1' });
        const ctx2 = createContext({ titulo: 'Race 2', slug: 'race-2' });

        const [res1, res2] = await Promise.all([POST(ctx1), POST(ctx2)]);
        assert.equal(res1.status, 201);
        assert.equal(res2.status, 201);

        const pay1 = await parseJsonResponse(res1);
        const pay2 = await parseJsonResponse(res2);
        assert.notEqual(pay1.data.id, pay2.data.id);


        const manifest = blobData[ID_MANIFEST];
        assert.equal(manifest.reserved.length, 2);
    });

    await t.test('9. Falha Pré-Criação: Simulando falha pós-Id para validar Manifest Fallback', async () => {
        // Limpeza preventiva: evita contaminação cruzada com admin-leitura-dual-source (test D) em modo paralelo
        const { rm: rmFs } = await import('node:fs/promises');
        const { default: pathMod } = await import('node:path');
        await rmFs(pathMod.join(process.cwd(), 'src/data/selos/SEL-999400.json'), { force: true }).catch(() => { });

        let originalSet = globalThis.__MOCK_BLOB_STORE.setJSON;
        let called = false;

        globalThis.__MOCK_BLOB_STORE.setJSON = async (key, val, opts) => {
            // Force error when creating the individual stamp JSON
            if (key.startsWith('manifests/SEL-') && key.endsWith('.json') && key !== 'manifests/ids.json') {
                called = true;
                const fakeErr = new Error('Simulated JSON storage failure');
                fakeErr.name = 'TransactionError';
                throw fakeErr;
            }
            await originalSet(key, val, opts);
        };

        const ctx = createContext({ titulo: 'Vai Falhar', slug: 'vai-falhar' });
        const res = await POST(ctx);
        const err = await parseJsonResponse(res);
        assert.equal(res.status, 409); // Translated by safe failure wrapper

        const manifest = blobData[ID_MANIFEST];
        assert.ok(manifest.reserved.length > 0);

        const reservation = manifest.reserved.find(r => r.slug === 'vai-falhar');
        assert.ok(reservation);
        assert.equal(reservation.status, 'falha_na_criacao', 'Manifest fallback applied flawlessly via domain closure');
        assert.ok(called, 'Mock fallback executed');
    });
});
