import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { writeFile, rm } from 'node:fs/promises';

test('Microbloco 2A.1.16 - Leitura Admin Dual-Source', async (t) => {
    t.afterEach(async () => {
        globalThis.__MOCK_NETLIFY_ENV = false;
        globalThis.__MOCK_BLOB_STORE = null;
        try {
            await rm(path.join(process.cwd(), 'src/data/selos/SEL-999400.json'), { force: true });
        } catch { }
    });

    await t.test('A. Registro somente no baseline aparece', async () => {
        const { getAdminStamps } = await import('../src/lib/admin/catalog-service.ts');
        const res = await getAdminStamps({ pageSize: 1000 });
        const found = res.items.find(i => i.id === 'SEL-000001');
        assert.ok(found, 'Selo 000001 (baseline real) não foi encontrado');
    });

    await t.test('B. Registro somente no Blob aparece e getAdminStamp o recupera (E)', async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        const blobStamp = { id: 'SEL-999200', slug: 'cloud-only', publicacao: { status: 'ativo' }, origin: 'blob' };
        globalThis.__MOCK_BLOB_STORE = {
            list: async () => ({ blobs: [{ key: 'SEL-999200.json' }] }),
            get: async (key) => key === 'SEL-999200.json' ? JSON.stringify(blobStamp) : null
        };
        const { getAdminStamps, getAdminStamp, getAdminDashboard } = await import('../src/lib/admin/catalog-service.ts');

        const list = await getAdminStamps({ pageSize: 1000 });
        assert.ok(list.items.find(i => i.id === 'SEL-999200'), 'A listagem administrativa não integrou os selos do Blob Store');

        const dash = await getAdminDashboard();
        assert.ok(dash.indicadores.total > 1, 'Os dashboards não reportaram a soma do baseline + blob store');

        const single = await getAdminStamp('SEL-999200');
        assert.ok(single, 'getAdminStamp não interceptou identificador Cloud-Only');
        assert.equal(single.registro.slug, 'cloud-only');
    });

    await t.test('C. Registro presente nos dois e idêntico aparece uma vez', async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        const { readFile } = await import('node:fs/promises');
        const exactRawSeloData = await readFile(path.join(process.cwd(), 'src/data/selos/SEL-000001.json'), 'utf8');
        globalThis.__MOCK_BLOB_STORE = {
            list: async () => ({ blobs: [{ key: 'SEL-000001.json' }] }),
            get: async (key) => key === 'SEL-000001.json' ? exactRawSeloData : null
        };

        const { getAdminStamps } = await import('../src/lib/admin/catalog-service.ts');
        const list = await getAdminStamps({ pageSize: 1000 });
        const matches = list.items.filter(i => i.id === 'SEL-000001');
        assert.equal(matches.length, 1, 'Registro compartilhado deve constar estritamente uma única vez!');
    });

    await t.test('D. Conflito entre baseline corrupto e Blob segue fail-closed', async () => {
        globalThis.__MOCK_NETLIFY_ENV = true;
        await writeFile(path.join(process.cwd(), 'src/data/selos/SEL-999400.json'), '{ invalid_JSON');
        const blobStamp = { id: 'SEL-999400', slug: 'valid-cloud' };
        globalThis.__MOCK_BLOB_STORE = {
            list: async () => ({ blobs: [{ key: 'SEL-999400.json' }] }),
            get: async (key) => key === 'SEL-999400.json' ? JSON.stringify(blobStamp) : null
        };

        const { getAdminStamps } = await import('../src/lib/admin/catalog-service.ts');
        const { IntegrityError } = await import('../src/lib/catalogo/errors.mjs');
        await assert.rejects(
            () => getAdminStamps({}),
            IntegrityError
        );
    });
});
