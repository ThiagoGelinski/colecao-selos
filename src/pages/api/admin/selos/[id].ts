import type { APIRoute } from 'astro';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../lib/admin/api.mjs';
import { getAdminStamp } from '../../../../lib/admin/catalog-service';
export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  try {
    const id = String(params.id ?? '');
    if (!/^SEL-\d{6}$/.test(id)) return jsonResponse(apiError('INVALID_ID', 'Identificador inválido.'), 400);
    const stamp = await getAdminStamp(id);
    return stamp ? jsonResponse(apiPayload(stamp)) : jsonResponse(apiError('NOT_FOUND', 'Registro não encontrado.'), 404);
  } catch (error) { return safeApiFailure(error); }
};
