import type { APIRoute } from 'astro';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../lib/admin/api.mjs';
import { normalizeSlug } from '../../../../lib/catalogo/records.mjs';
import { createStampTransaction } from '../../../../lib/catalogo/transactions.mjs';
export const prerender = false;

const MAX_BODY_BYTES = 100_000;

export const GET: APIRoute = async ({ url }) => {
  try {
    const { getAdminStamps } = await import('../../../../lib/admin/catalog-service.ts');
    const result = await getAdminStamps({ q: url.searchParams.get('q') ?? '', status: url.searchParams.get('status') ?? '', sort: url.searchParams.get('sort') ?? 'id', direction: url.searchParams.get('direction') ?? 'asc', page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 20) });
    return jsonResponse(apiPayload(result.items, { ...result.meta, filters: result.filters }));
  } catch (error) { return safeApiFailure(error); }
};

export const POST: APIRoute = async ({ request, locals }) => {
  // Autenticação: middleware já bloqueou sem sessão, mas defensivamente verificamos
  if (!locals.adminUser) {
    return jsonResponse(apiError('UNAUTHORIZED', 'Autenticação necessária.'), 401);
  }

  // Validação de Content-Type
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return jsonResponse(apiError('INVALID_CONTENT_TYPE', 'Content-Type deve ser application/json.'), 415);
  }

  // Limite de tamanho do payload
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'Payload excede o limite permitido.'), 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return jsonResponse(apiError('PAYLOAD_TOO_LARGE', 'Payload excede o limite permitido.'), 413);
    }
    body = JSON.parse(text);
  } catch {
    return jsonResponse(apiError('INVALID_JSON', 'Body inválido: JSON malformado.'), 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(apiError('INVALID_BODY', 'Body deve ser um objeto JSON.'), 400);
  }

  const raw = body as Record<string, unknown>;

  // Validar e sanitizar campos obrigatórios
  const tituloRaw = typeof raw.titulo === 'string' ? raw.titulo.trim().slice(0, 500) : '';
  if (!tituloRaw) {
    return jsonResponse(apiError('VALIDATION_ERROR', 'Campo obrigatório ausente.'), 422);
  }

  const slugRaw = typeof raw.slug === 'string' ? raw.slug : tituloRaw;
  const slug = normalizeSlug(slugRaw);
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return jsonResponse(apiError('VALIDATION_ERROR', 'Slug inválido. Use apenas letras minúsculas, números e hífens.'), 422);
  }

  try {
    const result = await createStampTransaction({ slug, title: tituloRaw });
    return jsonResponse(apiPayload({ id: result.id, slug: result.slug }), 201);
  } catch (error) {
    if (error && typeof error === 'object') {
      const e = error as { name?: string; message?: string; code?: string; stack?: string };
      console.error('--- DIAGNÓSTICO NETLIFY DEPLOY PREVIEW ---');
      console.error('Etapa: POST /api/admin/selos -> catch loop (Falha no pipeline)');
      console.error(`Error.name: ${e.name || 'N/A'}`);
      console.error(`Error.message: ${e.message || 'N/A'}`);
      if (e.code) console.error(`Error.code: ${e.code}`);
      if (e.stack) console.error(`Error.stack:\n${e.stack}`);
      console.error('--------------------------------------------');
    } else {
      console.error('--- DIAGNÓSTICO NETLIFY DEPLOY PREVIEW ---');
      console.error('Erro primitivo:', error);
      console.error('--------------------------------------------');
    }

    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string };
      if (err.name === 'TransactionError' || err.name === 'ManifestError' || err.name === 'IntegrityError') {
        // Extrair mensagem segura sem expor caminhos de sistema
        const message = typeof err.message === 'string' ? err.message : 'Erro ao criar registro.';
        const safeMessage = message.includes('Slug duplicado') ? 'Slug já utilizado por outro registro.' :
          message.includes('ID ou sequence') ? 'Conflito de ID. Tente novamente.' :
            message.includes('já existe') ? 'Registro já existe.' :
              'Não foi possível criar o registro.';
        return jsonResponse(apiError('TRANSACTION_ERROR', safeMessage), 409);
      }
    }
    return safeApiFailure(error);
  }
};
