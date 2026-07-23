import { defineMiddleware } from 'astro:middleware';
import { accessDecision } from './lib/admin/access.mjs';
import { apiError, jsonResponse } from './lib/admin/api.mjs';
import { loadAuthConfig } from './lib/admin/config.mjs';
import { createNetlifyAdminStore, loadAdminCredentials } from './lib/admin/credential-store.mjs';
import { logAdminAuth } from './lib/admin/logging.mjs';
import { SESSION_COOKIE, verifySession } from './lib/admin/session.mjs';
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" };
export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname; const adminSurface = pathname.startsWith('/admin') || pathname.startsWith('/api/admin'); if (!adminSurface) return next();
  let sessionValid = false; let sessionReason = 'missing'; let bootstrapRequired = false;
  try { const config = loadAuthConfig(); const credentials = await loadAdminCredentials(createNetlifyAdminStore()); const verified = await verifySession(context.cookies.get(SESSION_COOKIE)?.value, config, credentials); sessionValid = verified.valid; sessionReason = ('reason' in verified && verified.reason) ? verified.reason : 'valid'; bootstrapRequired = Boolean(verified.valid && verified.user?.bootstrapRequired); if ('user' in verified && verified.user) context.locals.adminUser = verified.user; } catch (error) { logAdminAuth(error instanceof Error && error.name === 'AuthConfigurationError' ? 'configuration_missing' : 'authentication_storage_failure'); sessionReason = 'configuration'; }
  const decision = accessDecision(pathname, sessionValid, bootstrapRequired); if (decision.action === 'redirect-login') { const target = new URL('/admin/login', context.url); target.searchParams.set('returnTo', pathname); return context.redirect(target.toString(), 302); }
  if (decision.action === 'redirect-first-access') return context.redirect(new URL('/admin/primeiro-acesso', context.url).toString(), 302); if (decision.action === 'json-bootstrap-required') return jsonResponse(apiError('BOOTSTRAP_REQUIRED', 'Configure seu acesso administrativo para continuar.'), 403, securityHeaders);
  if (decision.action === 'json-unauthorized') return jsonResponse(apiError(sessionReason === 'expired' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED', sessionReason === 'expired' ? 'Sessão expirada.' : 'Autenticação necessária.'), 401, securityHeaders);
  const response = await next(); for (const [key, value] of Object.entries(securityHeaders)) response.headers.set(key, value); response.headers.set('Cache-Control', 'no-store'); return response;
});
