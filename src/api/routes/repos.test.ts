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

it('hides private repositories on mutation and commits deletion before storage cleanup', async () => {
  const f = await fixture();
  try {
    const token = await f.signup();
    await f.request('/api/v1/repos', 'POST', { name: 'secret' }, token);
    for (const method of ['PATCH', 'DELETE']) {
      const hidden = await f.request('/api/v1/repos/alice/secret', method, {});
      const missing = await f.request('/api/v1/repos/alice/missing', method, {});
      expect(hidden.status).toBe(404); expect(await hidden.text()).toBe(await missing.text());
    }
    let logged = false;
    const app = createApp({ ...f, logger: { error: () => { logged = true; } }, storage: { ...f.storage, remove: async () => {
      expect(f.store.repositories.findByOwnerAndName(f.store.users.findByHandle('alice')!.id, 'secret')).toBeNull();
      throw new Error('cleanup failed');
    } } });
    expect((await app.request('/api/v1/repos/alice/secret', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(logged).toBe(true);
  } finally { await f.close(); }
});

it('preserves storage when the deletion transaction fails', async () => {
  const f = await fixture();
  try {
    const token = await f.signup();
    await f.request('/api/v1/repos', 'POST', { name: 'demo' }, token);
    const app = createApp({ ...f, store: { ...f.store, audit: { ...f.store.audit, append: () => { throw new Error('audit failed'); } } } });
    expect((await app.request('/api/v1/repos/alice/demo', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBe(500);
    expect(f.store.repositories.findByOwnerAndName(f.store.users.findByHandle('alice')!.id, 'demo')).not.toBeNull();
    expect(await f.storage.exists('alice', 'demo')).toBe(true);
  } finally { await f.close(); }
});
