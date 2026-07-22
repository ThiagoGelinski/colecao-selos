import type { Selo } from '../types/selo';
import { siteUrl } from './config';

export const absoluteUrl = (path: string) => new URL(path, siteUrl).toString();
export const seloJsonLd = (selo: Selo) => ({
  '@context': 'https://schema.org', '@type': ['CreativeWork', 'VisualArtwork'],
  name: selo.titulo, identifier: selo.id, description: selo.descricao_curta,
  image: [absoluteUrl(selo.imagens.frente), ...(selo.imagens.verso ? [absoluteUrl(selo.imagens.verso)] : [])],
  temporalCoverage: selo.emissao.ano ? String(selo.emissao.ano) : undefined,
  countryOfOrigin: { '@type': 'Country', name: selo.identificacao.pais },
  about: [...selo.identificacao.tema, selo.identificacao.personagem?.nome].filter(Boolean),
});
