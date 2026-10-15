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

it('prevents scope and repository escalation through token routes', async () => {
  const f = await fixture();
  try {
    const full = await f.signup(), user = f.store.users.findByHandle('alice')!;
    await f.request('/api/v1/agents', 'POST', { handle: 'bot', displayName: 'Bot' }, full);
    const issue = (scopes: readonly ('tokens:manage' | 'agents:manage' | 'repo:write')[], repoIds?: readonly string[]): string =>
      f.tokens.issueUserToken(user.id, { scopes, repoIds }, null).token;
    expect((await f.request('/api/v1/tokens', 'POST', { scopes: ['repo:admin'] }, issue(['tokens:manage']))).status).toBe(403);
    const restricted = issue(['tokens:manage', 'agents:manage', 'repo:write'], []);
    expect((await f.request('/api/v1/tokens', 'POST', {}, restricted)).status).toBe(403);
    expect((await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'], repoIds: null }, restricted)).status).toBe(403);
    expect((await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'] }, issue(['agents:manage']))).status).toBe(403);
    const response = await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'] }, restricted);
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { token: string } };
    expect(f.tokens.authenticate(body.data.token)?.repoIds).toEqual([]);
  } finally { await f.close(); }
});
