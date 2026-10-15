import { expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { createRateLimit } from './rate-limit.js';
it('limits, refills and prunes buckets without trusting forwarded headers', async () => {
  let now = 0;
  const app = new Hono<AppEnv>(); app.use('*', createRateLimit(2, () => new Date(now))); app.get('/', c => c.text('ok'));
  expect((await app.request('/')).status).toBe(200); expect((await app.request('/')).status).toBe(200);
  const limited = await app.request('/', { headers: { 'X-Forwarded-For': 'another' } });
  expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('30');
  now = 30000; expect((await app.request('/')).status).toBe(200);
  now = 120000; expect((await app.request('/')).status).toBe(200);
  expect(() => createRateLimit(0)).toThrow();
});
