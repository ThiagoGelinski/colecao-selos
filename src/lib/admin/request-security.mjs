import { apiError, jsonResponse } from './api.mjs';

export function validateAdminMutationOrigin(request) {
  try {
    const expected = new URL(request.url).origin;
    const received = request.headers.get('origin');
    return Boolean(received && received === expected);
  } catch {
    return false;
  }
}

export function invalidOriginResponse() {
  return jsonResponse(apiError('INVALID_ORIGIN', 'Origem da requisição inválida.'), 403);
}

export function contentLengthExceeds(request, limit) {
  const raw = request.headers.get('content-length');
  if (raw === null) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value > limit;
}
