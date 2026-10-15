import { getConnInfo } from '@hono/node-server/conninfo';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { fail } from '../shared/envelope.js';

export function createRateLimit(perMinute: number, clock: Clock = systemClock): MiddlewareHandler<AppEnv> {
  if (!Number.isSafeInteger(perMinute) || perMinute < 1) throw new Error('Invalid rate limit');
  const buckets = new Map<string, { tokens: number; at: number }>();
  let prunedAt = clock().getTime();
  return async (c, next): Promise<Response | void> => {
    const now = clock().getTime();
    if (now - prunedAt >= 60_000) {
      for (const [key, bucket] of buckets) if (now - bucket.at >= 60_000) buckets.delete(key);
      prunedAt = now;
    }
    let ip = 'unknown';
    try { ip = getConnInfo(c).remote.address ?? ip; } catch { /* In-process requests have no socket. */ }
    const principal = c.get('principal');
    const key = principal ? `${principal.type}:${principal.id}` : `ip:${ip}`;
    const previous = buckets.get(key) ?? { tokens: perMinute, at: now };
    const tokens = Math.min(perMinute, previous.tokens + Math.max(0, now - previous.at) * perMinute / 60_000);
    buckets.set(key, { tokens: Math.max(0, tokens - (tokens >= 1 ? 1 : 0)), at: now });
    if (tokens < 1) return c.json(fail('RATE_LIMITED', 'Too many requests'), 429,
      { 'Retry-After': String(Math.max(1, Math.ceil((1 - tokens) * 60 / perMinute))) });
    await next();
  };
}
