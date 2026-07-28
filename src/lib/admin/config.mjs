import { ADMIN_ROLES } from './roles.mjs';
const DEFAULT_TTL_SECONDS = 60 * 60 * 8;
export class AuthConfigurationError extends Error { constructor(message) { super(message); this.name = 'AuthConfigurationError'; } }
function required(env, name) { const value = env[name]?.trim(); if (!value) throw new AuthConfigurationError(`Variável obrigatória ausente: ${name}.`); return value; }
export function loadAuthConfig(env = process.env) {
  const sessionSecret = required(env, 'ADMIN_SESSION_SECRET'); if (sessionSecret.length < 32) throw new AuthConfigurationError('ADMIN_SESSION_SECRET deve ter ao menos 32 caracteres.');
  const role = env.ADMIN_ROLE?.trim() || 'administrador'; if (!ADMIN_ROLES.includes(role)) throw new AuthConfigurationError('ADMIN_ROLE não é reconhecido.');
  const ttl = Number(env.ADMIN_SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS); if (!Number.isInteger(ttl) || ttl < 300 || ttl > 86400) throw new AuthConfigurationError('ADMIN_SESSION_TTL_SECONDS deve estar entre 300 e 86400.');
  return { sessionSecret, role, ttl };
}
export function loadBootstrapConfig(env = process.env) {
  const enabled = env.ADMIN_BOOTSTRAP_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled) throw new AuthConfigurationError('Bootstrap administrativo não habilitado.');
  const context = env.CONTEXT?.trim().toLowerCase() || 'local';
  if (context === 'deploy-preview' || context === 'branch-deploy') throw new AuthConfigurationError('Bootstrap administrativo não autorizado neste contexto.');
  if (context !== 'production' && context !== 'local' && context !== 'dev' && context !== 'development') throw new AuthConfigurationError('Contexto de bootstrap administrativo não reconhecido.');
  const bootstrapSecret = required(env, 'ADMIN_BOOTSTRAP_SECRET');
  if (bootstrapSecret.length < 32) throw new AuthConfigurationError('ADMIN_BOOTSTRAP_SECRET deve ter ao menos 32 caracteres.');
  return { enabled: true, context, bootstrapSecret };
}