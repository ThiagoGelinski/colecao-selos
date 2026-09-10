import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createPublicationService } from '../src/lib/publicacao/publisher.mjs';
import { editCandidate } from '../src/lib/admin/editor.mjs';
import { jsonDigest, binaryDigest } from '../src/lib/catalogo/digest.mjs';
import { prepareMedia, archivePreparedMedia, getMediaProvenance } from '../src/lib/catalogo/media.mjs';
import { memoryStore } from './helpers/media-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'SEL-000001';
const RECORD_FILE = `src/data/selos/${ID}.json`;
const FIRST_MAIN = 'a'.repeat(40);
const NEXT_MAIN = 'b'.repeat(40);
const ADMIN = { username: 'revisor-e2e', role: 'administrador' };
const REVIEWER = { username: 'humano-e2e', role: 'revisor' };
const CATALOGER = { username: 'catalogador-e2e', role: 'catalogador' };
const NOW = '2026-09-10T18:00:00.000Z';
const officialFiles = new Map([['manifests/ids.json', await readFile(path.join(ROOT, 'manifests/ids.json'))]]);
for (let sequence = 1; sequence <= 7; sequence++) {
  const id = `SEL-${String(sequence).padStart(6, '0')}`;
  const name = `src/data/selos/${id}.json`;
  const bytes = await readFile(path.join(ROOT, name)); officialFiles.set(name, bytes);
  const record = JSON.parse(bytes);
  for (const kind of ['frente', 'verso', 'card', 'thumb']) if (record.imagens[kind]) {
    const asset = `public${record.imagens[kind]}`;
    officialFiles.set(asset, await readFile(path.join(ROOT, asset)));
  }
}
const originalDigests = new Map([...officialFiles].map(([name, bytes]) => [name, binaryDigest(bytes)]));
const existingRecord = JSON.parse(officialFiles.get(RECORD_FILE));
const existingManifest = JSON.parse(officialFiles.get('manifests/ids.json'));
const error = (code) => Object.assign(new Error(code), { code });

function environment() {
  const initialDraft = editCandidate(existingRecord, { descricao_curta: existingRecord.descricao_curta + ' Registro em revisão.' }, CATALOGER, '2026-09-10T17:00:00.000Z');
  const state = { record: structuredClone(initialDraft), manifest: structuredClone(existingManifest), main: FIRST_MAIN, ci: false, pr: null, branch: null, files: new Map(officialFiles), assets: new Map(officialFiles), events: [], journal: new Map(), failPublish: false, beforeSave: null };
  const journal = {
    get: async (key) => state.journal.has(key) ? structuredClone(state.journal.get(key)) : null,
    put: async (key, value) => { if (!state.journal.has(key)) state.journal.set(key, structuredClone(value)); return structuredClone(state.journal.get(key)); },
    latest: async (id) => [...state.journal.entries()].filter(([key]) => key.startsWith(`reviews/${id}/`)).map(([, value]) => structuredClone(value)).sort((a, b) => b.approved_at.localeCompare(a.approved_at))[0] ?? null,
  };
  const github = {
    getMain: async () => state.main,
    readFile: async (name, revision) => { const selected = revision === NEXT_MAIN ? state.branch : state.files; return selected?.has(name) ? Buffer.from(selected.get(name)) : null; },
    createReview: async ({ files, base_sha }) => {
      assert.equal(base_sha, FIRST_MAIN); state.events.push('create-pr');
      state.branch = new Map([...state.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
      for (const file of files) state.branch.set(file.path, Buffer.from(file.bytes));
      state.pr = { number: 12, state: 'open', draft: false, merged: false, html_url: 'https://github.com/ThiagoGelinski/colecao-selos/pull/12', head: { sha: NEXT_MAIN }, base: { sha: FIRST_MAIN } };
      return structuredClone(state.pr);
    },
    verifyReview: async ({ pr, base_sha, files }) => {
      state.events.push('verify-pr');
      if (pr.head.sha !== NEXT_MAIN || pr.base.sha !== base_sha) throw error('REVIEW_CHANGED');
      const allowed = new Map(files.map((file) => [file.path, Buffer.from(file.bytes)]));
      for (const [name, expected] of allowed) if (!state.branch.has(name) || !state.branch.get(name).equals(expected)) throw error('REVIEW_CHANGED');
      for (const [name, bytes] of state.branch) if ((!state.files.has(name) || !bytes.equals(state.files.get(name))) && !allowed.has(name)) throw error('REVIEW_CHANGED');
    },
    reviewStatus: async (_number, head) => {
      if (head !== state.pr.head.sha) throw error('REVIEW_CHANGED');
      return { pr: structuredClone(state.pr), ci_passed: state.ci, ci_url: 'https://github.com/ThiagoGelinski/colecao-selos/actions/runs/1' };
    },
    publish: async ({ head_sha, base_sha }) => {
      state.events.push('publish-main');
      if (state.main !== base_sha) throw error('BASE_CHANGED');
      if (state.failPublish) throw error('GITHUB_ERROR');
      state.main = head_sha; state.files = new Map([...state.branch].map(([name, bytes]) => [name, Buffer.from(bytes)])); state.pr.merged = true;
    },
  };
  const service = createPublicationService({ github, journal, now: () => NOW,
    loadRecord: async (id) => { assert.equal(id, ID); return structuredClone(state.record); },
    loadManifest: async () => structuredClone(state.manifest),
    loadAsset: async (absolute) => { const name = path.relative(ROOT, absolute).replaceAll('\\', '/'); return Buffer.from(state.assets.get(name)); },
    saveRecord: async (id, expected, record) => {
      assert.equal(id, ID); state.beforeSave?.();
      if (jsonDigest(state.record) !== expected) throw error('RECORD_CONFLICT');
      state.events.push('save-cas'); state.record = structuredClone(record);
    },
    stageManifest: async (expected, manifest) => {
      if (jsonDigest(state.manifest) !== expected) throw error('RECORD_CONFLICT');
      state.events.push('stage-manifest'); state.staged = structuredClone(manifest);
    },
    mediaProof: getMediaProvenance,
  });
  const reviewed = async () => { const snapshot = await service.prepare(ID, CATALOGER); await service.approve(ID, snapshot.snapshot_hash, true, REVIEWER); return snapshot; };
  return { state, service, reviewed };
}

test('Publicação ponta a ponta usa SEL-000001 real em memória e preserva os sete selos', async (t) => {
  t.after(async () => {
    globalThis.__MOCK_NETLIFY_ENV = false; delete globalThis.__MOCK_MEDIA_STORE;
    for (const [name, digest] of originalDigests) assert.equal(binaryDigest(await readFile(path.join(ROOT, name))), digest, `Arquivo oficial foi alterado: ${name}`);
  });
  t.beforeEach(() => { globalThis.__MOCK_NETLIFY_ENV = true; globalThis.__MOCK_MEDIA_STORE = memoryStore().store; });
  await t.test('edição privada → revisão humana → PR → CI → main mantém sete fichas e 21 fotos', async () => {
    const { service, state } = environment();
    const snapshot = await service.prepare(ID, CATALOGER);
    assert.equal(state.main, FIRST_MAIN); assert.equal(state.pr, null); assert.equal(snapshot.record_digest, jsonDigest(state.record));
    await assert.rejects(service.approve(ID, snapshot.snapshot_hash, false, REVIEWER), { code: 'HUMAN_CONFIRMATION_REQUIRED' });
    assert.equal(state.pr, null);
    const pending = await service.approve(ID, snapshot.snapshot_hash, true, REVIEWER);
    assert.equal(pending.state, 'review'); assert.equal(pending.ci_passed, false); assert.equal(pending.can_publish, false);
    assert.equal(state.main, FIRST_MAIN); assert.deepEqual(JSON.parse(state.files.get(RECORD_FILE)), existingRecord);
    await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: 'CI_REQUIRED' }); assert.equal(state.main, FIRST_MAIN);
    state.ci = true; assert.equal((await service.status(ID, ADMIN)).can_publish, true);
    const result = await service.publish(ID, NEXT_MAIN, ADMIN);
    assert.equal(result.state, 'merged'); assert.equal(state.main, NEXT_MAIN);
    const published = JSON.parse(state.files.get(RECORD_FILE));
    assert.equal(published.descricao_curta, state.record.descricao_curta); assert.equal(published.publicacao.status, 'publicado');
    assert.equal(published.aprovacao_humana.aprovado_por, REVIEWER.username);
    assert.deepEqual(published.historico_editorial.slice(0, existingRecord.historico_editorial.length), existingRecord.historico_editorial);
    assert.deepEqual(state.events.slice(-3), ['save-cas', 'stage-manifest', 'publish-main']);
    assert.equal([...state.files.keys()].filter((name) => /^src\/data\/selos\/SEL-\d{6}\.json$/.test(name)).length, 7);
    assert.equal([...state.files.keys()].filter((name) => name.startsWith('public/assets/selos/')).length, 21);
    for (const [name, bytes] of officialFiles) if (name !== RECORD_FILE && name !== 'manifests/ids.json') assert.deepEqual(state.files.get(name), bytes, name);
    assert.deepEqual(JSON.parse(state.files.get('manifests/ids.json')), existingManifest);
    const eventCount = state.events.length; assert.equal((await service.publish(ID, NEXT_MAIN, ADMIN)).state, 'merged'); assert.equal(state.events.length, eventCount);
  });
  await t.test('perfis e cabeça incorreta impedem aprovação/publicação', async () => {
    const { service, state, reviewed } = environment(); const snapshot = await service.prepare(ID, ADMIN);
    await assert.rejects(service.approve(ID, snapshot.snapshot_hash, true, CATALOGER), { code: 'FORBIDDEN' });
    await assert.rejects(service.publish(ID, NEXT_MAIN, REVIEWER), { code: 'FORBIDDEN' });
    await reviewed(); state.ci = true;
    await assert.rejects(service.publish(ID, 'f'.repeat(40), ADMIN), { code: 'REVIEW_CHANGED' });
    assert.equal(state.main, FIRST_MAIN);
  });
  await t.test('mudança do registro entre preparo e aprovação exige novo snapshot', async () => {
    const { service, state } = environment(); const snapshot = await service.prepare(ID, ADMIN);
    state.record.titulo += ' (revisado)';
    await assert.rejects(service.approve(ID, snapshot.snapshot_hash, true, REVIEWER), { code: 'SNAPSHOT_CHANGED' });
    assert.equal(state.pr, null); assert.equal(state.main, FIRST_MAIN);
  });
  await t.test('mudança de ficha, manifesto ou main após aprovação bloqueia publicação', async () => {
    for (const variation of ['record', 'manifest', 'base']) {
      const { service, state, reviewed } = environment(); await reviewed(); state.ci = true;
      if (variation === 'record') state.record.titulo += ' (alterado no mesmo dia)';
      if (variation === 'manifest') state.manifest.next_sequence++;
      if (variation === 'base') state.main = 'c'.repeat(40);
      await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: variation === 'base' ? 'BASE_CHANGED' : 'SNAPSHOT_CHANGED' });
      assert.equal(state.events.includes('save-cas'), false);
    }
  });
  await t.test('fotografia mudou depois da aprovação: recibo válido não autoriza outro snapshot', async () => {
    const { service, state, reviewed } = environment(); await reviewed(); state.ci = true;
    const assetPath = `public${state.record.imagens.frente}`;
    const original = state.assets.get(assetPath);
    const prepared = await prepareMedia(original, { mime: 'image/webp', crop_x: 1, crop_y: 1 });
    await archivePreparedMedia(prepared); state.assets.set(assetPath, prepared.derived);
    await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: 'SNAPSHOT_CHANGED' });
    assert.equal(state.main, FIRST_MAIN); assert.equal(state.events.includes('save-cas'), false);
  });
  await t.test('imagem nova sem procedência e bytes alterados no PR são recusados', async () => {
    const missingProof = environment(); const assetPath = `public${missingProof.state.record.imagens.frente}`;
    const changed = await sharp(missingProof.state.assets.get(assetPath)).extract({ left: 1, top: 1, width: 20, height: 20 }).webp({ lossless: true }).toBuffer();
    missingProof.state.assets.set(assetPath, changed);
    await assert.rejects(missingProof.service.prepare(ID, ADMIN), { code: 'ORIGINAL_REQUIRED' });
    for (const variation of ['image', 'extra-file']) {
      const { service, state, reviewed } = environment(); await reviewed(); state.ci = true;
      if (variation === 'image') state.branch.set(assetPath, changed);
      else state.branch.set('README.md', Buffer.from('mudança fora da aprovação'));
      await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: 'REVIEW_CHANGED' });
      assert.equal(state.main, FIRST_MAIN); assert.equal(state.events.includes('save-cas'), false);
    }
  });
  await t.test('CAS barra edição que chega depois da última leitura e antes de gravar', async () => {
    const { service, state, reviewed } = environment(); await reviewed(); state.ci = true;
    state.beforeSave = () => { state.record.titulo += ' atualização concorrente'; };
    await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: 'RECORD_CONFLICT' });
    assert.equal(state.main, FIRST_MAIN); assert.equal(state.events.includes('publish-main'), false);
  });
  await t.test('falha transitória de GitHub pode ser repetida sem reaprovar ou sobrescrever um rascunho novo', async () => {
    const { service, state, reviewed } = environment(); await reviewed(); state.ci = true; state.failPublish = true;
    await assert.rejects(service.publish(ID, NEXT_MAIN, ADMIN), { code: 'GITHUB_ERROR' });
    assert.equal(state.main, FIRST_MAIN); assert.equal(state.record.aprovacao_humana.aprovado_por, REVIEWER.username);
    state.failPublish = false;
    assert.equal((await service.publish(ID, NEXT_MAIN, ADMIN)).state, 'merged'); assert.equal(state.main, NEXT_MAIN);
  });
});
