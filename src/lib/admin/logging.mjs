const ALLOWED_FIELDS = new Set(['operation', 'has_credentials', 'has_state', 'bootstrap_required', 'bootstrap_consumed', 'repair']);
export function logAdminAuth(event, details = {}) {
  const safe = {}; for (const [key, value] of Object.entries(details)) if (ALLOWED_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value === null)) safe[key] = value;
  console.info(JSON.stringify({ scope: 'admin-auth', event, ...safe }));
}
