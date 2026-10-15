import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../auth/middleware.js';
import { requirePrincipal } from '../../auth/middleware.js';
import { hashPassword } from '../../auth/passwords.js';
import type { Store } from '../../db/store.js';
import { assertValidName } from '../../git/names.js';
import { notFound } from '../../shared/errors.js';
import { ok } from '../../shared/envelope.js';
import { parseInput, parseJsonBody } from '../../shared/http.js';

export function createUserRoutes(deps: { readonly store: Store; readonly publicUrl: string }): Hono<AppEnv> {
  const app = new Hono<AppEnv>(), { store } = deps;
  app.post('/users', async c => {
    const input = await parseJsonBody(c, z.object({ handle: z.string(), email: z.email().max(320), password: z.string().min(12).max(200) }));
    assertValidName(input.handle, 'owner');
    const passwordHash = await hashPassword(input.password);
    const user = store.transaction(() => {
      const user = store.users.create({ handle: input.handle, email: input.email, passwordHash });
      store.audit.append({ actorType: 'user', actorId: user.id, action: 'user.create', target: user.id });
      return user;
    });
    return c.json(ok({ id: user.id, handle: user.handle, createdAt: user.createdAt }), 201);
  });
  app.get('/user', c => {
    const p = requirePrincipal(c);
    const identity = p.type === 'user' ? store.users.findById(p.id) : store.agents.findById(p.id);
    if (!identity) throw notFound('Principal');
    return c.json(ok({ id: identity.id, handle: identity.handle, createdAt: identity.createdAt }));
  });
  app.get('/users/:handle/repos', c => {
    const handle = parseInput(z.string(), c.req.param('handle')); assertValidName(handle, 'owner');
    const owner = store.users.findByHandle(handle); if (!owner) throw notFound('User');
    const q = parseInput(z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }), c.req.query());
    const p = c.get('principal');
    const includePrivate = p !== null && p.userId === owner.id
      && p.scopes.some(scope => ['repo:read', 'repo:write', 'repo:admin'].includes(scope));
    const offset = (q.page - 1) * q.limit;
    const page = p?.repoIds !== null && p?.repoIds !== undefined
      ? (() => {
        const allowed = new Set(p.repoIds);
        const visible = store.repositories.listByOwner(owner.id, { limit: Number.MAX_SAFE_INTEGER, offset: 0, includePrivate })
          .items.filter(repo => allowed.has(repo.id));
        return { items: visible.slice(offset, offset + q.limit), total: visible.length };
      })()
      : store.repositories.listByOwner(owner.id, { limit: q.limit, offset, includePrivate });
    const items = page.items.map(repo => ({ ...repo, cloneUrl: `${deps.publicUrl}/${owner.handle}/${repo.name}.git` }));
    return c.json(ok(items, { total: page.total, ...q }));
  });
  return app;
}
