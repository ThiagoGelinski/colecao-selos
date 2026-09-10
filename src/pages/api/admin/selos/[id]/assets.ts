import type { APIRoute } from 'astro';
import path from 'node:path';
import process from 'node:process';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../../lib/admin/api.mjs';
import { contentLengthExceeds, invalidOriginResponse, validateAdminMutationOrigin } from '../../../../../lib/admin/request-security.mjs';
import { getAdminStamp } from '../../../../../lib/admin/catalog-service.ts';
import { updateRecordAtomic, existsAssetBinary, readAssetBinary, beginAssetReplacement, beginAssetCreation } from '../../../../../lib/catalogo/io.mjs';
import { dataPath } from '../../../../../lib/catalogo/records.mjs';
import { applyAssetMutation } from '../../../../../lib/catalogo/history.mjs';
import { jsonDigest } from '../../../../../lib/catalogo/digest.mjs';
import { MAX_ORIGINAL_SIZE, prepareMedia, archivePreparedMedia, archivePreviousDerivative } from '../../../../../lib/catalogo/media.mjs';

export const prerender = false;
const MAX_MULTIPART_SIZE = MAX_ORIGINAL_SIZE + 64 * 1024;
const conflict = () => Object.assign(new Error('O registro mudou desde que foi aberto.'), { code: 'RECORD_CONFLICT' });
const errorResponse = (code: string, message: string, status: number) => jsonResponse(apiError(code, message), status);
const parseUpload = async (request: Request) => {
  if (contentLengthExceeds(request, MAX_MULTIPART_SIZE)) return { response: errorResponse('PAYLOAD_TOO_LARGE', 'O upload excede o limite permitido.', 413) };
  let form: FormData;
  try { form = await request.formData(); } catch { return { response: errorResponse('BAD_REQUEST', 'Falha ao processar multipart/form-data.', 400) }; }
  const papel = form.get('papel'); const file = form.get('file'); const expected = form.get('expected_digest');
  if (typeof papel !== 'string' || !['frente', 'verso', 'card', 'thumb'].includes(papel)) return { response: jsonResponse(apiError('VALIDATION_ERROR', 'Campo papel ausente ou inválido.', { errors: ['papel inválido'] } as any), 422) };
  if (!(file instanceof File)) return { response: errorResponse('VALIDATION_ERROR', 'Arquivo binário ausente.', 422) };
  if (file.size > MAX_ORIGINAL_SIZE) return { response: errorResponse('PAYLOAD_TOO_LARGE', 'O arquivo excede o limite de 5 MiB.', 413) };
  const parseMargin = (name: string) => { const value = form.get(name) ?? '0'; return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : NaN; };
  const prepared = await prepareMedia(Buffer.from(await file.arrayBuffer()), { mime: file.type, crop_x: parseMargin('crop_x'), crop_y: parseMargin('crop_y') });
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return { response: errorResponse('CONFLICT', 'Reabra o registro para obter sua versão completa antes do upload.', 409) };
  return { papel, expected, prepared };
};

function handler(replace: boolean): APIRoute {
  return async (context) => {
    try {
      const { request, params } = context;
      const actor = context.locals?.adminUser;
      if (!actor) return errorResponse('UNAUTHORIZED', 'Sessão inválida.', 401);
      if (!['administrador', 'catalogador'].includes(actor.role)) return errorResponse('FORBIDDEN', 'Seu perfil não permite alterar fotografias.', 403);
      if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
      const id = String(params.id ?? '');
      if (!/^SEL-\d{6}$/.test(id)) return errorResponse('INVALID_ID', 'Formato de ID de selo inválido.', 400);
      const stamp = await getAdminStamp(id);
      if (!stamp) return errorResponse('NOT_FOUND', 'Registro do selo não encontrado.', 404);
      const parsed = await parseUpload(request);
      if ('response' in parsed) return parsed.response!;
      const { papel, expected, prepared } = parsed;
      if (jsonDigest(stamp.registro) !== expected) return errorResponse('CONFLICT', 'O registro mudou desde que foi aberto.', 409);
      const canonicalPath = `/assets/selos/${id}/${id}-${papel}.webp`;
      const target = path.join(process.cwd(), 'public', 'assets', 'selos', id, `${id}-${papel}.webp`);
      const exists = await existsAssetBinary(target);
      if (replace && (!stamp.registro.imagens?.[papel as keyof typeof stamp.registro.imagens] || !exists)) return errorResponse('NOT_FOUND', 'Não existe mídia atual para retificar neste papel.', 404);
      if (!replace && exists) return errorResponse('CONFLICT', 'Já existe um asset para este papel.', 409);
      const provenance = await archivePreparedMedia(prepared);
      const previousHash = replace ? await archivePreviousDerivative(await readAssetBinary(target)) : null;
      let transaction;
      try { transaction = replace ? await beginAssetReplacement(target, prepared.derived, 'image/webp', { expectedSha256: previousHash }) : await beginAssetCreation(target, prepared.derived, 'image/webp'); }
      catch (error: any) {
        if (error?.code === 'ASSET_CONFLICT') return errorResponse('CONFLICT', 'O asset foi alterado por outro processo.', 409);
        if (error?.code === 'ENOENT') return errorResponse('NOT_FOUND', 'O asset a retificar não existe.', 404);
        throw error;
      }
      let updated;
      try {
        updated = await updateRecordAtomic(dataPath(id), (draft: any) => {
          if (jsonDigest(draft) !== expected) throw conflict();
          const currentPath = draft.imagens?.[papel];
          if (currentPath && currentPath !== canonicalPath) throw conflict();
          const candidate = applyAssetMutation(draft, { reviewer: actor.username, kind: papel, operation: replace ? 'retificacao' : 'upload' });
          candidate.imagens = candidate.imagens ?? {}; candidate.imagens[papel] = canonicalPath;
          return candidate;
        });
      } catch (error: any) {
        try { await transaction.rollback(); }
        catch { console.error('admin_asset_rollback_failed'); return errorResponse('INTERNAL_ERROR', 'Não foi possível concluir a alteração com segurança.', 500); }
        if (error?.code === 'RECORD_CONFLICT') return errorResponse('CONFLICT', 'O registro mudou durante a alteração.', 409);
        return errorResponse('INTERNAL_ERROR', 'A atualização falhou; a mídia anterior foi preservada.', 500);
      }
      await transaction.commit();
      return jsonResponse(apiPayload({ target: canonicalPath, provenance, previous_derived_hash: previousHash, record_digest: jsonDigest(updated) }), 200);
    } catch (error: any) {
      if (error?.code === 'MEDIA_VALIDATION') return errorResponse(error.status === 413 ? 'PAYLOAD_TOO_LARGE' : error.status === 422 ? 'VALIDATION_ERROR' : 'UNSUPPORTED_MEDIA_TYPE', error.message, error.status);
      return safeApiFailure(error);
    }
  };
}
export const POST = handler(false);
export const PUT = handler(true);
