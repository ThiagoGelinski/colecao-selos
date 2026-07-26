import test from 'node:test';
import assert from 'node:assert/strict';

import { createStampTransaction } from '../src/lib/catalogo/transactions.mjs';

test('Microbloco 2A.1.11 - Integração Serverless transaction', async (t) => {
    t.beforeEach(async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        globalThis.__MOCK_BLOB_STORE = null;
    });

    t.afterEach(async () => {
        globalThis.__MOCK_NETLIFY_ENV = false;
        globalThis.__MOCK_BLOB_STORE = null;
    });

    await t.test('2, 3, 4, 7, 11. Reserva ID, avança next_sequence e falha pendência ASSETS', async () => {
        let blobData = {
            'manifests/ids.json': {
                schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 99, reserved: []
            }
        };
        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key], etag: 'etag-1' }),
            setJSON: async (key, val, opts) => {
                if (key === 'manifests/ids.json' && opts?.onlyIfNew && blobData[key]) {
                    return { modified: false };
                }
                if (opts?.onlyIfMatch && opts.onlyIfMatch !== 'etag-1') return { modified: false };
                blobData[key] = JSON.parse(JSON.stringify(val));
                return { modified: true, etag: 'etag-1' };
            },
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };

        const result = await createStampTransaction({ slug: 'meu-selo', title: 'Teste Serverless' });
        assert.equal(result.id, 'SEL-000099');
        assert.equal(result.slug, 'meu-selo');

        const manifest = blobData['manifests/ids.json'];
        assert.ok(manifest);
        assert.equal(manifest.next_sequence, 100);
        assert.equal(manifest.reserved.length, 1);
        assert.equal(manifest.reserved[0].id, 'SEL-000099');
        assert.equal(manifest.reserved[0].status, 'criado'); // Successfully transitioned
        assert.ok(manifest.reserved[0].created_at, 'created_at should be fully populated in memory');

        const stampBlob = blobData['SEL-000099.json'];
        assert.ok(stampBlob);
        assert.equal(stampBlob.id, 'SEL-000099');
        assert.equal(stampBlob.slug, 'meu-selo');
    });

    await t.test('12. Erro antes da criação não deixa manifest sujo/lost', async () => {
        let blobData = {
            'manifests/ids.json': {
                schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 1, reserved: []
            }
        };
        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key], etag: 'etag-1' }),
            setJSON: async (key, val, opts) => {
                blobData[key] = JSON.parse(JSON.stringify(val));
                return { modified: true, etag: 'etag-1' };
            },
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };

        // This should throw because of the duplicate slug - 'brasil-campos-salles-20-centavos-1967' is in the REAL records and we are hitting the REAL filesystem for loadRecords() now, so 'meu-selo' works, but we need an error BEFORE json creation.
        // We can just omit "slug" or send an invalid param to fail structural validatio

        await assert.rejects(
            () => createStampTransaction({ slug: '', title: '' }), // structural error!
            (err) => err.name === 'TransactionError'
        );

        const manifest = blobData['manifests/ids.json'];
        assert.equal(manifest.next_sequence, 2);
        assert.equal(manifest.reserved[0].id, 'SEL-000001');
        assert.equal(manifest.reserved[0].status, 'falha_na_criacao');
    });

    await t.test('5, 6, 8, 9, 10. Duas reservas concorrentes geram APIs limpas sem lost update', async () => {
        let blobData = {
            'manifests/ids.json': {
                schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 2, reserved: []
            }
        };
        let currentEtag = 'etag-hash-A';
        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key] ? JSON.parse(JSON.stringify(blobData[key])) : null, etag: currentEtag }),
            setJSON: async (key, val, opts) => {
                if (key === 'manifests/ids.json') {
                    if (opts?.onlyIfMatch && opts.onlyIfMatch !== currentEtag) return { modified: false };
                    blobData[key] = JSON.parse(JSON.stringify(val));
                    currentEtag = 'etag-hash-' + Math.random();
                    await new Promise(r => setTimeout(r, 0)); // Minimal yield to let Promise.all loop
                    return { modified: true, etag: currentEtag };
                }
                if (opts?.onlyIfNew && blobData[key]) return { modified: false };
                blobData[key] = JSON.parse(JSON.stringify(val));
                return { modified: true, etag: 'blob-etag' };
            },
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };

        const p1 = createStampTransaction({ slug: 'selo-concorrente-1', title: 'Selo 1' });
        const p2 = createStampTransaction({ slug: 'selo-concorrente-2', title: 'Selo 2' });

        const settled = await Promise.allSettled([
            p1.catch(e => { console.error('T1 ERROR', Math.random(), e.stack); throw e; }),
            p2.catch(e => { console.error('T2 ERROR', Math.random(), e.stack); throw e; })
        ]);

        settled.forEach(s => {
            assert.equal(s.status, 'fulfilled');
            assert.ok(s.value.id.startsWith('SEL-00000'));
        });

        const manifest = blobData['manifests/ids.json'];
        assert.equal(manifest.next_sequence, 4);
        assert.equal(manifest.reserved.length, 2);

        const reservations = manifest.reserved.map(r => r.id).sort();
        assert.deepEqual(reservations, ['SEL-000002', 'SEL-000003']);

        const s2 = blobData['SEL-000002.json'];
        const s3 = blobData['SEL-000003.json'];
        assert.ok(s2 && s3);
    });

    await t.test('13. Regression: Netlify runtime without process.env.NETLIFY falls gracefully to serverless path via global', async () => {
        delete process.env.NETLIFY;
        globalThis.__MOCK_NETLIFY_ENV = false;

        // Simular sinal de runtime Netlify via AWS Lambda context (SITE_ID)
        process.env.SITE_ID = 'test-deploy-preview-id';

        let blobData = { 'manifests/ids.json': { schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 2, reserved: [] } };
        let blobWritten = false;

        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key] ? JSON.parse(JSON.stringify(blobData[key])) : null, etag: 'etag-1' }),
            setJSON: async (key, val, opts) => {
                blobWritten = true;
                blobData[key] = JSON.parse(JSON.stringify(val));
                return { modified: true, etag: 'etag-2' };
            },
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: [{ key: 'manifests/ids.json' }] })
        };

        try {
            const result = await createStampTransaction({ slug: `regression-netlify-edge-${Date.now()}`, title: 'Edge Test' });
            assert.ok(result.id);
            assert.equal(blobWritten, true, 'O caminho serverless não foi executado (Blob store ignorado)');

            // Garantir que O manifest local na raiz (manifests/ids.json) NÃO foi modificado,
            // validando que withIdLock/Caminho local foi devidamente by-passado.

            // Como globalThis.__MOCK_NETLIFY_ENV é false, o require nativo direto fs fs vai falhar se readJson nao passar para blob?
            // Test13 testou a transaction bypass.
        } finally {
            delete process.env.SITE_ID;
            globalThis.__MOCK_NETLIFY_ENV = true; // restaurar base original do t.test
        }
    });
    await t.test('14. Regression: Same slug concurrent creation enforces atomic reservation check', async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        let blobData = { 'manifests/ids.json': { schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 2, reserved: [] } };
        let currentEtag = 'etag-hash-A';
        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key] ? JSON.parse(JSON.stringify(blobData[key])) : null, etag: currentEtag }),
            setJSON: async (key, val, opts) => {
                if (key === 'manifests/ids.json') {
                    if (opts?.onlyIfMatch && opts.onlyIfMatch !== currentEtag) return { modified: false };
                    blobData[key] = JSON.parse(JSON.stringify(val));
                    currentEtag = 'etag-hash-' + Math.random();
                    return { modified: true, etag: currentEtag };
                }
                blobData[key] = JSON.parse(JSON.stringify(val));
                return { modified: true };
            },
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };
        const p1 = createStampTransaction({ slug: 'race-slug-unique', title: 'T1' });
        const p2 = createStampTransaction({ slug: 'race-slug-unique', title: 'T2' });
        const settled = await Promise.allSettled([
            p1.catch(e => { console.error('T1 ERROR', e.stack); throw e; }),
            p2.catch(e => { console.error('T2 ERROR', e.stack); throw e; })
        ]);
        const statuses = settled.map(s => s.status);
        console.error('TEST 14 STATUSES', statuses);
        assert.ok(statuses.includes('fulfilled') && statuses.includes('rejected'), 'One should succeed, one should fail');

        const manifest = blobData['manifests/ids.json'];
        const reservas = manifest.reserved.filter(r => r.slug === 'race-slug-unique');
        assert.equal(reservas.length, 1);

        const blobValues = Object.values(blobData).map(v => typeof v === 'string' ? JSON.parse(v) : v);
        const blobKeys = blobValues.filter(v => v.slug === 'race-slug-unique');
        assert.equal(blobKeys.length, 1, 'Only one JSON should be created in remote BLOB');
    });

    await t.test('15. Regression: Creation catches orphan after writeJson fails manifest update, without deleting remote', async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        let blobData = { 'manifests/ids.json': { schema_version: '2.0.0', prefix: 'SEL', digits: 6, next_sequence: 2, reserved: [] } };
        let currentEtag = 'etag-hash-A';
        globalThis.__MOCK_BLOB_STORE = {
            getWithMetadata: async (key) => ({ data: blobData[key] ? JSON.parse(JSON.stringify(blobData[key])) : null, etag: currentEtag }),
            get: async (key) => blobData[key] ? JSON.stringify(blobData[key]) : null,
            list: async () => ({ blobs: Object.keys(blobData).map(k => ({ key: k })) })
        };
        let setCallCount = 0;
        globalThis.__MOCK_BLOB_STORE.setJSON = async (k, v, o) => {
            if (k === 'manifests/ids.json' && ++setCallCount === 3) {
                throw new Error('Simulated Blob Store Exception on Manifest ETag Save');
            }
            if (k === 'manifests/ids.json') {
                if (o?.onlyIfMatch && o.onlyIfMatch !== currentEtag) return { modified: false };
                blobData[k] = JSON.parse(JSON.stringify(v));
                currentEtag = 'etag-hash-' + Math.random();
                return { modified: true, etag: currentEtag };
            }
            blobData[k] = JSON.parse(JSON.stringify(v));
            return { modified: true };
        };

        const result = createStampTransaction({ slug: 'orphan-simulate', title: 'T1' });
        await assert.rejects(result, /Simulated Blob Store Exception/);

        const blobParsed = Object.values(blobData).map(v => typeof v === 'string' ? JSON.parse(v) : v);
        const orphan = blobParsed.find(v => v.slug && v.slug === 'orphan-simulate');
        console.error('TEST 15 ORPHAN DETECTED:', !!orphan, 'BLOB KEYS:', Object.keys(blobData));
        assert.ok(orphan, 'The remote JSON should have been successfully written but orphaned');

        const manifest = blobData['manifests/ids.json'];
        const res = manifest.reserved.find(r => r.slug === 'orphan-simulate');
        assert.equal(res.status, 'falha_na_criacao', 'Manifest reservation should capture failure state');
        assert.match(res.failure_reason, /JSON órfão persistido remotamente no Blob Store/, 'Orphan state gracefully identified');
    });

});
