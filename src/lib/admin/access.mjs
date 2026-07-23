export function accessDecision(pathname, sessionValid) {
  const isLogin = pathname === '/admin/login';
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminApi = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  const isPublicAuthApi = pathname === '/api/admin/auth/login';
  if ((!isAdminPage && !isAdminApi) || isLogin || isPublicAuthApi) return { action: 'allow' };
  if (sessionValid) return { action: 'allow' };
  return isAdminApi ? { action: 'json-unauthorized' } : { action: 'redirect-login' };
}
