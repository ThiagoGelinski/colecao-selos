import type { APIRoute } from 'astro';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../../lib/admin/api.mjs';
import { validateAdminMutationOrigin, invalidOriginResponse } from '../../../../../lib/admin/request-security.mjs';
import { runtimePublicationService } from '../../../../../lib/publicacao/publisher.mjs';
export const prerender = false;
export const POST: APIRoute = async ({params,request,locals}) => {
  if (!locals.adminUser) return jsonResponse(apiError('UNAUTHORIZED','Autenticação necessária.'),401);
  if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
  if (!/^SEL-\d{6}$/.test(params.id ?? '')) return jsonResponse(apiError('INVALID_ID','Identificador inválido.'),400);
  if (!request.headers.get('content-type')?.includes('application/json')) return jsonResponse(apiError('INVALID_CONTENT_TYPE','Envie JSON.'),415);
  try {
    const text = await request.text();
    if (text.length > 10000) return jsonResponse(apiError('PAYLOAD_TOO_LARGE','Conteúdo muito grande.'),413);
    let body; try { body = JSON.parse(text); } catch { return jsonResponse(apiError('INVALID_JSON','JSON inválido.'),400); }
    if (!body || !['prepare','approve','status','publish'].includes(body.action)) return jsonResponse(apiError('INVALID_ACTION','Etapa de publicação inválida.'),422);
    if (body.action === 'status' && !process.env.GITHUB_PUBLISH_TOKEN) return jsonResponse(apiPayload({configured:false,state:'none',ci_passed:false,can_publish:false}));
    const service = runtimePublicationService();
    const id = params.id!, user = locals.adminUser;
    const result = body.action === 'prepare' ? await service.prepare(id,user)
      : body.action === 'approve' ? await service.approve(id,body.snapshot_hash,body.confirm,user)
      : body.action === 'publish' ? await service.publish(id,body.head_sha,user)
      : await service.status(id,user);
    return jsonResponse(apiPayload(result));
  } catch (error: any) {
    if (error?.status && error?.code) return jsonResponse(apiError(error.code,error.message),error.status);
    if (error?.code === 'ENOENT') return jsonResponse(apiError('MISSING_FILE','Registro ou fotografia ausente.'),422);
    if (error?.code === 'MANIFEST_PUBLICATION_PENDING') return jsonResponse(apiError('MANIFEST_PUBLICATION_PENDING','Há uma integração anterior pendente. Confira a revisão no GitHub e o deploy antes de preparar outra publicação.'),409);
    if (error?.code === 'RECORD_CONFLICT') return jsonResponse(apiError('RECORD_CONFLICT','Dados alterados; recarregue e prepare novamente.'),409);
    return safeApiFailure(error);
  }
};