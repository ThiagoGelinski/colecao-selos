import type { APIRoute } from 'astro';
import { serveCatalogAsset } from '../../../../../lib/catalogo/asset-serving.mjs';

export const prerender = false;
export const GET: APIRoute = ({ params }) => serveCatalogAsset(params.id, params.filename);
