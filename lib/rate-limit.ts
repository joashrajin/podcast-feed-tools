const WINDOW_MS = 60_000;
const LIMIT = 20;
const MAX_KEYS = 5_000;

const buckets = new Map<string, { tokens: number; resetAt: number }>();

/**
 * Best-effort limit for one process. A restart, or more than one instance, starts fresh.
 * The window is one minute unless the caller passes its own, so a report can be
 * limited per hour without changing the other routes.
 */
export function rateLimit(key: string, limit = LIMIT, windowMs = WINDOW_MS): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= MAX_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
    buckets.set(key, { tokens: limit - 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.tokens <= 0) return false;
  existing.tokens -= 1;
  return true;
}

export function retryAfterSeconds(key: string): number {
  const existing = buckets.get(key);
  if (!existing) return 1;
  return Math.max(1, Math.ceil((existing.resetAt - Date.now()) / 1000));
}
