import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse } from '../../../../lib/admin/api.mjs';
import { invalidOriginResponse, validateAdminMutationOrigin } from '../../../../lib/admin/request-security.mjs';
import { SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/admin/session.mjs';
export const prerender = false;
export const POST: APIRoute = async ({ request, cookies }) => {
    if (!validateAdminMutationOrigin(request)) return invalidOriginResponse();
  cookies.delete(SESSION_COOKIE, sessionCookieOptions(0) as Parameters<typeof cookies.delete>[1]);
  return jsonResponse(apiPayload({ loggedOut: true }));
};

