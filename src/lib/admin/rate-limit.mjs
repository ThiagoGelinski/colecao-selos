const buckets = new Map();
export function consumeRateLimit(key, { limit = 10, windowMs = 60_000 } = {}, now = Date.now()) {
  const safeKey = String(key).slice(0, 200);
  const current = buckets.get(safeKey);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs }; buckets.set(safeKey, next);
    return { allowed: true, remaining: limit - 1, resetAt: next.resetAt };
  }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
}
export function clearRateLimits() { buckets.clear(); }
