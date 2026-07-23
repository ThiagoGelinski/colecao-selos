#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data', 'selos');
const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'selos');
const REPORT_DIR = path.join(ROOT, 'reports');
const LOG_DIR = path.join(ROOT, 'logs');
const ID_MANIFEST = path.join(ROOT, 'manifests', 'ids.json');
const TEMPLATE = path.join(ROOT, 'templates', 'selo.template.json');
const ID_PATTERN = /^SEL-[0-9]{6}$/;
const VALID_STATUSES = new Set(['rascunho', 'em_pesquisa', 'identificacao_parcial', 'aguardando_revisao', 'homologacao', 'aprovado', 'publicado', 'revisao_necessaria']);
const ASSET_KINDS = ['frente', 'verso', 'card', 'thumb'];
const REQUIRED_ASSETS = new Set(['frente', 'card']);

const command = process.argv[2];
const argv = process.argv.slice(3);

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) { parsed._.push(token); continue; }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

const args = parseArgs(argv);
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const exists = async (target) => access(target, constants.F_OK).then(() => true).catch(() => false);
const readJson = async (target) => JSON.parse(await readFile(target, 'utf8'));

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function appendLog(event, details = {}) {
  await mkdir(LOG_DIR, { recursive: true });
  const line = JSON.stringify({ timestamp: now(), event, ...details });
  await writeFile(path.join(LOG_DIR, 'pipeline.jsonl'), `${line}\n`, { encoding: 'utf8', flag: 'a' });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function approvedContent(record) {
  const { aprovacao_humana: _approval, publicacao: _publication, auditoria: _audit, ...content } = record;
  return content;
}

function recordHash(record) {
  const canonical = JSON.stringify(canonicalize(approvedContent(record)));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function dataPath(id) { return path.join(DATA_DIR, `${id}.json`); }

async function loadRecords() {
  const names = (await readdir(DATA_DIR)).filter((name) => /^SEL-[0-9]{6}\.json$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ path: path.join(DATA_DIR, name), record: await readJson(path.join(DATA_DIR, name)) })));
}

async function resolveRecord(reference) {
  if (!reference) throw new Error('Informe um ID ou slug.');
  const records = await loadRecords();
  const found = records.find(({ record }) => record.id === reference || record.slug === reference);
  if (!found) throw new Error(`Registro não encontrado: ${reference}`);
  return found;
}

function approvalErrors(record, label) {
  const errors = [];
  const approval = record.aprovacao_humana;
  if (!approval) return [`${label}: publicação bloqueada sem aprovacao_humana.`];
  if (approval.status !== 'aprovado' || approval.decisao !== 'aprovado') errors.push(`${label}: aprovação humana não aprovada.`);
  if (!approval.aprovado_por?.trim()) errors.push(`${label}: aprovado_por obrigatório.`);
  if (!approval.aprovado_em || Number.isNaN(Date.parse(approval.aprovado_em))) errors.push(`${label}: aprovado_em inválido.`);
  if (!/^[a-f0-9]{64}$/.test(approval.hash_do_registro_aprovado ?? '')) errors.push(`${label}: hash aprovado inválido.`);
  if (!approval.versao_aprovada?.trim()) errors.push(`${label}: versao_aprovada obrigatória.`);
  if (approval.escopo !== 'publicacao_catalogo') errors.push(`${label}: escopo de aprovação inválido.`);
  if (approval.hash_do_registro_aprovado && approval.hash_do_registro_aprovado !== recordHash(record)) errors.push(`${label}: hash do registro diverge do conteúdo aprovado.`);
  return errors;
}

function validateRecord(record, filePath) {
  const errors = [];
  const warnings = [];
  const label = path.relative(ROOT, filePath);
  const fileId = path.basename(filePath, '.json');
  if (!ID_PATTERN.test(record.id ?? '')) errors.push(`${label}: ID inválido.`);
  if (fileId !== record.id) errors.push(`${label}: nome do arquivo (${fileId}) difere do ID interno (${record.id ?? 'ausente'}).`);
  if (!record.slug?.trim()) errors.push(`${label}: slug obrigatório.`);
  if (!record.titulo?.trim()) errors.push(`${label}: título obrigatório.`);
  if (!record.imagens?.frente?.trim()) errors.push(`${label}: imagem de frente obrigatória.`);
  if (!record.imagens?.card?.trim()) errors.push(`${label}: imagem de card obrigatória.`);
  if (!Array.isArray(record.fontes)) errors.push(`${label}: fontes deve ser array.`);
  if (!record.catalogos || typeof record.catalogos !== 'object' || Array.isArray(record.catalogos)) errors.push(`${label}: catálogos deve ser objeto.`);
  if (!record.seo?.title?.trim() || !record.seo?.meta_description?.trim()) errors.push(`${label}: SEO obrigatório incompleto.`);
  if (!VALID_STATUSES.has(record.publicacao?.status)) errors.push(`${label}: status editorial inválido.`);
  if (record.emissao?.ano != null && (!Number.isInteger(record.emissao.ano) || record.emissao.ano < 1000 || record.emissao.ano > 9999)) errors.push(`${label}: ano inválido.`);
  if (record.publicacao?.status === 'aprovado' || record.publicacao?.status === 'publicado' || record.publicacao?.apto_para_publicacao === true || record.aprovacao_humana?.status === 'aprovado') errors.push(...approvalErrors(record, label));
  else if (!record.aprovacao_humana) warnings.push(`${label}: registro legado sem bloco aprovacao_humana.`);
  return { errors, warnings };
}

function validateAssetPath(id, kind, publicPath) {
  if (typeof publicPath !== 'string' || !publicPath) return { valid: false, error: `${kind}: caminho ausente.` };
  if (publicPath.includes('..') || publicPath.includes('\\') || publicPath.includes('%')) return { valid: false, error: `${kind}: caminho inseguro ou path traversal.` };
  const expected = `/assets/selos/${id}/${id}-${kind}.webp`;
  if (publicPath !== expected) return { valid: false, error: `${kind}: nome ou diretório inválido; esperado ${expected}.` };
  return { valid: true, absolute: path.join(ASSET_DIR, id, `${id}-${kind}.webp`) };
}

async function validateAssets(record) {
  const results = [];
  for (const kind of ASSET_KINDS) {
    const publicPath = record.imagens?.[kind];
    if (!publicPath && !REQUIRED_ASSETS.has(kind)) continue;
    const checked = validateAssetPath(record.id, kind, publicPath);
    results.push({ kind, path: publicPath ?? null, path_valid: checked.valid, exists: checked.valid ? await exists(checked.absolute) : false, error: checked.error ?? null });
  }
  return results;
}

function assetErrors(assets) {
  return assets.flatMap((asset) => {
    if (!asset.path_valid) return [`asset ${asset.kind}: ${asset.error}`];
    if (!asset.exists) return [`asset ${asset.kind}: arquivo não encontrado (${asset.path}).`];
    return [];
  });
}

async function auditOne(reference) {
  const { path: filePath, record } = await resolveRecord(reference);
  const validation = validateRecord(record, filePath);
  const assets = await validateAssets(record);
  const errors = [...validation.errors, ...assetErrors(assets)];
  const report = {
    generated_at: now(), id: record.id, slug: record.slug,
    valid: errors.length === 0,
    publication_blocked: errors.some((error) => error.includes('publicação') || error.includes('aprova') || error.includes('hash')),
    errors,
    warnings: validation.warnings,
    assets
  };
  await writeJsonAtomic(path.join(REPORT_DIR, `${record.id}-auditoria.json`), report);
  return report;
}

async function reserveNextId(source = 'selo:novo') {
  const manifest = await readJson(ID_MANIFEST);
  const sequence = manifest.next_sequence;
  const id = `${manifest.prefix}-${String(sequence).padStart(manifest.digits, '0')}`;
  if (manifest.reserved.some((item) => item.id === id) || await exists(dataPath(id))) throw new Error(`ID já reservado: ${id}`);
  manifest.reserved.push({ id, reserved_at: today(), source });
  manifest.next_sequence = sequence + 1;
  await writeJsonAtomic(ID_MANIFEST, manifest);
  return id;
}

async function seloNovo() {
  if (!args.slug || !args.titulo) throw new Error('Uso: npm run selo:novo -- --slug <slug> --titulo <título>');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) throw new Error('Slug inválido.');
  const id = await reserveNextId();
  const raw = await readFile(TEMPLATE, 'utf8');
  const record = JSON.parse(raw.replaceAll('{{ID}}', id).replaceAll('{{SLUG}}', args.slug).replaceAll('{{TITULO}}', args.titulo).replaceAll('{{DATE}}', today()));
  await writeJsonAtomic(dataPath(id), record);
  await mkdir(path.join(ASSET_DIR, id), { recursive: true });
  await appendLog('selo_novo', { id, slug: args.slug });
  console.log(`${id} reservado e rascunho criado.`);
}

async function seloPreparar() {
  const { record } = await resolveRecord(args._[0]);
  const report = await auditOne(record.id);
  const output = { ...report, stage: 'preparacao', ready_for_review: report.errors.length === 0 && report.assets.every((asset) => asset.path_valid && asset.exists) };
  await writeJsonAtomic(path.join(REPORT_DIR, `${record.id}-preparacao.json`), output);
  await appendLog('selo_preparar', { id: record.id, ready: output.ready_for_review });
  console.log(JSON.stringify(output, null, 2));
  if (!output.ready_for_review) process.exitCode = 1;
}

async function seloValidar() {
  const targets = args._[0] ? [await resolveRecord(args._[0])] : await loadRecords();
  const results = [];
  for (const { path: filePath, record } of targets) {
    const validation = validateRecord(record, filePath);
    const assets = await validateAssets(record);
    results.push({ id: record.id, errors: [...validation.errors, ...assetErrors(assets)], warnings: validation.warnings });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.errors.length)) process.exitCode = 1;
}

async function seloRevisao() {
  const { path: filePath, record } = await resolveRecord(args._[0]);
  if (record.publicacao.status === 'publicado') throw new Error('Registro publicado não pode retornar à revisão por este comando.');
  record.aprovacao_humana = { status: 'pendente', decisao: 'pendente', aprovado_por: null, aprovado_em: null, hash_do_registro_aprovado: null, versao_aprovada: null, escopo: 'publicacao_catalogo', observacao: args.observacao || null };
  record.publicacao.status = 'aguardando_revisao';
  record.publicacao.apto_para_publicacao = false;
  record.publicacao.motivo = 'aguardando aprovação humana para publicação';
  record.auditoria.ultima_revisao = today();
  await writeJsonAtomic(filePath, record);
  await appendLog('selo_revisao', { id: record.id });
  console.log(`${record.id} encaminhado para revisão humana.`);
}

async function seloAprovar() {
  const reviewer = typeof args.revisor === 'string' ? args.revisor.trim() : '';
  if (!reviewer) throw new Error('Uso: npm run selo:aprovar -- <ID> --revisor <nome não vazio> [--observacao <texto>]');
  const { path: filePath, record } = await resolveRecord(args._[0]);
  if (record.publicacao.status === 'publicado') throw new Error('Registro já publicado.');

  const candidate = structuredClone(record);
  candidate.publicacao.status = 'aprovado';
  candidate.publicacao.apto_para_publicacao = false;
  candidate.publicacao.motivo = 'registro aprovado por revisão humana; validação técnica e publicação pendentes';
  candidate.auditoria.ultima_revisao = today();
  candidate.aprovacao_humana = {
    status: 'aprovado', decisao: 'aprovado', aprovado_por: reviewer, aprovado_em: now(),
    hash_do_registro_aprovado: recordHash(candidate), versao_aprovada: candidate.auditoria.versao,
    escopo: 'publicacao_catalogo', observacao: args.observacao || null
  };
  const label = path.relative(ROOT, filePath);
  const errors = [...validateRecord(candidate, filePath).errors, ...approvalErrors(candidate, label)];
  if (errors.length) throw new Error(`APROVAÇÃO BLOQUEADA:\n${[...new Set(errors)].join('\n')}`);

  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_aprovar', { id: candidate.id, aprovado_por: reviewer, hash: candidate.aprovacao_humana.hash_do_registro_aprovado });
  console.log(`${candidate.id} aprovado por ${reviewer}.`);
}

async function invalidateApproval(filePath, record, currentHash) {
  record.aprovacao_humana.status = 'revogado';
  record.aprovacao_humana.decisao = 'pendente';
  record.aprovacao_humana.invalidado_em = now();
  record.aprovacao_humana.motivo_invalidacao = 'conteúdo alterado após aprovação';
  record.publicacao.status = 'revisao_necessaria';
  record.publicacao.apto_para_publicacao = false;
  record.publicacao.motivo = 'aprovação invalidada por divergência de hash';
  record.auditoria.ultima_revisao = today();
  await writeJsonAtomic(filePath, record);
  await appendLog('aprovacao_invalidada', { id: record.id, hash_aprovado: record.aprovacao_humana.hash_do_registro_aprovado, hash_atual: currentHash });
}

async function seloPublicar() {
  const { path: filePath, record } = await resolveRecord(args._[0]);
  const approval = record.aprovacao_humana;
  const basicApprovalValid = approval?.status === 'aprovado' && approval?.decisao === 'aprovado' && approval?.aprovado_por && approval?.aprovado_em && approval?.hash_do_registro_aprovado && approval?.versao_aprovada;
  if (!basicApprovalValid) throw new Error('PUBLICAÇÃO BLOQUEADA: aprovação humana válida é obrigatória.');

  const currentHash = recordHash(record);
  if (currentHash !== approval.hash_do_registro_aprovado || record.auditoria?.versao !== approval.versao_aprovada) {
    await invalidateApproval(filePath, record, currentHash);
    throw new Error('PUBLICAÇÃO BLOQUEADA: conteúdo ou versão diverge da aprovação; aprovação invalidada.');
  }

  const assets = await validateAssets(record);
  const preflightErrors = [...validateRecord(record, filePath).errors, ...assetErrors(assets)];
  if (preflightErrors.length) throw new Error(`PUBLICAÇÃO BLOQUEADA:\n${preflightErrors.join('\n')}`);

  const candidate = structuredClone(record);
  candidate.publicacao.status = 'publicado';
  candidate.publicacao.apto_para_preview = true;
  candidate.publicacao.apto_para_publicacao = true;
  candidate.publicacao.motivo = 'registro homologado e aprovado para publicação';
  candidate.auditoria.ultima_revisao = today();
  const finalErrors = validateRecord(candidate, filePath).errors;
  if (finalErrors.length) throw new Error(`PUBLICAÇÃO BLOQUEADA:\n${finalErrors.join('\n')}`);
  await writeJsonAtomic(filePath, candidate);
  await appendLog('selo_publicar', { id: candidate.id, aprovado_por: approval.aprovado_por, hash: currentHash });
  console.log(`${candidate.id} marcado como publicado.`);
}

async function seloAuditoria() {
  const report = await auditOne(args._[0]);
  await appendLog('selo_auditoria', { id: report.id, valid: report.valid });
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

async function catalogoAuditoria() {
  const records = await loadRecords();
  const ids = new Set();
  const slugs = new Set();
  const results = [];
  for (const { path: filePath, record } of records) {
    const validation = validateRecord(record, filePath);
    if (ids.has(record.id)) validation.errors.push(`ID duplicado: ${record.id}`); else ids.add(record.id);
    if (slugs.has(record.slug)) validation.errors.push(`Slug duplicado: ${record.slug}`); else slugs.add(record.slug);
    const assets = await validateAssets(record);
    results.push({ id: record.id, slug: record.slug, errors: [...validation.errors, ...assetErrors(assets)], warnings: validation.warnings, assets });
  }
  const manifest = await readJson(ID_MANIFEST);
  const reserved = new Set(manifest.reserved.map((item) => item.id));
  for (const result of results) if (!reserved.has(result.id)) result.errors.push(`ID não reservado no manifesto: ${result.id}`);
  const report = { generated_at: now(), total: results.length, valid: results.every((item) => !item.errors.length), records: results };
  await writeJsonAtomic(path.join(REPORT_DIR, 'catalogo-auditoria.json'), report);
  await appendLog('catalogo_auditoria', { total: report.total, valid: report.valid });
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

const commands = {
  'selo:novo': seloNovo,
  'selo:preparar': seloPreparar,
  'selo:validar': seloValidar,
  'selo:revisao': seloRevisao,
  'selo:aprovar': seloAprovar,
  'selo:publicar': seloPublicar,
  'selo:auditoria': seloAuditoria,
  'catalogo:auditoria': catalogoAuditoria
};

async function main() {
  if (!commands[command]) {
    console.error(`Comando inválido. Disponíveis: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 2;
    return;
  }
  await commands[command]();
}

main().catch(async (error) => {
  console.error(error.message);
  await appendLog('erro', { command, message: error.message }).catch(() => {});
  process.exitCode = 1;
});
