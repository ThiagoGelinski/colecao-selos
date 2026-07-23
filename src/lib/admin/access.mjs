export function accessDecision(pathname, sessionValid, bootstrapRequired = false) {
  const isLogin = pathname === '/admin/login'; const isChangePassword = pathname === '/admin/alterar-senha';
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/'); const isAdminApi = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  const isPublicAuthApi = pathname === '/api/admin/auth/login';
  if ((!isAdminPage && !isAdminApi) || isLogin || isPublicAuthApi) return { action: 'allow' };
  if (!sessionValid) return isAdminApi ? { action: 'json-unauthorized' } : { action: 'redirect-login' };
  const isBootstrapApi = pathname === '/api/admin/auth/change-password' || pathname === '/api/admin/auth/logout' || pathname === '/api/admin/auth/session';
  if (bootstrapRequired && !isChangePassword && !isBootstrapApi) return isAdminApi ? { action: 'json-bootstrap-required' } : { action: 'redirect-change-password' };
  return { action: 'allow' };
}
