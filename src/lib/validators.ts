import { createHash } from 'node:crypto';
import type { Selo, StatusPublicacao } from '../types/selo';

const statuses: StatusPublicacao[] = [
  'rascunho',
  'em_pesquisa',
  'identificacao_parcial',
  'aguardando_revisao',
  'homologacao',
  'aprovado',
  'publicado',
  'revisao_necessaria'
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key])]));
  }
  return value;
}

function contentHash(selo: Selo): string {
  const { aprovacao_humana: _approval, publicacao: _publication, auditoria: _audit, ...content } = selo;
  return createHash('sha256').update(JSON.stringify(canonicalize(content)), 'utf8').digest('hex');
}

export function validateSelo(value: unknown, source = 'registro'): asserts value is Selo {
  if (!value || typeof value !== 'object') throw new Error(`${source}: JSON deve ser um objeto.`);
  const selo = value as Partial<Selo>;
  const errors: string[] = [];

  if (!/^SEL-[0-9]{6}$/.test(selo.id ?? '')) errors.push('ID fora do padrão ^SEL-[0-9]{6}$.');
  if (!selo.slug?.trim()) errors.push('slug obrigatório ausente.');
  if (!selo.titulo?.trim()) errors.push('título obrigatório ausente.');
  if (!selo.imagens?.frente?.trim()) errors.push('imagem de frente obrigatória ausente.');
  if (!selo.imagens?.card?.trim()) errors.push('imagem de card obrigatória ausente.');
  if (!selo.publicacao?.status || !statuses.includes(selo.publicacao.status)) errors.push('status de publicação inválido.');
  if (selo.emissao?.ano != null && (!Number.isInteger(selo.emissao.ano) || selo.emissao.ano < 1000 || selo.emissao.ano > 9999)) errors.push('ano deve conter quatro dígitos.');
  if (!selo.seo?.title?.trim()) errors.push('SEO sem título.');
  if (!selo.seo?.meta_description?.trim()) errors.push('SEO sem descrição.');
  if (!Array.isArray(selo.fontes)) errors.push('fontes deve ser um array.');
  if (!selo.catalogos || typeof selo.catalogos !== 'object' || Array.isArray(selo.catalogos)) errors.push('catálogos em formato inesperado.');

  if (selo.publicacao?.status === 'publicado' || selo.publicacao?.apto_para_publicacao === true) {
    const approval = selo.aprovacao_humana;
    if (!approval) {
      errors.push('publicação bloqueada: aprovação humana obrigatória ausente.');
    } else {
      if (approval.status !== 'aprovado' || approval.decisao !== 'aprovado') errors.push('publicação bloqueada: decisão humana não aprovada.');
      if (!approval.aprovado_por?.trim()) errors.push('publicação bloqueada: aprovado_por ausente.');
      if (!approval.aprovado_em || Number.isNaN(Date.parse(approval.aprovado_em))) errors.push('publicação bloqueada: aprovado_em inválido.');
      if (!/^[a-f0-9]{64}$/.test(approval.hash_do_registro_aprovado ?? '')) errors.push('publicação bloqueada: hash aprovado inválido.');
      if (!approval.versao_aprovada?.trim()) errors.push('publicação bloqueada: versão aprovada ausente.');
      if (approval.escopo !== 'publicacao_catalogo') errors.push('publicação bloqueada: escopo da aprovação humana inválido.');
      if (selo.auditoria?.versao !== approval.versao_aprovada) errors.push('publicação bloqueada: versão diverge da aprovação.');
      if (selo.id && approval.hash_do_registro_aprovado && contentHash(selo as Selo) !== approval.hash_do_registro_aprovado) errors.push('publicação bloqueada: conteúdo diverge do hash aprovado.');
    }
  }

  if (errors.length) throw new Error(`${source}:\n- ${errors.join('\n- ')}`);
}
