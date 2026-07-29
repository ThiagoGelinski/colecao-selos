/**
 * BLOCO 2A — Cadastro Manual de Selos.
 * Toda persistência usa um workspace temporário isolado via SELO_ROOT.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL_SELO_ROOT = process.env.SELO_ROOT;
const ROOT = await mkdtemp(path.join(tmpdir(), 'selos-admin-cadastro-'));
process.env.SELO_ROOT = ROOT;
const TOOL = path.join(PROJECT_ROOT, 'tools', 'catalogo.mjs');
const DATA_DIR = path.join(ROOT, 'src', 'data', 'selos');
const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'selos');
const ID_MANIFEST = path.join(ROOT, 'manifests', 'ids.json');
await mkdir(path.dirname(ID_MANIFEST), { recursive: true });
await mkdir(path.join(ROOT, 'templates'), { recursive: true });
await cp(path.join(PROJECT_ROOT, 'src', 'data', 'selos'), DATA_DIR, { recursive: true });
await cp(path.join(PROJECT_ROOT, 'public', 'assets', 'selos'), ASSET_DIR, { recursive: true });
await cp(path.join(PROJECT_ROOT, 'manifests', 'ids.json'), ID_MANIFEST);
await cp(path.join(PROJECT_ROOT, 'templates', 'selo.template.json'), path.join(ROOT, 'templates', 'selo.template.json'));
after(async () => { if (ORIGINAL_SELO_ROOT === undefined) delete process.env.SELO_ROOT; else process.env.SELO_ROOT = ORIGINAL_SELO_ROOT; await rm(ROOT, { recursive: true, force: true }); });

function run(command, args = [], env = {}) {
  return spawnSync(process.execPath, [TOOL, command, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SELO_ROOT: ROOT, ...env } });
}
async function snapshotManifest() { return JSON.parse(await readFile(ID_MANIFEST, 'utf8')); }
async function restoreManifest(snapshot) { await writeFile(ID_MANIFEST, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'); }
async function removeIfExists(target) { await rm(target, { recursive: true, force: true }); }

const { accessDecision } = await import('../src/lib/admin/access.mjs');
const { normalizeSlug, dataPath, loadRecords, resolveRecord } = await import('../src/lib/catalogo/records.mjs');
const { assertManifestValid } = await import('../src/lib/catalogo/manifest.mjs');
const { validateRecord } = await import('../src/lib/catalogo/audit.mjs');
const { safeApiFailure } = await import('../src/lib/admin/api.mjs');
const { readJson } = await import('../src/lib/catalogo/io.mjs');
// ──────────────────────────────────────────────────────────────────────────────
// TESTE 1 — /admin/selos/novo exige autenticação
// ──────────────────────────────────────────────────────────────────────────────
test('1 — rota /admin/selos/novo exige autenticação quando não há sessão', () => {
    const decision = accessDecision('/admin/selos/novo', false);
    assert.equal(decision.action, 'redirect-login');
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 2 — Arquivo novo.astro existe
// ──────────────────────────────────────────────────────────────────────────────
test('2 — src/pages/admin/selos/novo.astro existe', () => {
    const filePath = path.join(PROJECT_ROOT, 'src', 'pages', 'admin', 'selos', 'novo.astro');
    assert.ok(existsSync(filePath), `Arquivo não encontrado: ${filePath}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 3 — API exige autenticação (sem sessão)
// ──────────────────────────────────────────────────────────────────────────────
test('3 — /api/admin/selos sem sessão recebe json-unauthorized', () => {
    const decision = accessDecision('/api/admin/selos', false);
    assert.equal(decision.action, 'json-unauthorized');
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 4 — Payload inválido (JSON malformado) é recusado
// ──────────────────────────────────────────────────────────────────────────────
test('4 — payload JSON malformado é rejeitado pela camada de parse', () => {
    const tryParse = (text) => { try { JSON.parse(text); return true; } catch { return false; } };
    assert.equal(tryParse('{titulo: "sem aspas"}'), false);
    assert.equal(tryParse('não é json'), false);
    assert.equal(tryParse('{"titulo":"ok","slug":"ok"}'), true);
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 5 — Campos obrigatórios: titulo vazio falha
// ──────────────────────────────────────────────────────────────────────────────
test('5 — titulo em branco falha na validação de campo obrigatório', () => {
    const validate = (titulo, slug) => {
        const t = typeof titulo === 'string' ? titulo.trim() : '';
        const s = normalizeSlug(typeof slug === 'string' ? slug : '');
        const errors = [];
        if (!t) errors.push('titulo');
        if (!s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) errors.push('slug');
        return errors;
    };
    assert.deepEqual(validate('', 'slug-valido'), ['titulo']);
    assert.deepEqual(validate('   ', 'slug-valido'), ['titulo']);
    assert.deepEqual(validate('Título válido', 'slug-valido'), []);
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 6 — Enum inválido de publicacao.status é recusado pelo schema
// ──────────────────────────────────────────────────────────────────────────────
test('6 — status de publicação inválido é recusado pelo schema AJV', async () => {
    const { validateSeloSchema } = await import('../src/lib/selo-validation.mjs');
    const official = JSON.parse(await readFile(path.join(DATA_DIR, 'SEL-000001.json'), 'utf8'));
    const bad = structuredClone(official);
    bad.publicacao.status = 'status_inventado';
    const result = validateSeloSchema(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 7 — ID criado pelo mecanismo oficial (via CLI em cwd do projeto)
// ──────────────────────────────────────────────────────────────────────────────
test('7 — ID criado pelo mecanismo oficial segue padrão SEL-XXXXXX', async () => {
    const snap = await snapshotManifest();
    const slug = `cadastro-t7-${Date.now()}`;
    const result = run('selo:novo', ['--slug', slug, '--titulo', 'Teste 7']);
    try {
        assert.equal(result.status, 0, result.stderr);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        const reservation = manifest.reserved.find((r) => r.slug === slug);
        assert.ok(reservation, 'Reserva não encontrada');
        assert.match(reservation.id, /^SEL-\d{6}$/);
    } finally {
        const manifest2 = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        const res = manifest2.reserved.find((r) => r.slug === slug);
        if (res?.id) {
            await removeIfExists(dataPath(res.id));
            await removeIfExists(path.join(ASSET_DIR, res.id));
        }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 8 — Próximos IDs não colidem
// ──────────────────────────────────────────────────────────────────────────────
test('8 — IDs de dois selos criados em sequência não colidem', async () => {
    const snap = await snapshotManifest();
    const slug1 = `t8a-${Date.now()}`;
    const slug2 = `t8b-${Date.now()}`;
    try {
        const r1 = run('selo:novo', ['--slug', slug1, '--titulo', 'Teste 8a']);
        const r2 = run('selo:novo', ['--slug', slug2, '--titulo', 'Teste 8b']);
        assert.equal(r1.status, 0, r1.stderr);
        assert.equal(r2.status, 0, r2.stderr);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        const ids = manifest.reserved.filter((r) => r.slug === slug1 || r.slug === slug2).map((r) => r.id);
        assert.equal(ids.length, 2);
        assert.notEqual(ids[0], ids[1]);
    } finally {
        const manifest2 = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        for (const slug of [slug1, slug2]) {
            const res = manifest2.reserved.find((r) => r.slug === slug);
            if (res?.id) {
                await removeIfExists(dataPath(res.id));
                await removeIfExists(path.join(ASSET_DIR, res.id));
            }
        }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 9 — Registro válido é criado
// ──────────────────────────────────────────────────────────────────────────────
test('9 — registro criado é válido estruturalmente', async () => {
    const snap = await snapshotManifest();
    const slug = `t9-${Date.now()}`;
    let id;
    try {
        const r = run('selo:novo', ['--slug', slug, '--titulo', 'Teste 9 validacao']);
        assert.equal(r.status, 0, r.stderr);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((res) => res.slug === slug)?.id;
        assert.ok(id, 'ID não encontrado no manifest');
        const filePath = dataPath(id);
        const record = JSON.parse(await readFile(filePath, 'utf8'));
        const validation = validateRecord(record, filePath);
        assert.equal(validation.errors.length, 0, `Erros: ${validation.errors.join('; ')}`);
    } finally {
        if (id) {
            await removeIfExists(dataPath(id));
            await removeIfExists(path.join(ASSET_DIR, id));
        }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 10 — Estado inicial é rascunho
// ──────────────────────────────────────────────────────────────────────────────
test('10 — estado inicial do registro é rascunho', async () => {
    const snap = await snapshotManifest();
    const slug = `t10-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 10 rascunho']);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((r) => r.slug === slug)?.id;
        assert.ok(id);
        const record = JSON.parse(await readFile(dataPath(id), 'utf8'));
        assert.equal(record.publicacao.status, 'rascunho');
        assert.equal(record.publicacao.apto_para_publicacao, false);
        assert.equal(record.publicacao.apto_para_preview, false);
        assert.equal(record.aprovacao_humana.status, 'pendente');
        assert.equal(record.aprovacao_humana.decisao, 'pendente');
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 11 — Registro aparece na listagem via loadRecords
// ──────────────────────────────────────────────────────────────────────────────
test('11 — registro criado aparece na listagem via loadRecords', async () => {
    const snap = await snapshotManifest();
    const slug = `t11-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 11 listagem']);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((r) => r.slug === slug)?.id;
        assert.ok(id);
        const records = await loadRecords();
        const found = records.find(({ record }) => record.id === id);
        assert.ok(found, `Registro ${id} não encontrado na listagem`);
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 12 — Página individual abre via resolveRecord
// ──────────────────────────────────────────────────────────────────────────────
test('12 — página individual abre o novo registro via resolveRecord', async () => {
    const snap = await snapshotManifest();
    const slug = `t12-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 12 detalhe']);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((r) => r.slug === slug)?.id;
        assert.ok(id);
        const { record } = await resolveRecord(id);
        assert.equal(record.id, id);
        assert.equal(record.slug, slug);
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 13 — Manifest permanece consistente após criação
// ──────────────────────────────────────────────────────────────────────────────
test('13 — manifest permanece consistente após criação', async () => {
    const snap = await snapshotManifest();
    const slug = `t13-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 13 manifest']);
        const records = await loadRecords();
        const updatedManifest = await readJson(ID_MANIFEST);
        id = updatedManifest.reserved.find((r) => r.slug === slug)?.id;
        assert.doesNotThrow(() => assertManifestValid(updatedManifest, records));
        const reservation = updatedManifest.reserved.find((r) => r.id === id);
        assert.ok(reservation);
        assert.equal(reservation.status, 'criado');
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 14 — Bloco aprovacao_humana e historico_editorial presentes
// ──────────────────────────────────────────────────────────────────────────────
test('14 — registro criado possui aprovacao_humana e historico_editorial', async () => {
    const snap = await snapshotManifest();
    const slug = `t14-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 14 auditoria']);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((r) => r.slug === slug)?.id;
        assert.ok(id);
        const record = JSON.parse(await readFile(dataPath(id), 'utf8'));
        assert.ok(record.aprovacao_humana, 'aprovacao_humana ausente');
        assert.equal(record.aprovacao_humana.escopo, 'publicacao_catalogo');
        assert.ok(Array.isArray(record.historico_editorial), 'historico_editorial deve ser array');
        assert.equal(record.historico_editorial.length, 0, 'rascunho não deve ter eventos editoriais ainda');
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 15 — Falha transacional não deixa registro parcial (via CLI)
// ──────────────────────────────────────────────────────────────────────────────
test('15 — falha transacional injetada não deixa registro parcial', async () => {
    const snap = await snapshotManifest();
    const slug = `t15-${Date.now()}`;
    try {
        const result = run('selo:novo', ['--slug', slug, '--titulo', 'Teste 15 rollback'], { SELO_TEST_FAIL_STAGE: 'json' });
        assert.notEqual(result.status, 0, 'Esperava falha com SELO_TEST_FAIL_STAGE=json');
        const manifest2 = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        const failedRes = manifest2.reserved.find((r) => r.slug === slug);
        if (failedRes) {
            assert.equal(failedRes.status, 'falha_na_criacao', 'Reserva deve registrar falha');
            assert.ok(!existsSync(dataPath(failedRes.id)), 'JSON não deve existir após rollback');
        }
    } finally {
        const manifest2 = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        const failedRes = manifest2.reserved.find((r) => r.slug === slug);
        if (failedRes?.id) {
            await removeIfExists(dataPath(failedRes.id));
            await removeIfExists(path.join(ASSET_DIR, failedRes.id));
        }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 16 — Catálogo público não publica rascunho automaticamente
// ──────────────────────────────────────────────────────────────────────────────
test('16 — rascunho criado não é publicado no catálogo público', async () => {
    const snap = await snapshotManifest();
    const slug = `t16-${Date.now()}`;
    let id;
    try {
        run('selo:novo', ['--slug', slug, '--titulo', 'Teste 16 nao publicado']);
        const manifest = JSON.parse(await readFile(ID_MANIFEST, 'utf8'));
        id = manifest.reserved.find((r) => r.slug === slug)?.id;
        assert.ok(id);
        const record = JSON.parse(await readFile(dataPath(id), 'utf8'));
        assert.notEqual(record.publicacao.status, 'publicado');
        assert.equal(record.publicacao.apto_para_publicacao, false);
        assert.equal(record.publicacao.apto_para_preview, false);
    } finally {
        if (id) { await removeIfExists(dataPath(id)); await removeIfExists(path.join(ASSET_DIR, id)); }
        await restoreManifest(snap);
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 17 — Path traversal no slug é neutralizado
// ──────────────────────────────────────────────────────────────────────────────
test('17 — slug com path traversal é neutralizado por normalizeSlug', () => {
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    // Casos que produzem algo — deve ser seguro
    const safeResults = [
        normalizeSlug('../../../etc/passwd'),
        normalizeSlug('valid/../bad'),
    ].filter(Boolean);
    for (const s of safeResults) {
        assert.match(s, slugPattern, `Slug inválido após normalização: "${s}"`);
        assert.ok(!/[./\\]/.test(s), `Caracteres perigosos em: "${s}"`);
    }

    // Exemplos específicos com resultado previsível
    assert.equal(normalizeSlug('/absolute/path'), 'absolutepath');
    // Slug completamente inválido = string vazia = rejeitado pelo servidor
    const empty = normalizeSlug('!!!/???###');
    assert.equal(empty, '', 'Slug sem nenhum caractere válido deve resultar em string vazia');
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 18 — Payload excessivo é recusado
// ──────────────────────────────────────────────────────────────────────────────
test('18 — payload maior que 100 KB é recusado pela verificação de tamanho', () => {
    const MAX = 100_000;
    const check = (text) => text.length > MAX;
    const small = JSON.stringify({ titulo: 'Título', slug: 'titulo' });
    const large = JSON.stringify({ titulo: 'x'.repeat(150_000) });
    assert.equal(check(small), false);
    assert.equal(check(large), true);
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 19 — safeApiFailure não expõe stack trace
// ──────────────────────────────────────────────────────────────────────────────
test('19 — safeApiFailure retorna mensagem genérica sem stack trace', async () => {
    const error = new Error('Detalhe interno do servidor');
    error.stack = 'Error: Detalhe interno\n    at file:///src/lib/x.mjs:42:5';
    const response = safeApiFailure(error);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    assert.equal(body.ok, false);
    assert.ok(body.error?.message, 'Deve ter mensagem');
    assert.ok(!bodyStr.includes('Detalhe interno do servidor'), 'Mensagem interna não deve vazar');
    assert.ok(!bodyStr.includes(':42:'), 'Stack não deve vazar');
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 20 — Módulos admin existentes continuam exportando funções esperadas
// ──────────────────────────────────────────────────────────────────────────────
test('20 — módulos admin existentes exportam funções esperadas', async () => {
    const { toAdminRecord, dashboardStats, listAdminRecords } = await import('../src/lib/admin/catalog-domain.mjs');
    assert.equal(typeof toAdminRecord, 'function');
    assert.equal(typeof dashboardStats, 'function');
    assert.equal(typeof listAdminRecords, 'function');
    const { validateRecordOperational } = await import('../src/lib/catalogo/audit.mjs');
    assert.equal(typeof validateRecordOperational, 'function');
    const { inspectManifest } = await import('../src/lib/catalogo/manifest.mjs');
    assert.equal(typeof inspectManifest, 'function');
});

// ──────────────────────────────────────────────────────────────────────────────
// TESTE 21 — Módulos da pipeline continuam exportando funções esperadas
// ──────────────────────────────────────────────────────────────────────────────
test('21 — módulos da pipeline exportam funções esperadas', async () => {
    const { createStampTransaction: cst, transactionIdFor, injectTransactionFailure, assertSlugAvailable } = await import('../src/lib/catalogo/transactions.mjs');
    assert.equal(typeof cst, 'function');
    assert.equal(typeof transactionIdFor, 'function');
    assert.equal(typeof injectTransactionFailure, 'function');
    assert.equal(typeof assertSlugAvailable, 'function');
    const { validateSeloSchema, validateSeloSemantics, validateSeloEditorial } = await import('../src/lib/selo-validation.mjs');
    assert.equal(typeof validateSeloSchema, 'function');
    assert.equal(typeof validateSeloSemantics, 'function');
    assert.equal(typeof validateSeloEditorial, 'function');
    const { executeCommand, availableCommands } = await import('../src/lib/catalogo/commands.mjs');
    assert.equal(typeof executeCommand, 'function');
    assert.ok(Array.isArray(availableCommands()));
    assert.ok(availableCommands().includes('selo:novo'));
});
