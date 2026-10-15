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
