import { ADMIN_ROLES } from './roles.mjs';
export const SESSION_COOKIE = 'colecao_admin_session';
const encoder = new TextEncoder();
const toBase64Url = (bytes) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
const fromBase64Url = (value) => { const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='); const binary = atob(base64); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); };
async function hmacKey(secret) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function createSession(config, now = Date.now()) {
  const payload = { sub: config.username, role: config.role, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + config.ttl, nonce: crypto.randomUUID() };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload))); const signature = await crypto.subtle.sign('HMAC', await hmacKey(config.sessionSecret), encoder.encode(encoded));
  return { token: `${encoded}.${toBase64Url(new Uint8Array(signature))}`, payload };
}
export async function verifySession(token, config, now = Date.now()) {
  if (typeof token !== 'string') return { valid: false, reason: 'missing' }; const [encoded, signature, extra] = token.split('.'); if (!encoded || !signature || extra) return { valid: false, reason: 'invalid' };
  try {
    const validSignature = await crypto.subtle.verify('HMAC', await hmacKey(config.sessionSecret), fromBase64Url(signature), encoder.encode(encoded)); if (!validSignature) return { valid: false, reason: 'invalid' };
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))); if (payload.sub !== config.username || !ADMIN_ROLES.includes(payload.role)) return { valid: false, reason: 'invalid' };
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) return { valid: false, reason: 'expired' };
    return { valid: true, user: { username: payload.sub, role: payload.role }, expiresAt: payload.exp };
  } catch { return { valid: false, reason: 'invalid' }; }
}
export function sessionCookieOptions(maxAge) { return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge }; }

