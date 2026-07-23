import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../schemas/selo.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: true });
addFormats(ajv, { mode: 'full' });
const compiledSchema = ajv.compile(schema);

function issue(type, instancePath, keyword, message, params = {}) {
  return { type, instancePath, keyword, message, params };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function approvedContent(record) {
  const { aprovacao_humana: _approval, publicacao: _publication, auditoria: _audit, historico_editorial: _history, ...content } = record;
  return content;
}

export function recordHash(record) {
  return createHash('sha256').update(JSON.stringify(canonicalize(approvedContent(record))), 'utf8').digest('hex');
}

export function validateSeloSchema(value) {
  const valid = compiledSchema(value);
  const errors = valid ? [] : (compiledSchema.errors ?? []).map((error) => issue(
    'schema',
    error.instancePath || '/',
    error.keyword,
    error.message ?? 'violação do JSON Schema',
    structuredClone(error.params ?? {})
  ));
  return { valid, errors };
}

export function validateSeloSemantics(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: [issue('semantic', '/', 'object', 'registro deve ser um objeto')] };
  const slug = typeof value.slug === 'string' ? value.slug : '';
  const canonical = value.seo?.canonical_path;
  const expected = `/selos/${slug}`;
  if (typeof canonical === 'string' && canonical !== expected) {
    errors.push(issue('semantic', '/seo/canonical_path', 'canonicalPath', `deve ser exatamente ${expected}`, { expected, actual: canonical }));
  }
  return { valid: errors.length === 0, errors };
}

export function validateSeloEditorial(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: [issue('editorial', '/', 'object', 'registro deve ser um objeto')] };
  const approval = value.aprovacao_humana;
  const active = value.publicacao?.status === 'aprovado' || value.publicacao?.status === 'publicado' || approval?.status === 'aprovado';
  if (active && approval) {
    if (approval.versao_aprovada !== value.auditoria?.versao) {
      errors.push(issue('editorial', '/aprovacao_humana/versao_aprovada', 'approvedVersion', 'versão diverge da aprovação', { expected: value.auditoria?.versao, actual: approval.versao_aprovada }));
    }
    if (typeof approval.hash_do_registro_aprovado === 'string' && approval.hash_do_registro_aprovado !== recordHash(value)) {
      errors.push(issue('editorial', '/aprovacao_humana/hash_do_registro_aprovado', 'approvedHash', 'conteúdo diverge do hash aprovado', { expected: approval.hash_do_registro_aprovado, actual: recordHash(value) }));
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateSeloData(value) {
  const structural = validateSeloSchema(value);
  const semantic = validateSeloSemantics(value);
  const editorial = structural.valid ? validateSeloEditorial(value) : { valid: false, errors: [] };
  const errors = [...structural.errors, ...semantic.errors, ...editorial.errors];
  return { valid: errors.length === 0, structural, semantic, editorial, errors };
}

export function formatValidationIssue(error) {
  return `[${error.type}] ${error.instancePath || '/'} (${error.keyword}): ${error.message}`;
}

export function assertSeloData(value, source = 'registro') {
  const result = validateSeloData(value);
  if (!result.valid) throw new Error(`${source}:\n- ${result.errors.map(formatValidationIssue).join('\n- ')}`);
  return value;
}

export function schemaIsCompiled() {
  return typeof compiledSchema === 'function';
}
