import { fixedClock } from '../shared/clock.js';
import { expect, it } from 'vitest';
import { fixture } from '../../test/helpers.js';
import { createApp } from './app.js';
it('serves health, envelopes errors and enforces stricter authentication limits', async () => {
  const f = await fixture();
  try {
    expect(await (await f.request('/healthz')).json()).toMatchObject({ data: { status: 'ok' } });
    expect((await f.request('/absent')).status).toBe(404);
    const app = createApp({ ...f, config: { ...f.config, authRateLimitPerMinute: 1 } });
    expect((await app.request('/api/v1/users', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await app.request('/api/v1/tokens', { method: 'POST', body: '{}' })).status).toBe(429);
  } finally { await f.close(); }
});

it('isolates failed authentication from valid principal and anonymous budgets', async () => {
  const f = await fixture();
  try {
    const token = await f.signup(), other = await f.signup('bob');
    const app = createApp({ ...f, clock: fixedClock('2026-01-01T00:00:00Z'),
      config: { ...f.config, rateLimitPerMinute: 3, authRateLimitPerMinute: 2 } });
    for (let i = 0; i < 2; i++) expect((await app.request('/api/v1/user', { headers: { Authorization: 'Bearer bad' } })).status).toBe(401);
    const response = await app.request('/api/v1/user', { headers: { Authorization: 'Bearer bad' } });
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('30');
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/api/v1/user', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
      expect((await app.request('/healthz')).status).toBe(200);
    }
    expect((await app.request('/api/v1/user', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(429);
    expect((await app.request('/healthz')).status).toBe(429);
    expect((await app.request('/api/v1/user', { headers: { Authorization: `Bearer ${other}` } })).status).toBe(200);
  } finally { await f.close(); }
});
