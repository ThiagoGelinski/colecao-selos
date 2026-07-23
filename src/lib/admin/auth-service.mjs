import { hashPassword, validateNewPassword, verifyCredentials } from './auth.mjs';
import { loadAdminCredentials, persistDefinitivePassword } from './credential-store.mjs';
export async function authenticateAdmin(store, username, password) {
  const credentials = await loadAdminCredentials(store); const valid = await verifyCredentials(username, password, credentials);
  return { valid, credentials };
}
export async function changeAdminPassword(store, currentPassword, newPassword, confirmation, role = 'administrador') {
  const current = await loadAdminCredentials(store);
  if (!current.bootstrap_required && role !== 'administrador') return { ok: false, code: 'FORBIDDEN', message: 'Seu perfil não permite alterar a senha.', status: 403 };
  if (!(await verifyCredentials(current.username, currentPassword, current))) return { ok: false, code: 'INVALID_CURRENT_PASSWORD', message: 'A senha atual está incorreta.', status: 400 };
  const validation = validateNewPassword(newPassword, confirmation, current.username); if (!validation.valid) return { ok: false, ...validation, status: 400 };
  const passwordHash = await hashPassword(newPassword); const credentials = await persistDefinitivePassword(store, current, passwordHash);
  return { ok: true, credentials };
}
