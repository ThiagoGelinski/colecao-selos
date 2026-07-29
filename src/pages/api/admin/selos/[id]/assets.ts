import type { APIRoute } from 'astro';
import path from 'node:path';
import process from 'node:process';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../../lib/admin/api.mjs';
import { contentLengthExceeds, invalidOriginResponse, validateAdminMutationOrigin } from '../../../../../lib/admin/request-security.mjs';
import { getAdminStamp } from '../../../../../lib/admin/catalog-service.ts';
import { updateRecordAtomic, updateRecordExpected, existsAssetBinary, beginAssetReplacement, beginAssetCreation } from '../../../../../lib/catalogo/io.mjs';
import { dataPath } from '../../../../../lib/catalogo/records.mjs';
import { applyAssetMutation } from '../../../../../lib/catalogo/history.mjs';

export const prerender = false;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_SIZE = MAX_UPLOAD_SIZE + 64 * 1024;
const validWebp = (buffer: Buffer) => buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
const parseUpload = async (request: Request) => {
  if (contentLengthExceeds(request, MAX_MULTIPART_SIZE)) return { response: jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'O upload excede o limite permitido.'), 413) };
  let formData: FormData;
  try { formData = await request.formData(); } catch { return { response: jsonResponse(apiError('BAD_REQUEST', 'Falha estrutural ao processar multipart/form-data.'), 400) }; }
  const papel = formData.get('papel'); const file = formData.get('file');
  if (typeof papel !== 'string' || !['frente', 'verso', 'card', 'thumb'].includes(papel)) return { response: jsonResponse(apiError('VALIDATION_ERROR', 'Campo papel ausente ou inválido.', { errors: ['papel inválido'] } as any), 422) };
  if (!file || typeof file === 'string' || !(file instanceof File)) return { response: jsonResponse(apiError('VALIDATION_ERROR', 'Arquivo binário ausente.'), 422) };
  if (file.size > MAX_UPLOAD_SIZE) return { response: jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'O arquivo excede o limite de 5 MiB.'), 413) };
  if (file.type !== 'image/webp' || !/\.webp$/i.test(file.name)) return { response: jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Apenas arquivos WebP são permitidos.'), 415) };
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validWebp(buffer)) return { response: jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Assinatura profunda WebP inválida.'), 415) };
  return { papel, buffer, formData };
};

export const POST: APIRoute = async (context) => {
  try {
    const { request, params } = context;
    if (!context.locals?.adminUser) return jsonResponse(apiError('UNAUTHORIZED', 'Sessão inválida.'), 401);
    if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
    const adminUsername = context.locals.adminUser.username;
    const id = String(params.id ?? '');
    if (!/^SEL-\d{6}$/.test(id)) return jsonResponse(apiError('INVALID_ID', 'Formato de ID de selo inválido.'), 400);
    const stamp = await getAdminStamp(id);
    if (!stamp) return jsonResponse(apiError('NOT_FOUND', 'Registro do selo não encontrado.'), 404);
    const parsed = await parseUpload(request); if ('response' in parsed && parsed.response) return parsed.response;
    const { papel, buffer } = parsed;
    const canonicalVirtualPath = `/assets/selos/${id}/${id}-${papel}.webp`;
    if (stamp.resumo.imagens?.[papel as keyof typeof stamp.resumo.imagens]?.informado) return jsonResponse(apiError('CONFLICT', 'Registro já contempla uma mídia atrelada a este papel.'), 409);
    const target = path.join(process.cwd(), 'public', 'assets', 'selos', id, `${id}-${papel}.webp`);
    let creation;
    try { creation = await beginAssetCreation(target, buffer, 'image/webp'); }
    catch (error: any) { if (error?.code === 'ASSET_CONFLICT') return jsonResponse(apiError('CONFLICT', 'Já existe um asset para este papel.'), 409); throw error; }
    try {
      await updateRecordAtomic(dataPath(id), (draft: any) => {
        if (draft.imagens?.[papel]) throw Object.assign(new Error('Papel já preenchido.'), { code: 'RECORD_CONFLICT' });
        const candidate = applyAssetMutation(draft, { reviewer: adminUsername, kind: papel, operation: 'upload' });
        candidate.imagens = candidate.imagens ?? {}; candidate.imagens[papel] = canonicalVirtualPath; return candidate;
      });
      await creation.commit();
    } catch (error: any) {
      try { await creation.rollback(); }
      catch { console.error('admin_asset_initial_rollback_failed'); }
      if (error?.code === 'RECORD_CONFLICT') return jsonResponse(apiError('CONFLICT', 'O registro mudou durante o upload.'), 409);
      return jsonResponse(apiError('INTERNAL_ERROR', 'Não foi possível concluir o upload com segurança.'), 500);
    }
    return jsonResponse(apiPayload({ target: canonicalVirtualPath }), 200);
  } catch (error) { return safeApiFailure(error); }
};

export const PUT: APIRoute = async (context) => {
  try {
    const { request, params } = context;
    if (!context.locals?.adminUser) return jsonResponse(apiError('UNAUTHORIZED', 'Sessão inválida.'), 401);
    if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
    const adminUsername = context.locals.adminUser.username;
    const id = String(params.id ?? '');
    if (!/^SEL-\d{6}$/.test(id)) return jsonResponse(apiError('INVALID_ID', 'Formato de ID de selo inválido.'), 400);
    const stamp = await getAdminStamp(id); if (!stamp) return jsonResponse(apiError('NOT_FOUND', 'Registro do selo não encontrado.'), 404);
    const parsed = await parseUpload(request); if ('response' in parsed && parsed.response) return parsed.response;
    const { papel, buffer, formData } = parsed; const expectedUpdatedAt = formData.get('expected_updated_at');
    if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt || expectedUpdatedAt !== stamp.resumo.atualizado_em) return jsonResponse(apiError('CONFLICT', 'O registro mudou desde que foi aberto.'), 409);
    if (!stamp.resumo.imagens?.[papel as keyof typeof stamp.resumo.imagens]?.informado) return jsonResponse(apiError('NOT_FOUND', 'Não existe mídia atual para retificar neste papel.'), 404);
    const target = path.join(process.cwd(), 'public', 'assets', 'selos', id, `${id}-${papel}.webp`);
    if (!(await existsAssetBinary(target))) return jsonResponse(apiError('NOT_FOUND', 'O asset informado no registro não existe no storage.'), 404);
    let replacement;
    try { replacement = await beginAssetReplacement(target, buffer, 'image/webp'); }
    catch (error: any) { if (error?.code === 'ASSET_CONFLICT') return jsonResponse(apiError('CONFLICT', 'O asset foi alterado por outro processo.'), 409); if (error?.code === 'ENOENT') return jsonResponse(apiError('NOT_FOUND', 'O asset a retificar não existe.'), 404); throw error; }
    try {
      await updateRecordExpected(dataPath(id), expectedUpdatedAt, (draft: any) => applyAssetMutation(draft, { reviewer: adminUsername, kind: papel, operation: 'retificacao' }));
    } catch (error: any) {
      try { await replacement.rollback(); } catch { console.error('admin_asset_retification_rollback_failed'); return jsonResponse(apiError('INTERNAL_ERROR', 'Não foi possível concluir a retificação com segurança.'), 500); }
      if (error?.code === 'RECORD_CONFLICT') return jsonResponse(apiError('CONFLICT', 'O registro mudou durante a retificação.'), 409);
      return jsonResponse(apiError('INTERNAL_ERROR', 'A atualização do registro falhou; o asset anterior foi restaurado.'), 500);
    }
    try { await replacement.commit(); } catch { console.error('admin_asset_retification_cleanup_failed'); }
    return jsonResponse(apiPayload({ target: `/assets/selos/${id}/${id}-${papel}.webp`, message: 'Retificação efetuada com sucesso.' }), 200);
  } catch (error) { return safeApiFailure(error); }
};
