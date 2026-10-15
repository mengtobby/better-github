import { expect, it } from 'vitest';
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
