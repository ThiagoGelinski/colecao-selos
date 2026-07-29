import type { APIRoute } from 'astro';
import { apiError, apiPayload, jsonResponse, safeApiFailure } from '../../../../lib/admin/api.mjs';
import { invalidOriginResponse, validateAdminMutationOrigin } from '../../../../lib/admin/request-security.mjs';
import { completeFirstAccess } from '../../../../lib/admin/auth-service.mjs';
import { loadAuthConfig } from '../../../../lib/admin/config.mjs';
import { createNetlifyAdminStore } from '../../../../lib/admin/credential-store.mjs';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '../../../../lib/admin/session.mjs';
import { consumeRateLimit } from '../../../../lib/admin/rate-limit.mjs';
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  try {
    if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
    const client = request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'; const rate = consumeRateLimit(`first-access:${client}:${locals.adminUser?.username ?? 'unknown'}`, { limit: 3, windowMs: 300_000 }); if (!rate.allowed) return jsonResponse(apiError('RATE_LIMITED', 'Muitas tentativas. Aguarde antes de tentar novamente.'), 429, { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) });
    let body: unknown; try { body = await request.json(); } catch { return jsonResponse(apiError('INVALID_JSON', 'Corpo JSON inválido.'), 400); } if (!body || typeof body !== 'object') return jsonResponse(apiError('INVALID_INPUT', 'Dados inválidos.'), 400); const { username, newPassword, confirmation } = body as Record<string, unknown>;
    if (![username, newPassword, confirmation].every((value) => typeof value === 'string' && value.length <= 500)) return jsonResponse(apiError('INVALID_INPUT', 'Dados inválidos.'), 400);
    const completed = await completeFirstAccess(createNetlifyAdminStore(), username, newPassword, confirmation); if (!completed.ok || !completed.credentials) return jsonResponse(apiError(completed.code ?? 'FIRST_ACCESS_FAILED', completed.message ?? 'Não foi possível criar o acesso.'), completed.status ?? 400);
    const config = loadAuthConfig(); const session = await createSession(config, completed.credentials); cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(config.ttl) as Parameters<typeof cookies.set>[2]); return jsonResponse(apiPayload({ created: true, user: { username: completed.credentials.username, role: config.role }, expiresAt: session.payload.exp }));
  } catch (error) { return safeApiFailure(error); }
};
