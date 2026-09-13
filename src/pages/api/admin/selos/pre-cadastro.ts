import type { APIRoute } from 'astro';
import { apiError, jsonResponse } from '../../../../lib/admin/api.mjs';
import { contentLengthExceeds, invalidOriginResponse, validateAdminMutationOrigin } from '../../../../lib/admin/request-security.mjs';
import { MAX_ORIGINAL_SIZE } from '../../../../lib/catalogo/media.mjs';
import { suggestStamp } from '../../../../lib/admin/pre-cadastro.mjs';
import { consumeRateLimit } from '../../../../lib/admin/rate-limit.mjs';
export const prerender = false;
const MAX_MULTIPART_SIZE = 2 * MAX_ORIGINAL_SIZE + 256 * 1024;
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminUser) return jsonResponse(apiError('UNAUTHORIZED', 'Autenticação necessária.'), 401);
  if (!['administrador', 'catalogador', 'revisor'].includes(locals.adminUser.role)) return jsonResponse(apiError('FORBIDDEN', 'Perfil sem permissão para pré-cadastro.'), 403);
  if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
  if (contentLengthExceeds(request, MAX_MULTIPART_SIZE)) return jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'Upload excede o limite permitido.'), 413);
  let form: FormData;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_MULTIPART_SIZE) return jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'Upload excede o limite permitido.'), 413);
    form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
  } catch { return jsonResponse(apiError('BAD_REQUEST', 'Falha ao processar as fotografias.'), 400); }
  const rate = consumeRateLimit('pre-cadastro:' + locals.adminUser.username, { limit: 5, windowMs: 60_000 });
  if (!rate.allowed) return jsonResponse(apiError('RATE_LIMITED', 'Aguarde um minuto para outra análise. O cadastro manual continua disponível.'), 429);
  const images = [];
  for (const side of ['frente', 'verso']) {
    const file = form.get(side);
    if (file === null) continue;
    if (!(file instanceof File) || !file.size || file.size > MAX_ORIGINAL_SIZE || !['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'image/x-tiff'].includes(file.type)) {
      return jsonResponse(apiError('VALIDATION_ERROR', 'Envie uma fotografia PNG, JPEG, WebP ou TIFF de até 5 MiB por lado.'), 422);
    }
    images.push({ side, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
  }
  return jsonResponse(await suggestStamp(images));
};
