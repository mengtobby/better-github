import { createApp } from '../app.js';
import { expect, it, vi } from 'vitest';
import { fixture } from '../../../test/helpers.js';
it('creates safe user views, validates signup and paginates visible repositories', async () => {
  const f = await fixture();
  try {
    const token = await f.signup();
    const view = await (await f.request('/api/v1/user', 'GET', undefined, token)).text();
    expect(view).toContain('alice'); expect(view).not.toContain('passwordHash'); expect(view).not.toContain('email');
    expect((await f.request('/api/v1/user')).status).toBe(401);
    expect((await f.request('/api/v1/users', 'POST', { handle: '../bad' })).status).toBe(400);
    await f.request('/api/v1/repos', 'POST', { name: 'private' }, token);
    expect(await (await f.request('/api/v1/users/alice/repos')).json()).toMatchObject({ data: [], meta: { total: 0 } });
    expect(await (await f.request('/api/v1/users/alice/repos?page=1&limit=1', 'GET', undefined, token)).json()).toMatchObject({ meta: { total: 1, limit: 1 } });
    expect((await f.request('/api/v1/users/missing/repos')).status).toBe(404);
    expect((await f.request('/api/v1/users/alice/repos?page=0')).status).toBe(400);
  } finally { await f.close(); }
});

it('uses SQL pagination for unrestricted callers and filters restricted tokens', async () => {
  const f = await fixture();
  try {
    const token = await f.signup(), owner = f.store.users.findByHandle('alice')!;
    const first = f.store.repositories.create({ ownerId: owner.id, name: 'first', visibility: 'public' });
    f.store.repositories.create({ ownerId: owner.id, name: 'secret' });
    const list = vi.fn(f.store.repositories.listByOwner);
    const app = createApp({ ...f, store: { ...f.store, repositories: { ...f.store.repositories, listByOwner: list } } });
    {
      await app.request('/api/v1/users/alice/repos?page=2&limit=1');
      expect(list).toHaveBeenLastCalledWith(owner.id, { offset: 1, limit: 1, includePrivate: false });
      await app.request('/api/v1/users/alice/repos?page=2&limit=1', { headers: { Authorization: `Bearer ${token}` } });
      expect(list).toHaveBeenLastCalledWith(owner.id, { offset: 1, limit: 1, includePrivate: true });
      const restricted = f.tokens.issueUserToken(owner.id, { scopes: ['repo:read'], repoIds: [first.id] }, null).token;
      expect(await (await f.request('/api/v1/users/alice/repos', 'GET', undefined, restricted)).json()).toMatchObject({ data: [{ id: first.id }], meta: { total: 1 } });
    }
  } finally { await f.close(); }
});
