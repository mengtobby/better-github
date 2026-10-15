import { expect, it } from 'vitest';
import { fixture } from '../../../test/helpers.js';
it('grants tokens, rejects generic bad credentials and revokes owned tokens', async () => {
  const f = await fixture();
  try {
    const token = await f.signup();
    for (const handle of ['alice', 'absent']) expect((await f.request('/api/v1/tokens', 'POST', { handle, password: 'wrong' })).status).toBe(401);
    const response = await f.request('/api/v1/tokens', 'POST', { scopes: ['repo:read'], ttlSeconds: 60 }, token);
    expect(response.status).toBe(201);
    const issued = await response.json() as { data: { id: string; token: string } };
    expect((await f.request('/api/v1/tokens', 'POST', {}, issued.data.token)).status).toBe(403);
    expect((await f.request(`/api/v1/tokens/${issued.data.id}`, 'DELETE', undefined, token)).status).toBe(200);
    expect((await f.request('/api/v1/user', 'GET', undefined, issued.data.token)).status).toBe(401);
    expect((await f.request('/api/v1/tokens/missing', 'DELETE', undefined, token)).status).toBe(404);
  } finally { await f.close(); }
});
