export type NivelConfianca = 'confirmado' | 'alta_confianca' | 'provavel' | 'pendente' | 'divergente' | string;
export type StatusPublicacao = 'rascunho' | 'em_pesquisa' | 'identificacao_parcial' | 'aguardando_revisao' | 'homologacao' | 'aprovado' | 'publicado' | 'revisao_necessaria';

export interface CatalogoRef {
  numero: string | null;
  tipo?: string | null;
  confianca: NivelConfianca;
  observacao?: string | null;
}

export interface Fonte {
  titulo: string;
  url?: string | null;
  tipo?: string | null;
  uso: string;
  data_consulta?: string | null;
  confianca?: NivelConfianca;
}

export interface AprovacaoHumana {
  status: 'pendente' | 'aprovado' | 'rejeitado' | 'revogado';
  decisao: 'pendente' | 'aprovado' | 'rejeitado';
  aprovado_por: string | null;
  aprovado_em: string | null;
  hash_do_registro_aprovado: string | null;
  versao_aprovada: string | null;
  escopo: 'publicacao_catalogo';
  observacao?: string | null;
  invalidado_em?: string | null;
  motivo_invalidacao?: string | null;
  rejeitado_por?: string | null;
  rejeitado_em?: string | null;
  motivo_rejeicao?: string | null;
  revogado_por?: string | null;
  revogado_em?: string | null;
  motivo_revogacao?: string | null;
}

export interface EventoEditorial {
  tipo: 'aprovacao' | 'rejeicao' | 'revogacao' | 'publicacao' | 'invalidacao';
  ocorrido_em: string;
  responsavel: string;
  motivo: string | null;
  hash: string | null;
  versao: string | null;
}

export interface Selo {
  schema_version: string;
  id: string;
  slug: string;
  titulo: string;
  descricao_curta: string;
  identificacao: {
    pais: string;
    continente?: string | null;
    administracao_postal?: string | null;
    tipo: string;
    categoria: string;
    serie?: string | null;
    tema: string[];
    personagem?: { nome: string; nascimento?: string | null; falecimento?: string | null; funcao?: string | null; mandato?: string | null } | null;
    valor_facial: { valor: number | string; unidade: string; inscricao?: string | null };
    cor?: string | null;
    orientacao?: 'vertical' | 'horizontal' | 'quadrado' | null;
  };
  emissao: { ano?: number | null; data_oficial?: string | null; data_status?: NivelConfianca | string | null; finalidade?: string | null; tiragem?: number | string | null; tiragem_status?: string | null };
  tecnica: { impressao?: string | null; papel?: string | null; goma_original_da_emissao?: string | null; filigrana?: string | null; denteacao?: string | null; dimensoes_mm?: { largura?: number | null; altura?: number | null } | null; impressor?: string | null; impressor_status?: string | null };
  catalogos: { RHM?: CatalogoRef | null; Scott?: CatalogoRef | null; Michel?: CatalogoRef | null; Yvert_et_Tellier?: CatalogoRef | null; Stanley_Gibbons?: CatalogoRef | null; outros?: Record<string, CatalogoRef> };
  exemplar: { uso_postal?: string | null; carimbo_frontal?: string | null; goma?: string | null; charneira?: string | null; papel?: string | null; serrilha?: string | null; centragem?: string | null; rasgos?: string | null; dobras?: string | null; manchas?: string | null; classificacao_visual?: string | null; observacao?: string | null };
  imagens: { frente: string; verso?: string | null; card: string; thumb?: string | null; alt: string };
  historico: { resumo?: string | null; nota?: string | null };
  historico_editorial?: EventoEditorial[];
  fontes: Fonte[];
  seo: { title: string; meta_description: string; canonical_path: string; open_graph_title?: string | null; open_graph_description?: string | null; image?: string | null };
  relacionamentos?: { pais?: string[]; serie?: string[]; personagens?: string[]; temas?: string[]; anos?: number[]; selos_relacionados?: string[] };
  aprovacao_humana?: AprovacaoHumana;
  publicacao: { status: StatusPublicacao; apto_para_preview: boolean; apto_para_publicacao: boolean; motivo?: string | null };
  auditoria: { criado_em: string; ultima_revisao: string; versao: string };
}
