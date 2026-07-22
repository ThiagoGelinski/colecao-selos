export type PublicationMode = 'preview' | 'production';

export const publicationMode: PublicationMode = import.meta.env.PUBLICATION_MODE === 'production' ? 'production' : 'preview';
export const isPreviewMode = publicationMode === 'preview';
export const siteUrl = import.meta.env.SITE_URL || 'https://DOMINIO-A-DEFINIR';
