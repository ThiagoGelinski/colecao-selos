import type { APIRoute } from 'astro';
import { apiError, jsonResponse } from '../../../../../../lib/admin/api.mjs';
import { serveAdminCatalogAsset } from '../../../../../../lib/catalogo/asset-serving.mjs';

export const prerender = false;
export const GET: APIRoute = ({ params, locals }) => {
  if (!locals.adminUser) return jsonResponse(apiError('UNAUTHORIZED', 'Autenticação necessária.'), 401, { 'Cache-Control': 'no-store' });
  const { id, papel } = params;
  if (!id || !/^SEL-[0-9]{6}$/.test(id) || !papel || !['frente', 'verso', 'card', 'thumb'].includes(papel)) return new Response('Not Found', { status: 404 });
  return serveAdminCatalogAsset(id, id + '-' + papel + '.webp');
};
