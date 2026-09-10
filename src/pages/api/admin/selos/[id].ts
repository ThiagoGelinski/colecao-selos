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

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.adminUser) return jsonResponse(apiError('UNAUTHORIZED','Autenticação necessária.'),401);
  const { validateAdminMutationOrigin, invalidOriginResponse } = await import('../../../../lib/admin/request-security.mjs');
  if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
  if (!/^SEL-\d{6}$/.test(params.id ?? '')) return jsonResponse(apiError('INVALID_ID','Identificador inválido.'),400);
  if (!request.headers.get('content-type')?.includes('application/json')) return jsonResponse(apiError('INVALID_CONTENT_TYPE','Envie JSON.'),415);
  try {
    const text = await request.text();
    if (text.length > 100000) return jsonResponse(apiError('PAYLOAD_TOO_LARGE','Conteúdo muito grande.'),413);
    let body; try { body = JSON.parse(text); } catch { return jsonResponse(apiError('INVALID_JSON','JSON inválido.'),400); }
    const { editRecord } = await import('../../../../lib/admin/editor.mjs');
    return jsonResponse(apiPayload(await editRecord(params.id!,body?.expected_digest,body?.changes,locals.adminUser)));
  } catch (error: any) {
    if (error?.status && error?.code) return jsonResponse(apiError(error.code,error.message),error.status);
    if (error?.code === 'RECORD_CONFLICT') return jsonResponse(apiError('RECORD_CONFLICT','Registro alterado; recarregue a ficha.'),409);
    return safeApiFailure(error);
  }
};
