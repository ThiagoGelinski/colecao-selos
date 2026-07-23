import type { Selo, StatusPublicacao } from '../types/selo';

const statuses: StatusPublicacao[] = ['rascunho', 'em_pesquisa', 'identificacao_parcial', 'aguardando_revisao', 'homologacao', 'aprovado', 'publicado', 'revisao_necessaria'];

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
    const aprovacao = selo.aprovacao_humana;
    if (!aprovacao) {
      errors.push('publicação bloqueada: aprovação humana obrigatória ausente.');
    } else {
      if (aprovacao.status !== 'aprovado' || aprovacao.decisao !== 'aprovado') errors.push('publicação bloqueada: decisão humana não aprovada.');
      if (!aprovacao.revisor?.trim()) errors.push('publicação bloqueada: revisor humano não identificado.');
      if (!aprovacao.revisado_em || Number.isNaN(Date.parse(aprovacao.revisado_em))) errors.push('publicação bloqueada: data de revisão humana inválida.');
      if (aprovacao.escopo !== 'publicacao_catalogo') errors.push('publicação bloqueada: escopo da aprovação humana inválido.');
    }
  }  if (errors.length) throw new Error(`${source}:\n- ${errors.join('\n- ')}`);
}
