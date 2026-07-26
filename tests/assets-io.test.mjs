import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const SETUP_MODE = (serverless) => {
    globalThis.__MOCK_NETLIFY_ENV = serverless;
};

const blobData = {};
const blobMeta = {};

globalThis.__MOCK_BLOB_STORE = {
    get: async (key, opts) => {
        if (!blobData[key]) return null;
        if (opts && opts.type === 'arrayBuffer') {
            if (Buffer.isBuffer(blobData[key])) {
                return new Uint8Array(blobData[key]).buffer;
            }
            return blobData[key];
        }
        return blobData[key];
    },
    set: async (key, val, opts) => {
        blobData[key] = val;
        let etag = 'mock-etag-' + Date.now();
        blobMeta[key] = { etag, metadata: opts?.metadata || {} };
        return { modified: true, etag };
    },
    getMetadata: async (key) => {
        return blobMeta[key] || null;
    }
};

test('Microbloco 2A.2.2 - Contrato e Adapter Binário de Assets', async (t) => {
    const { writeAssetBinary, readAssetBinary, existsAssetBinary } = await import('../src/lib/catalogo/io.mjs');
    const assetPath = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-999901', 'SEL-999901-frente.webp');
    const assetDir = path.dirname(assetPath);

    t.afterEach(async () => {
        await rm(assetDir, { recursive: true, force: true });
        for (const k of Object.keys(blobData)) delete blobData[k];
        for (const k of Object.keys(blobMeta)) delete blobMeta[k];
    });

    await t.test('A, C, G. Escrita/Leitura Local não chama Blob e bytes retornam idênticos', async () => {
        SETUP_MODE(false);
        const originalBytes = Buffer.from([0x00, 0xFF, 0xAA, 0xBB]);
        await writeAssetBinary(assetPath, originalBytes);

        assert.ok(Object.keys(blobData).length === 0, 'Blobs não devem ser acionados em dev/local');

        const readBytes = await readAssetBinary(assetPath);
        assert.deepEqual(readBytes, originalBytes, 'Bytes lidos localmente divergem dos escritos');

        const fileStat = await stat(assetPath);
        assert.ok(fileStat.size === 4, 'Arquivo no filesystem tem tamanho inesperado');
    });

    await t.test('B, C, H. Escrita/Leitura Blob Serverless não escreve no FS e bytes retornam idênticos', async () => {
        SETUP_MODE(true);
        const originalBytes = Buffer.from([0x12, 0x34, 0x56, 0x78]);
        // C. Mime/Content-Type metadata handling
        await writeAssetBinary(assetPath, originalBytes, 'image/webp');

        await assert.rejects(stat(assetPath), { code: 'ENOENT' }, 'FS Nativo não deve ser tocado em Serverless');

        const readBytes = await readAssetBinary(assetPath);
        assert.deepEqual(readBytes, originalBytes, 'Bytes lidos do Blob divergem dos escritos');

        assert.ok(blobData['assets/selos/SEL-999901/SEL-999901-frente.webp'] !== undefined, 'Blob store não gravou a chave correta');
        assert.equal(blobMeta['assets/selos/SEL-999901/SEL-999901-frente.webp'].metadata['content-type'], 'image/webp');
    });

    await t.test('Hierarquia de Blob Key e Isolamento', async () => {
        SETUP_MODE(true);
        const bytesA = Buffer.from([0x01]);
        const bytesB = Buffer.from([0x02]);
        const pathA = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-888801', 'SEL-888801-frente.webp');
        const pathB = path.join(ROOT, 'public', 'assets', 'selos', 'SEL-888802', 'SEL-888802-frente.webp');

        await writeAssetBinary(pathA, bytesA);
        await writeAssetBinary(pathB, bytesB);

        assert.ok(Array.from(Object.keys(blobData)).includes('assets/selos/SEL-888801/SEL-888801-frente.webp'), 'Key A deve respeitar a hierarquia inteira sem o leading slash');
        assert.ok(Array.from(Object.keys(blobData)).includes('assets/selos/SEL-888802/SEL-888802-frente.webp'), 'Key B deve respeitar a hierarquia inteira sem o leading slash');

        const readA = await readAssetBinary(pathA);
        const readB = await readAssetBinary(pathB);
        assert.deepEqual(readA, bytesA, 'Leitura A falhou isolamento');
        assert.deepEqual(readB, bytesB, 'Leitura B falhou isolamento');
    });

    await t.test('I, J. Existência de Asset Local e no Blob', async () => {
        const dummyBytes = Buffer.from([0x01]);

        // Local existence
        SETUP_MODE(false);
        assert.equal(await existsAssetBinary(assetPath), false);
        await writeAssetBinary(assetPath, dummyBytes);
        assert.equal(await existsAssetBinary(assetPath), true);

        // Serverless existence
        SETUP_MODE(true);
        assert.equal(await existsAssetBinary(assetPath), false, 'Blob deve estar vazio para asset diferente');
        await writeAssetBinary(assetPath, dummyBytes);
        assert.equal(await existsAssetBinary(assetPath), true);
    });

    await t.test('D, E, F - Segurança de Paths, Extensões e Nomes (Bloqueio Total de Invalidos)', async () => {
        SETUP_MODE(true); // Usar cloud force validation adapter
        const safeTargetDir = path.join(ROOT, 'public', 'assets', 'selos');
        const buffer = Buffer.from([]);

        // D. Path Traversal
        await assert.rejects(
            writeAssetBinary(path.join(safeTargetDir, '..', 'SEL-999901-frente.webp'), buffer),
            /Alvo inválido/, 'Deveria bloquear traversal'
        );

        // E. ID Inválido na pasta
        await assert.rejects(
            writeAssetBinary(path.join(safeTargetDir, 'SEL-XYZ', 'SEL-XYZ-frente.webp'), buffer),
            /Alvo inválido/, 'Deveria bloquear ID inválido (SEL-XYZ)'
        );

        // F. Filename arbitrário inválido
        await assert.rejects(
            writeAssetBinary(path.join(safeTargetDir, 'SEL-999901', 'backdoor.webp'), buffer),
            /Alvo inválido/, 'Deveria bloquear filename que nao seja tipo aceito'
        );

        // F. Extensão inválida
        await assert.rejects(
            writeAssetBinary(path.join(safeTargetDir, 'SEL-999901', 'SEL-999901-frente.exe'), buffer),
            /Alvo inválido/, 'Deveria bloquear extensões perigosas'
        );

        // F. ID da imagem difere da pasta
        await assert.rejects(
            writeAssetBinary(path.join(safeTargetDir, 'SEL-999901', 'SEL-888802-frente.webp'), buffer),
            /Alvo inválido/, 'Deveria bloquear matching desigual entre root ID e image ID'
        );
    });
});
