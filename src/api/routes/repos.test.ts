import { expect, it } from 'vitest';
import { fixture } from '../../../test/helpers.js';
import { createApp } from '../app.js';
it('creates, hides, updates and removes repository storage', async () => {
  const f = await fixture();
  try {
    const token = await f.signup(), bob = await f.signup('bob');
    expect((await f.request('/api/v1/repos', 'POST', { name: 'demo' }, token)).status).toBe(201);
    expect(await f.storage.exists('alice', 'demo')).toBe(true);
    expect((await f.request('/api/v1/repos/alice/demo')).status).toBe(404);
    expect((await f.request('/api/v1/repos/alice/demo', 'GET', undefined, bob)).status).toBe(404);
    expect((await f.request('/api/v1/repos/alice/demo', 'PATCH', { visibility: 'public', description: 'hi' }, token)).status).toBe(200);
    expect((await f.request('/api/v1/repos/alice/demo')).status).toBe(200);
    expect((await f.request('/api/v1/repos/alice/demo', 'DELETE', undefined, token)).status).toBe(200);
    expect(await f.storage.exists('alice', 'demo')).toBe(false);
    const app = createApp({ ...f, storage: { ...f.storage, create: async () => { throw new Error('storage failed'); } } });
    expect((await app.request('/api/v1/repos', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'failed' }) })).status).toBe(500);
    expect(f.store.repositories.findByOwnerAndName(f.store.users.findByHandle('alice')!.id, 'failed')).toBeNull();
  } finally { await f.close(); }
});
