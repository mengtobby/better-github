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
    expect((await f.request('/api/v1/tokens', 'POST', {}, restricted)).status).toBe(201);
    expect((await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'], repoIds: null }, restricted)).status).toBe(403);
    expect((await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'] }, issue(['agents:manage']))).status).toBe(403);
    const response = await f.request('/api/v1/agents/bot/tokens', 'POST', { scopes: ['repo:write'] }, restricted);
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { token: string } };
    expect(f.tokens.authenticate(body.data.token)?.repoIds).toEqual([]);
  } finally { await f.close(); }
});

it('defaults token restrictions, permits narrowing and rejects foreign repositories', async () => {
  const f = await fixture();
  try {
    const full = await f.signup();
    await f.signup('bob');
    const owner = f.store.users.findByHandle('alice')!, bob = f.store.users.findByHandle('bob')!;
    const repos = ['one', 'two'].map(name => f.store.repositories.create({ ownerId: owner.id, name }));
    const foreign = f.store.repositories.create({ ownerId: bob.id, name: 'foreign' });
    const parent = f.tokens.issueUserToken(owner.id, { scopes: ['tokens:manage', 'repo:read'], repoIds: repos.map(repo => repo.id) }, null);
    for (const repoIds of [undefined, [repos[0]!.id]]) {
      const response = await f.request('/api/v1/tokens', 'POST', { scopes: ['repo:read'], repoIds }, parent.token);
      expect(response.status).toBe(201);
      const body = await response.json() as { data: { token: string } };
      expect(f.tokens.authenticate(body.data.token)?.repoIds).toEqual(repoIds ?? repos.map(repo => repo.id));
    }
    for (const token of [full, parent.token]) {
      expect((await f.request('/api/v1/tokens', 'POST', { scopes: ['repo:read'], repoIds: [foreign.id] }, token)).status).toBe(403);
    }
    expect((await f.request('/api/v1/tokens', 'POST', { handle: 'alice', password: 'a long password!', repoIds: [foreign.id] })).status).toBe(403);
  } finally { await f.close(); }
});

it('allows read-only user and agent tokens to revoke themselves only', async () => {
  const f = await fixture();
  try {
    const full = await f.signup(), owner = f.store.users.findByHandle('alice')!;
    const user = f.tokens.issueUserToken(owner.id, { scopes: ['repo:read'] }, null);
    const agent = f.store.agents.create({ sponsorUserId: owner.id, handle: 'bot', displayName: 'Bot' });
    const agentToken = f.tokens.issueAgentToken(owner.id, agent.id, { scopes: ['repo:read'] }, f.tokens.authenticate(full)!);
    for (const issued of [user, agentToken]) {
      expect((await f.request(`/api/v1/tokens/${f.tokens.authenticate(full)!.tokenId}`, 'DELETE', undefined, issued.token)).status).toBe(403);
      expect((await f.request(`/api/v1/tokens/${issued.record.id}`, 'DELETE', undefined, issued.token)).status).toBe(200);
      expect(f.tokens.authenticate(issued.token)).toBeNull();
    }
  } finally { await f.close(); }
});
