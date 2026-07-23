import { logAdminAuth } from './logging.mjs';

/** @param {unknown} data @param {unknown} [meta] */
export function apiPayload(data, meta = undefined) { return { ok: true, data, ...(meta ? { meta } : {}) }; }
export function apiError(code, message, details = undefined) { return { ok: false, error: { code, message, ...(details ? { details } : {}) } }; }
export function jsonResponse(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
export function safeApiFailure(error) {
  if (error?.name === 'AuthConfigurationError') { logAdminAuth('configuration_missing'); return jsonResponse(apiError('AUTH_UNAVAILABLE', 'Autenticação administrativa indisponível.'), 503); }
  if (error?.name === 'AdminStorageError') { logAdminAuth('authentication_storage_failure'); return jsonResponse(apiError('AUTH_UNAVAILABLE', 'Autenticação administrativa indisponível.'), 503); }
  return jsonResponse(apiError('INTERNAL_ERROR', 'Não foi possível concluir a operação.'), 500);
}
