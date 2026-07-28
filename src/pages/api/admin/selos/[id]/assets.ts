import type { APIRoute } from 'astro';
import path from 'node:path';
import process from 'node:process';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../../lib/admin/api.mjs';
import { getAdminStamp } from '../../../../../lib/admin/catalog-service.ts';
import { updateRecordAtomic, updateRecordExpected, writeAssetBinary, existsAssetBinary, beginAssetReplacement } from '../../../../../lib/catalogo/io.mjs';
import { dataPath } from '../../../../../lib/catalogo/records.mjs';
import { appendEditorialEvent, revokeApproval } from '../../../../../lib/catalogo/history.mjs';

export const prerender = false;

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB limit derived from standards context

export const POST: APIRoute = async (context) => {
    try {
        const { request, params } = context;

        // 1. Auth Authorization Check
        if (!context.locals || !context.locals.adminUser) {
            return jsonResponse(apiError('UNAUTHORIZED', 'Sessão inválida.'), 401);
        }

        // 2. Validate Stamp ID Structure
        const id = String(params.id ?? '');
        if (!/^SEL-\d{6}$/.test(id)) {
            return jsonResponse(apiError('INVALID_ID', 'Formato de ID de selo inválido.'), 400);
        }

        // 3. Stamp Existance (Dual-source Load)
        const stamp = await getAdminStamp(id);
        if (!stamp) {
            return jsonResponse(apiError('NOT_FOUND', 'Registro do selo não encontrado.'), 404);
        }

        // 4. Form Data Parsing
        let formData;
        try {
            formData = await request.formData();
        } catch {
            return jsonResponse(apiError('BAD_REQUEST', 'Falha estrutural ao parsear Multipart Form.'), 400);
        }

        const papel = formData.get('papel');
        const file = formData.get('file');

        // 5. Explicit Contract Enforcements
        if (typeof papel !== 'string' || !['frente', 'verso', 'card', 'thumb'].includes(papel)) {
            return jsonResponse(apiError('VALIDATION_ERROR', 'Campo papel ausente ou com valor incompatível com classes base.', { errors: ['papel inválido'] } as any), 422);
        }

        if (!file || typeof file === 'string' || !(file instanceof File)) {
            return jsonResponse(apiError('VALIDATION_ERROR', 'Arquivo binário ausente.', { errors: ['arquivo ausente'] } as any), 422);
        }

        if (file.type !== 'image/webp') {
            return jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Extensão e MIME não suportados pela política agressiva. Apenas image/webp permitido.', { errors: ['MIME string incompatível'] } as any), 415);
        }

        if (file.size > MAX_UPLOAD_SIZE) {
            return jsonResponse(apiError('PAYLOAD_TOO_LARGE', `Tamanho excede o estrito limite de 5MB. Escala contida: ${file.size}B`), 413);
        }

        // 6. Overwrite Conservatism Evaluation
        const canonicalVirtualPath = `/assets/selos/${id}/${id}-${papel}.webp`;
        if (stamp.resumo.imagens && stamp.resumo.imagens[papel as keyof typeof stamp.resumo.imagens]?.informado) {
            return jsonResponse(apiError('CONFLICT', 'Registro já contempla uma mídia atrelada a este papel.'), 409);
        }

        const localFsCanonicalTarget = path.join(process.cwd(), 'public', 'assets', 'selos', id, `${id}-${papel}.webp`);
        const physConflict = await existsAssetBinary(localFsCanonicalTarget);
        if (physConflict) {
            return jsonResponse(apiError('CONFLICT', 'Asset binário homônimo oculto ou órfão encontrado no storage limitando inserção sem deleção prévia.'), 409);
        }

        // 7. Security Header & Magic Byte validations manually extracted via chunk Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 12) {
            return jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Sub-bytes malformados abaixo do threshold magic check.'), 415);
        }

        // Detect WEBP via RIFF/WEBP Signature (Bytes mapping)
        const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

        if (!isWebp) {
            // Blocks false extensions disguised as WebPs
            return jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Assinatura profunda WebP inválida; não ultrapassou RIFF File Magic Bytes inspection.'), 415);
        }

        // 8. Storage Persist Adapter layer
        try {
            await writeAssetBinary(localFsCanonicalTarget, buffer, 'image/webp' as any);
        } catch (e) {
            return jsonResponse(apiError('INTERNAL_ERROR', 'Falha isolada na persistência magnética do Store Provider.'), 500);
        }

        // 9. Atomic DB Merge Logic
        const recordTargetFs = dataPath(id);
        try {
            await updateRecordAtomic(recordTargetFs, (draft: any) => {
                if (!draft.imagens) draft.imagens = {};
                draft.imagens[papel] = canonicalVirtualPath;
                return draft;
            });
        } catch (e: any) {
            // Logs deterministically without removing the external asset logic if unsupported internally!
            console.error(`|-- CRITICAL ORPHAN AVERT --|\nAsset File salvado formalmente para ${id} (${papel}) => Falha em commit JSON!\nERR: ${e.message}`);
            return jsonResponse(apiError('INTERNAL_ERROR', 'Persistência magnética logada com Sucesso porém Transação JSON comutativa falhou. Possível orfandamento.', { transaction: false } as any), 500);
        }

        // 10. Success Return
        return jsonResponse(apiPayload({ target: canonicalVirtualPath }), 200);

    } catch (e: any) { return safeApiFailure(e); }
};

export const PUT: APIRoute = async (context) => {
    try {
        const { request, params } = context;
        if (!context.locals?.adminUser) return jsonResponse(apiError('UNAUTHORIZED', 'Sessão inválida.'), 401);
        const adminUsername = context.locals.adminUser.username;

        const id = String(params.id ?? '');
        if (!/^SEL-\d{6}$/.test(id)) return jsonResponse(apiError('INVALID_ID', 'Formato de ID de selo inválido.'), 400);

        const stamp = await getAdminStamp(id);
        if (!stamp) return jsonResponse(apiError('NOT_FOUND', 'Registro do selo não encontrado.'), 404);

        let formData;
        try { formData = await request.formData(); }
        catch { return jsonResponse(apiError('BAD_REQUEST', 'Falha estrutural ao processar multipart/form-data.'), 400); }

        const papel = formData.get('papel');
        const file = formData.get('file');
        const expectedUpdatedAt = formData.get('expected_updated_at');
        if (typeof papel !== 'string' || !['frente', 'verso', 'card', 'thumb'].includes(papel)) return jsonResponse(apiError('VALIDATION_ERROR', 'Campo papel ausente ou inválido.'), 422);
        if (!file || typeof file === 'string' || !(file instanceof File)) return jsonResponse(apiError('VALIDATION_ERROR', 'Arquivo binário ausente.'), 422);
        if (file.size > MAX_UPLOAD_SIZE) return jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'O arquivo excede o limite de 5 MiB.'), 413);
        if (file.type !== 'image/webp' || !/\.webp$/i.test(file.name)) return jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Apenas arquivos WebP são permitidos.'), 415);
        if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt || expectedUpdatedAt !== stamp.resumo.atualizado_em) return jsonResponse(apiError('CONFLICT', 'O registro mudou desde que foi aberto.'), 409);

        const imageState = stamp.resumo.imagens?.[papel as keyof typeof stamp.resumo.imagens];
        if (!imageState?.informado) return jsonResponse(apiError('NOT_FOUND', 'Não existe mídia atual para retificar neste papel.'), 404);

        const target = path.join(process.cwd(), 'public', 'assets', 'selos', id, `${id}-${papel}.webp`);
        if (!(await existsAssetBinary(target))) return jsonResponse(apiError('NOT_FOUND', 'O asset informado no registro não existe no storage.'), 404);

        const buffer = Buffer.from(await file.arrayBuffer());
        const isWebp = buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
        if (!isWebp) return jsonResponse(apiError('UNSUPPORTED_MEDIA_TYPE', 'Assinatura WebP inválida.'), 415);

        let replacement;
        try { replacement = await beginAssetReplacement(target, buffer, 'image/webp'); }
        catch (error: any) {
            if (error?.code === 'ASSET_CONFLICT') return jsonResponse(apiError('CONFLICT', 'O asset foi alterado por outro processo.'), 409);
            if (error?.code === 'ENOENT') return jsonResponse(apiError('NOT_FOUND', 'O asset a retificar não existe.'), 404);
            throw error;
        }

        try {
            await updateRecordExpected(dataPath(id), expectedUpdatedAt, (draft: any) => {
                const occurredAt = new Date().toISOString();
                const reason = `retificação administrativa do asset ${papel}`;
                let candidate = draft;
                if (draft.aprovacao_humana?.status === 'aprovado') {
                    candidate = revokeApproval(draft, { reviewer: adminUsername, reason, type: 'invalidacao', occurredAt });
                } else {
                    appendEditorialEvent(candidate, { tipo: 'rejeicao', responsavel: adminUsername, motivo: reason, hash: null, versao: draft.auditoria?.versao ?? null, ocorrido_em: occurredAt });
                }
                candidate.auditoria.ultima_revisao = occurredAt.slice(0, 10);
                candidate.auditoria.versao = `${draft.auditoria?.versao ?? '1.0.0'}+retificacao.${Date.parse(occurredAt)}`;
                return candidate;
            });
        } catch (error: any) {
            try { await replacement.rollback(); }
            catch { console.error('admin_asset_retification_rollback_failed'); return jsonResponse(apiError('INTERNAL_ERROR', 'Não foi possível concluir a retificação com segurança.'), 500); }
            if (error?.code === 'RECORD_CONFLICT') return jsonResponse(apiError('CONFLICT', 'O registro mudou durante a retificação.'), 409);
            return jsonResponse(apiError('INTERNAL_ERROR', 'A atualização do registro falhou; o asset anterior foi restaurado.'), 500);
        }

        try { await replacement.commit(); }
        catch { console.error('admin_asset_retification_cleanup_failed'); }
        return jsonResponse(apiPayload({ target: `/assets/selos/${id}/${id}-${papel}.webp`, message: 'Retificação efetuada com sucesso.' }), 200);
    } catch (error: any) {
        return safeApiFailure(error);
    }
};