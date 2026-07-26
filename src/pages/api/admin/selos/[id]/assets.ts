import type { APIRoute } from 'astro';
import path from 'node:path';
import process from 'node:process';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../../lib/admin/api.mjs';
import { getAdminStamp } from '../../../../../lib/admin/catalog-service.ts';
import { updateRecordAtomic, writeAssetBinary, existsAssetBinary } from '../../../../../lib/catalogo/io.mjs';
import { dataPath } from '../../../../../lib/catalogo/records.mjs';

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
        if (stamp.registro.imagens && stamp.registro.imagens[papel as keyof typeof stamp.registro.imagens]) {
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

    } catch (e: any) {
        return safeApiFailure(e);
    }
};
