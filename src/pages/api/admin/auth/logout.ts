import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse } from '../../../../lib/admin/api.mjs';
import { SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/admin/session.mjs';
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return jsonResponse({ ok: false, error: { code: 'INVALID_ORIGIN', message: 'Origem da requisição inválida.' } }, 403);
  cookies.delete(SESSION_COOKIE, sessionCookieOptions(0) as Parameters<typeof cookies.delete>[1]);
  return jsonResponse(apiPayload({ loggedOut: true }));
};

