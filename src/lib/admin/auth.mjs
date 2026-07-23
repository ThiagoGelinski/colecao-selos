import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
function safeTextEqual(left, right) { const a = createHash('sha256').update(String(left)).digest(); const b = createHash('sha256').update(String(right)).digest(); return timingSafeEqual(a, b); }
export async function verifyCredentials(username, password, config) {
  const [, nText, rText, pText, saltText, expectedText] = config.passwordHash.split('$'); const expected = Buffer.from(expectedText, 'base64url');
  const derived = await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length, { N: Number(nText), r: Number(rText), p: Number(pText), maxmem: 64 * 1024 * 1024 });
  return safeTextEqual(username, config.username) && expected.length === derived.length && timingSafeEqual(expected, derived);
}
export async function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('A senha deve ter ao menos 12 caracteres.'); const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 }); return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}


