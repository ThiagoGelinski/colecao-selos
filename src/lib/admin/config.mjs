import { ADMIN_ROLES } from './roles.mjs';
const DEFAULT_TTL_SECONDS = 60 * 60 * 8;
export class AuthConfigurationError extends Error { constructor(message) { super(message); this.name = 'AuthConfigurationError'; } }
function required(env, name) { const value = env[name]?.trim(); if (!value) throw new AuthConfigurationError(`Variável obrigatória ausente: ${name}.`); return value; }
export function loadAuthConfig(env = process.env) {
  const username = required(env, 'ADMIN_USERNAME'); const passwordHash = required(env, 'ADMIN_PASSWORD_HASH'); const sessionSecret = required(env, 'ADMIN_SESSION_SECRET');
  if (sessionSecret.length < 32) throw new AuthConfigurationError('ADMIN_SESSION_SECRET deve ter ao menos 32 caracteres.');
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash)) throw new AuthConfigurationError('ADMIN_PASSWORD_HASH usa formato inválido.');
  const role = env.ADMIN_ROLE?.trim() || 'administrador'; if (!ADMIN_ROLES.includes(role)) throw new AuthConfigurationError('ADMIN_ROLE não é reconhecido.');
  const ttl = Number(env.ADMIN_SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS); if (!Number.isInteger(ttl) || ttl < 300 || ttl > 86400) throw new AuthConfigurationError('ADMIN_SESSION_TTL_SECONDS deve estar entre 300 e 86400.');
  return { username, passwordHash, sessionSecret, role, ttl };
}
