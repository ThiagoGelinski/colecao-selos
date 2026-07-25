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
                    await new Promise(r => setTimeout(r, 10));
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

        const settled = await Promise.allSettled([p1, p2]);

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
});
