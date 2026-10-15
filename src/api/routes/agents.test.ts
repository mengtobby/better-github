import { expect, it } from 'vitest';
import { fixture } from '../../../test/helpers.js';
it('restricts agent management and invalidates revoked agent tokens', async () => {
  const f = await fixture();
  try {
    const token = await f.signup();
    expect((await f.request('/api/v1/agents')).status).toBe(401);
    expect((await f.request('/api/v1/agents', 'POST', { handle: 'alice-bot', displayName: 'Bot', model: 'test' }, token)).status).toBe(201);
    expect(await (await f.request('/api/v1/agents', 'GET', undefined, token)).json()).toMatchObject({ data: [{ handle: 'alice-bot' }] });
    expect((await f.request('/api/v1/agents/alice-bot/tokens', 'POST', { scopes: ['repo:read'], repoIds: ['missing'] }, token)).status).toBe(403);
    const issued = await (await f.request('/api/v1/agents/alice-bot/tokens', 'POST', { scopes: ['repo:read'] }, token)).json() as { data: { token: string } };
    expect((await f.request('/api/v1/agents', 'GET', undefined, issued.data.token)).status).toBe(403);
    expect((await f.request('/api/v1/agents/alice-bot', 'DELETE', undefined, token)).status).toBe(200);
    expect((await f.request('/api/v1/user', 'GET', undefined, issued.data.token)).status).toBe(401);
    expect((await f.request('/api/v1/agents/alice-bot', 'DELETE', undefined, token)).status).toBe(404);
  } finally { await f.close(); }
});
