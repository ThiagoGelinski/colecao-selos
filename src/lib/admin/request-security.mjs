import { apiError, jsonResponse } from './api.mjs';

function forwardedOrigin(request) {
  const host = request.headers.get('x-forwarded-host');
  const protocol = request.headers.get('x-forwarded-proto');
  if (!host || !protocol || host.includes(',') || protocol.includes(',')) return null;
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) || !/^https?$/i.test(protocol)) return null;
  try { return new URL(`${protocol.toLowerCase()}://${host}`).origin; }
  catch { return null; }
}

export function validateAdminMutationOrigin(request) {
  try {
    const received = request.headers.get('origin');
    if (!received) return false;
    const receivedUrl = new URL(received);
    if (received !== receivedUrl.origin) return false;
    const allowed = new Set([new URL(request.url).origin]);
    const forwarded = forwardedOrigin(request);
    if (forwarded) allowed.add(forwarded);
    return allowed.has(receivedUrl.origin);
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
