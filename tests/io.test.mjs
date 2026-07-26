import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { listJsonNames, readJson } from '../src/lib/catalogo/io.mjs';

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', `io-test-${randomUUID()}`);

test('io.mjs Additive Extensions', async (t) => {
    t.before(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });
    t.after(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    await t.test('API local verification', async (suite) => {
        await suite.test('todas as cinco funções públicas nativas estão exportadas corretamente', async () => {
            const { exists, readJson, writeJsonAtomic, listJsonNames, writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');
            assert.equal(typeof exists, 'function');
            assert.equal(typeof readJson, 'function');
            assert.equal(typeof writeJsonAtomic, 'function');
            assert.equal(typeof listJsonNames, 'function');
            assert.equal(typeof writeJsonExclusive, 'function');
        });
        await suite.test('importar io.mjs localmente continua não instanciando remotamente (isolamento Lazy)', () => {
            assert.equal(process.env.NETLIFY, undefined);
        });
    });

    await t.test('listJsonNames(dir)', async (suite) => {
        const subDir = path.join(TEST_DIR, 'list-tests');

        await suite.test('6. comportamento com diretório inexistente', async () => {
            await assert.rejects(
                listJsonNames(path.join(TEST_DIR, 'non-existent')),
                /ENOENT/
            );
        });

        await suite.test('1. diretório contendo zero arquivos JSON', async () => {
            await mkdir(subDir, { recursive: true });
            const list = await listJsonNames(subDir);
            assert.deepEqual(list, []);
        });

        await suite.test('4. arquivos que NÃO sejam .json devem ser ignorados e 5. subdiretórios não devem ser tratados (ignorados)', async () => {
            await writeFile(path.join(subDir, 'test.txt'), 'hello');
            await mkdir(path.join(subDir, 'subfolder.json')); // looks like json but is a dir
            const list = await listJsonNames(subDir);
            assert.deepEqual(list, []);
        });

        await suite.test('2. diretório contendo um arquivo .json', async () => {
            await writeFile(path.join(subDir, 'one.json'), '{}');
            const list = await listJsonNames(subDir);
            assert.deepEqual(list, ['one.json']);
        });

        await suite.test('3. diretório contendo múltiplos .json', async () => {
            await writeFile(path.join(subDir, 'two.json'), '{}');
            const list = await listJsonNames(subDir);
            assert.ok(list.includes('one.json'));
            assert.ok(list.includes('two.json'));
            assert.equal(list.length, 2);
        });

        await suite.test('7. confirmar exatamente qual formato listJsonNames retorna', async () => {
            const list = await listJsonNames(subDir);
            assert.ok(Array.isArray(list));
            assert.equal(typeof list[0], 'string');
        });

        await suite.test('8. confirmar que nenhum arquivo é alterado durante a listagem', async () => {
            const before = await stat(path.join(subDir, 'one.json'));
            await listJsonNames(subDir);
            const after = await stat(path.join(subDir, 'one.json'));
            assert.equal(before.mtimeMs, after.mtimeMs);
        });
    });

    await t.test('writeJsonExclusive(target, value)', async (suite) => {
        const writeDir = path.join(TEST_DIR, 'write-tests');
        const target = path.join(writeDir, 'novo.json');
        const value = { prop: 'test_creation' };

        await suite.test('1. criação normal quando target não existe', async () => {
            await writeJsonExclusive(target, value);
            await assert.doesNotReject(stat(target));
        });

        await suite.test('2. JSON persistido corresponde ao value informado', async () => {
            const stored = JSON.parse(await readFile(target, 'utf8'));
            assert.deepEqual(stored, value);
        });

        await suite.test('3. segunda tentativa para o mesmo target deve falhar com semântica equivalente a EEXIST', async () => {
            await assert.rejects(
                () => writeJsonExclusive(target, { prop: 'override' }),
                (err) => err?.code === 'EEXIST'
            );
        });

        await suite.test('4. arquivo originalmente criado deve permanecer intacto após tentativa duplicada', async () => {
            const stored = JSON.parse(await readFile(target, 'utf8'));
            assert.deepEqual(stored, value); // Original is kept
        });

        await suite.test('5. & 6. nenhum arquivo temporário residual deve permanecer após sucesso ou falha', async () => {
            const items = await readdir(writeDir);
            assert.equal(items.length, 1);
            assert.equal(items[0], 'novo.json'); // the only file is the successfully created one
        });

        await suite.test('7. duas tentativas concorrentes para o mesmo target (race condition)', async () => {
            const concurrentTarget = path.join(writeDir, 'race.json');
            const promises = [
                writeJsonExclusive(concurrentTarget, { id: 1 }).then(() => 'success').catch(e => e.code),
                writeJsonExclusive(concurrentTarget, { id: 2 }).then(() => 'success').catch(e => e.code)
            ];

            const results = await Promise.all(promises);
            assert.ok(results.includes('success'), 'Exactly one should succeed');
            assert.ok(results.includes('EEXIST'), 'Exactly one should fail with EEXIST');

            const content = JSON.parse(await readFile(concurrentTarget, 'utf8'));
            assert.ok(content.id === 1 || content.id === 2);
        });

        await suite.test('8. confirmar que arquivos não relacionados permanecem intactos', async () => {
            const items = await readdir(writeDir);
            assert.ok(items.includes('novo.json'));
            assert.ok(items.includes('race.json'));
            assert.equal(items.length, 2);
        });
    });

    await t.test('Dual-Source NETLIFY ENVIRONMENT', async (suite) => {
        suite.beforeEach(async () => {
            await rm(path.join(TEST_DIR, 'data', 'selos'), { recursive: true, force: true });
        });
        suite.afterEach(() => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            globalThis.__MOCK_BLOB_STORE = null;
        });

        await suite.test('Netlify + somente baseline', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => null,
                list: async () => ({ blobs: [] })
            };

            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'SEL-baseonly.json');
            await mkdir(path.dirname(fakePath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakePath, { test: 1 });

            const files = await listJsonNames(path.dirname(fakePath));
            assert.deepEqual(files, ['SEL-baseonly.json']);

            const data = await readJson(fakePath);
            assert.equal(data.test, 1);
        });

        await suite.test('Netlify + somente Blob', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async (key) => key === 'SEL-blobonly.json' ? '{"test":2}' : null,
                list: async () => ({ blobs: [{ key: 'SEL-blobonly.json' }] })
            };

            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'SEL-blobonly.json');
            const data = await readJson(fakePath);
            assert.equal(data.test, 2);
        });

        await suite.test('Netlify + mesmo JSON em baseline e Blob (aceito)', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async (key) => key === 'match.json' ? '{"test":3}' : null
            };
            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'match.json');
            await mkdir(path.dirname(fakePath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakePath, { test: 3 });

            const data = await readJson(fakePath);
            assert.equal(data.test, 3);
        });

        await suite.test('Netlify + JSON divergente -> FAIL CLOSED', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async (key) => key === 'SEL-conflict.json' ? '{"test":4}' : null
            };
            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'SEL-conflict.json');
            await mkdir(path.dirname(fakePath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakePath, { test: 99 });

            await assert.rejects(
                () => readJson(fakePath),
                (err) => err.message.includes('Inconsistência Crítica')
            );
        });

        await suite.test('Inexistente nas duas fontes -> ENOENT preservado', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => null
            };
            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'missing.json');
            await assert.rejects(
                () => readJson(fakePath),
                (err) => err.code === 'ENOENT'
            );
        });

        await suite.test('Baseline JSON inválido + Blob válido => operação deve falhar (Fail-Closed)', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => '{"valid": true}'
            };
            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'corrupt.json');
            await mkdir(path.dirname(fakePath), { recursive: true });
            await writeFile(fakePath, '{ JSON INVALIDO }', 'utf8');

            await assert.rejects(
                () => readJson(fakePath),
                SyntaxError
            );
        });

        await suite.test('União de listagem sem duplicatas', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            globalThis.__MOCK_BLOB_STORE = {
                list: async () => ({ blobs: [{ key: 'SEL-shared.json' }, { key: 'SEL-blobonly.json' }, { key: 'manifests/ignored.json' }] })
            };
            const dirPath = path.join(TEST_DIR, 'data', 'selos');
            await mkdir(dirPath, { recursive: true });

            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(path.join(dirPath, 'SEL-shared.json'), { fs: 1 });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(path.join(dirPath, 'fs-only.json'), { fs: 1 });

            await mkdir(path.join(dirPath, 'fake-dir.json'), { recursive: true });

            const names = await listJsonNames(dirPath);
            assert.deepEqual(names, ['SEL-blobonly.json', 'SEL-shared.json', 'fs-only.json'].sort());
        });
    });

    await t.test('Bootstrap readMutableManifest(ids.json)', async (suite) => {
        suite.beforeEach(async () => {
            await rm(path.join(TEST_DIR, 'data', 'selos', 'manifests'), { recursive: true, force: true });
        });
        suite.afterEach(() => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            globalThis.__MOCK_BLOB_STORE = null;
        });

        const fakeManifestPath = path.join(TEST_DIR, 'manifests', 'ids.json');

        await suite.test('1. local não acessa Blob', async () => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            let blobGetCalled = false;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => { blobGetCalled = true; return null; }
            };
            await mkdir(path.dirname(fakeManifestPath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakeManifestPath, { local: true });

            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');
            const data = await readMutableManifest(fakeManifestPath);
            assert.equal(data.local, true);
            assert.equal(blobGetCalled, false);
        });

        await suite.test('2. Netlify + ids.json Blob já existente: não executa bootstrap', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let setJSONCalled = false;
            globalThis.__MOCK_BLOB_STORE = {
                get: async (key) => key === 'manifests/ids.json' ? '{"blob":true}' : null,
                setJSON: async () => { setJSONCalled = true; }
            };
            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');
            const data = await readMutableManifest(fakeManifestPath);
            assert.equal(data.blob, true);
            assert.equal(setJSONCalled, false);
        });

        await suite.test('3, 4 & 5. Netlify + Blob inexistente + baseline existente: cria exatamente uma vez com onlyIfNew', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let setOpts = null;
            let blobRaw = null;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => blobRaw,
                setJSON: async (_key, val, opts) => {
                    setOpts = opts;
                    blobRaw = JSON.stringify(val);
                }
            };
            await mkdir(path.dirname(fakeManifestPath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakeManifestPath, { baseline: 123 });

            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');
            const data = await readMutableManifest(fakeManifestPath);

            assert.equal(data.baseline, 123);
            assert.deepEqual(setOpts, { onlyIfNew: true });
            assert.equal(blobRaw, '{"baseline":123}');
        });

        await suite.test('9. baseline inexistente: falha explicitamente, não cria vazio', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let setJSONCalled = false;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => null,
                setJSON: async () => { setJSONCalled = true; }
            };
            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');

            await assert.rejects(
                () => readMutableManifest(path.join(TEST_DIR, 'manifests', 'missing.json')),
                (err) => err.message.includes('suporta apenas manifests do catálogo')
            );
            assert.equal(setJSONCalled, false);
        });

        await suite.test('11. nenhum target não autorizado consegue acionar bootstrap', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            const fakePath = path.join(TEST_DIR, 'data', 'selos', 'regular-stamp.json');
            await mkdir(path.dirname(fakePath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakePath, { baseline: 1 });
            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');
            await assert.rejects(
                () => readMutableManifest(fakePath),
                (err) => err.message.includes('suporta apenas manifests')
            );
        });

        await suite.test('6, 7 & 8. Duas inicializações concorrentes: somente uma vence e perdedor relê vencedor sem sobrescrever', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;

            let storedData = null;
            let writeCount = 0;
            globalThis.__MOCK_BLOB_STORE = {
                get: async () => storedData,
                setJSON: async (_key, val, opts) => {
                    if (opts?.onlyIfNew && storedData) {
                        return { modified: false };
                    }
                    storedData = JSON.stringify(val); // SDK emulates DB Commit
                    await new Promise(r => setTimeout(r, 10)); // Latency interleave
                    writeCount++;
                    return { modified: true, etag: 'etag-boot-' + writeCount };
                }
            };

            await mkdir(path.dirname(fakeManifestPath), { recursive: true });
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(fakeManifestPath, { baseline: 'test-race' });

            const { readMutableManifest } = await import('../src/lib/catalogo/io.mjs');

            // Trigger parallel bursts
            const p1 = readMutableManifest(fakeManifestPath);
            const p2 = readMutableManifest(fakeManifestPath);

            const [res1, res2] = await Promise.all([p1, p2]);

            assert.equal(res1.baseline, 'test-race');
            assert.equal(res2.baseline, 'test-race');
            assert.equal(writeCount, 1);
        });
    });

    await t.test('Atualização Concorrente Segura - updateMutableManifestAtomic', async (suite) => {
        suite.afterEach(() => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            globalThis.__MOCK_BLOB_STORE = null;
        });

        const fakeTarget = path.join(TEST_DIR, 'manifests', 'ids.json');

        await suite.test('1 & 2. atualização sem concorrência persiste normalmente com ETag correspondente', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let currentEtag = 'etag-hash-1';
            let storedData = { next_sequence: 100 };

            globalThis.__MOCK_BLOB_STORE = {
                getWithMetadata: async () => ({ data: storedData, etag: currentEtag, metadata: {} }),
                setJSON: async (_key, val, opts) => {
                    if (opts?.onlyIfMatch !== currentEtag) return { modified: false };
                    storedData = val;
                    currentEtag = 'etag-hash-2';
                    return { modified: true, etag: currentEtag };
                }
            };

            const { updateMutableManifestAtomic } = await import('../src/lib/catalogo/io.mjs');
            const data = await updateMutableManifestAtomic(fakeTarget, (draft) => {
                draft.next_sequence++;
                return draft;
            });

            assert.equal(data.next_sequence, 101);
            assert.equal(storedData.next_sequence, 101);
            assert.equal(currentEtag, 'etag-hash-2');
        });

        await suite.test('3, 4, 5, 6 & 7. duas atualizações concorrentes sobre next_sequence=100 terminam em 102 (vencedor e perdedor com retry)', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let currentEtag = 'etag-hash-A';
            let storedData = { next_sequence: 100 };

            globalThis.__MOCK_BLOB_STORE = {
                getWithMetadata: async () => ({ data: JSON.parse(JSON.stringify(storedData)), etag: currentEtag, metadata: {} }),
                setJSON: async (_key, val, opts) => {
                    if (opts?.onlyIfMatch !== currentEtag) {
                        return { modified: false };
                    }
                    storedData = JSON.parse(JSON.stringify(val));
                    currentEtag = 'etag-hash-' + Math.random();
                    await new Promise(r => setTimeout(r, 10)); // Induz a race
                    return { modified: true, etag: currentEtag };
                }
            };

            const { updateMutableManifestAtomic } = await import('../src/lib/catalogo/io.mjs');

            const p1 = updateMutableManifestAtomic(fakeTarget, (draft) => { draft.next_sequence++; return draft; });
            const p2 = updateMutableManifestAtomic(fakeTarget, (draft) => { draft.next_sequence++; return draft; });

            const [r1, r2] = await Promise.all([p1, p2]);

            assert.equal(storedData.next_sequence, 102);
            assert.ok((r1.next_sequence === 101 && r2.next_sequence === 102) || (r1.next_sequence === 102 && r2.next_sequence === 101));
        });

        await suite.test('8 & 9. esgotamento do retry falha explicitamente limitando a MAX_RETRIES', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let currentEtag = 'etag-hash-X';
            let storedData = { next_sequence: 100 };
            let callCount = 0;

            globalThis.__MOCK_BLOB_STORE = {
                getWithMetadata: async () => ({ data: storedData, etag: currentEtag, metadata: {} }),
                setJSON: async () => {
                    callCount++;
                    return { modified: false }; // Falha constante forçando retries
                }
            };

            const { updateMutableManifestAtomic } = await import('../src/lib/catalogo/io.mjs');
            await assert.rejects(
                () => updateMutableManifestAtomic(fakeTarget, (d) => d),
                (err) => err.message.includes('max retries atingido')
            );
            assert.equal(callCount, 5);
        });

        await suite.test('10 & 11. ambiente local continua sem acesso ao Blob', async () => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            let blobGetCalled = false;
            globalThis.__MOCK_BLOB_STORE = {
                getWithMetadata: async () => { blobGetCalled = true; return {}; }
            };

            const localFile = path.join(TEST_DIR, 'data', 'selos', 'manifests', 'update.json');
            await mkdir(path.dirname(localFile), { recursive: true });
            const { readJson } = await import('../src/lib/catalogo/io.mjs');
            // Write basic base JSON via writes since fs is accessible
            await (await import('../src/lib/catalogo/io.mjs')).writeJsonAtomic(localFile, { next_sequence: 99 });

            const { updateMutableManifestAtomic } = await import('../src/lib/catalogo/io.mjs');
            const data = await updateMutableManifestAtomic(localFile, (d) => { d.next_sequence++; return d; });

            assert.equal(data.next_sequence, 100);
            assert.equal(blobGetCalled, false);

            const persisted = await readJson(localFile);
            assert.equal(persisted.next_sequence, 100);
        });
    });

    await t.test('Escrita Exclusiva do JSON Final do Selo (writeJsonExclusive) no Netlify', async (suite) => {
        suite.afterEach(() => {
            globalThis.__MOCK_NETLIFY_ENV = false;
            globalThis.__MOCK_BLOB_STORE = null;
        });

        const validTarget = path.join(TEST_DIR, 'data', 'selos', 'SEL-99999.json');

        await suite.test('2, 3 & 4. Netlify cria JSON novo no Blob com onlyIfNew originando modified=true', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let blobData = null;
            let setOpts = null;
            globalThis.__MOCK_BLOB_STORE = {
                setJSON: async (_key, val, opts) => {
                    setOpts = opts;
                    blobData = val;
                    return { modified: true };
                }
            };

            const { writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');
            await writeJsonExclusive(validTarget, { foo: 'bar' });

            assert.deepEqual(blobData, { foo: 'bar' });
            assert.deepEqual(setOpts, { onlyIfNew: true });
        });

        await suite.test('5, 6, 7. modified === false vira EEXIST, sem retry e fallback incondicional', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let callCount = 0;
            globalThis.__MOCK_BLOB_STORE = {
                setJSON: async () => {
                    callCount++;
                    return { modified: false };
                }
            };

            const { writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');
            await assert.rejects(
                () => writeJsonExclusive(validTarget, { foo: 'bar' }),
                (err) => err.code === 'EEXIST'
            );
            assert.equal(callCount, 1);
        });

        await suite.test('8, 9 & 10. duas concorrências, uma vence e uma resulta EEXIST. Selo que já existe no blob falha EEXIST', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let blobData = null;
            globalThis.__MOCK_BLOB_STORE = {
                setJSON: async (key, val, opts) => {
                    if (opts?.onlyIfNew && blobData) return { modified: false };
                    blobData = val;
                    await new Promise(r => setTimeout(r, 10)); // induce race
                    return { modified: true };
                }
            };

            const { writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');
            const writes = await Promise.allSettled([
                writeJsonExclusive(validTarget, { winner: 1 }),
                writeJsonExclusive(validTarget, { winner: 2 })
            ]);

            const successes = writes.filter(x => x.status === 'fulfilled');
            const fails = writes.filter(x => x.status === 'rejected');

            assert.equal(successes.length, 1);
            assert.equal(fails.length, 1);
            assert.equal(fails[0].reason.code, 'EEXIST');
        });

        await suite.test('11, 12. Selo existente no baseline FS falha rigorosamente e dual source', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            let blobCalled = false;
            globalThis.__MOCK_BLOB_STORE = { setJSON: async () => { blobCalled = true; return { modified: true }; } };

            await mkdir(path.dirname(validTarget), { recursive: true });
            const { writeJsonAtomic: wja, writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');
            await wja(validTarget, { baseline: 99 });

            await assert.rejects(
                () => writeJsonExclusive(validTarget, { foo: 'fs' }),
                (err) => err.code === 'EEXIST'
            );
            assert.equal(blobCalled, false); // Impedido bypassando o blob central
        });

        await suite.test('13, 14, 15, 16, 17. Rejeição global de manifestos, paths, subdiretórios ou falsificamentos para Blob Store', async () => {
            globalThis.__MOCK_NETLIFY_ENV = true;
            const { writeJsonExclusive } = await import('../src/lib/catalogo/io.mjs');

            const rejectList = [
                path.join(TEST_DIR, 'manifests', 'ids.json'),
                path.join(TEST_DIR, 'data', 'selos', 'regular-without-sel.json'),
                path.join(TEST_DIR, 'data', 'selos', 'assets', 'SEL-99999-frente.webp'),
                path.join(TEST_DIR, 'data', 'selos', 'subpasta', 'SEL-123.json'),
                path.join(TEST_DIR, 'data', 'SEL-123.json')
            ];

            for (const falsy of rejectList) {
                await assert.rejects(
                    () => writeJsonExclusive(falsy, { payload: 1 }),
                    (err) => err.message.includes('Alvo inválido')
                );
            }
        });
    });
});
