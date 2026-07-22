import type { Selo, StatusPublicacao } from '../types/selo';
import { validateSelo } from './validators';
import { publicationMode } from './config';

const modules = import.meta.glob('../data/selos/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const all = Object.entries(modules).map(([path, value]) => { validateSelo(value, path); return value; }).sort((a, b) => a.id.localeCompare(b.id));

export const getAllSelos = (): Selo[] => [...all];
export const getSeloBySlug = (slug: string): Selo | undefined => all.find((s) => s.slug === slug);
export const getSeloById = (id: string): Selo | undefined => all.find((s) => s.id === id);
export const getSelosByStatus = (status: StatusPublicacao): Selo[] => all.filter((s) => s.publicacao.status === status);
export const getPublishedSelos = (): Selo[] => all.filter((s) => s.publicacao.status === 'publicado' && s.publicacao.apto_para_publicacao !== false);
export const getPreviewSelos = (): Selo[] => all.filter((s) => s.publicacao.status !== 'rascunho' && s.publicacao.apto_para_preview !== false);
export const getVisibleSelos = (): Selo[] => publicationMode === 'production' ? getPublishedSelos() : getPreviewSelos();
