import { hashPassword, normalizeAdminUsername, validateNewPassword, verifyCredentials } from './auth.mjs';
import { loadAdminCredentials, persistDefinitiveAdmin, persistPasswordChange } from './credential-store.mjs';
export async function authenticateAdmin(store, username, password, loadOptions) { const credentials = await loadAdminCredentials(store, loadOptions); const valid = await verifyCredentials(username, password, credentials); return { valid, credentials }; }
export async function completeFirstAccess(store, username, newPassword, confirmation, loadOptions) {
  const current = await loadAdminCredentials(store, loadOptions); if (!current.bootstrap_required || current.bootstrap_consumed) return { ok: false, code: 'BOOTSTRAP_CONSUMED', message: 'O primeiro acesso já foi concluído.', status: 409 };
  const normalizedUsername = normalizeAdminUsername(username); if (!normalizedUsername) return { ok: false, code: 'INVALID_USERNAME', message: 'Use de 4 a 64 caracteres: letras, números, ponto, hífen ou underscore.', status: 400 };
  const validation = validateNewPassword(newPassword, confirmation, normalizedUsername); if (!validation.valid) return { ok: false, ...validation, status: 400 };
  const passwordHash = await hashPassword(newPassword); const credentials = await persistDefinitiveAdmin(store, current, normalizedUsername, passwordHash); return { ok: true, credentials };
}
export async function changeAdminPassword(store, currentPassword, newPassword, confirmation, role = 'administrador', loadOptions) {
  const current = await loadAdminCredentials(store, loadOptions); if (current.bootstrap_required || !current.bootstrap_consumed) return { ok: false, code: 'BOOTSTRAP_REQUIRED', message: 'Conclua o primeiro acesso.', status: 409 };
  if (role !== 'administrador') return { ok: false, code: 'FORBIDDEN', message: 'Seu perfil não permite alterar a senha.', status: 403 };
  if (!(await verifyCredentials(current.username, currentPassword, current))) return { ok: false, code: 'INVALID_CURRENT_PASSWORD', message: 'A senha atual está incorreta.', status: 400 };
  const validation = validateNewPassword(newPassword, confirmation, current.username); if (!validation.valid) return { ok: false, ...validation, status: 400 };
  const passwordHash = await hashPassword(newPassword); const credentials = await persistPasswordChange(store, current, passwordHash); return { ok: true, credentials };
}
