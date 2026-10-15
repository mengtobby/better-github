import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../auth/middleware.js';
import { requirePrincipal } from '../../auth/middleware.js';
import { assertRepoAccess } from '../../auth/permissions.js';
import type { Store } from '../../db/store.js';
import type { RepoStorage } from '../../git/storage.js';
import { assertValidName } from '../../git/names.js';
import { assertSafeRef } from '../../scm/validate.js';
import { forbidden, isAppError, notFound } from '../../shared/errors.js';
import { ok } from '../../shared/envelope.js';
import type { ErrorLogger } from '../../shared/http.js';
import { defaultLogger, parseInput, parseJsonBody } from '../../shared/http.js';
import { resolveRepo } from '../repo-lookup.js';

const patch = z.object({ description: z.string().max(10000).optional(), visibility: z.enum(['public', 'private']).optional(), defaultBranch: z.string().min(1).superRefine(value => { assertSafeRef(value); }).optional() });
export function createRepoRoutes(deps: { readonly store: Store; readonly storage: RepoStorage; readonly publicUrl: string; readonly logger?: ErrorLogger }): Hono<AppEnv> {
  const app = new Hono<AppEnv>(), { store, storage } = deps;
  const logger = deps.logger ?? defaultLogger;
  app.use('/:owner/:name', async (c, next) => {
    const params = parseInput(z.object({ owner: z.string(), name: z.string() }), c.req.param());
    assertValidName(params.owner, 'owner'); assertValidName(params.name, 'repository');
    await next();
  });
  app.post('/', async c => {
    const p = requirePrincipal(c);
    if (!p.scopes.includes('repo:admin') || p.repoIds !== null) throw forbidden();
    const input = await parseJsonBody(c, patch.extend({ name: z.string() })); assertValidName(input.name, 'repository');
    const owner = store.users.findById(p.userId); if (!owner) throw notFound('User');
    const repo = store.repositories.create({ ...input, ownerId: owner.id });
    try {
      try { await storage.create(owner.handle, repo.name, { defaultBranch: repo.defaultBranch }); }
      catch (error) {
        if (!isAppError(error) || error.code !== 'CONFLICT'
          || store.repositories.findByOwnerAndName(owner.id, repo.name)?.id !== repo.id) throw error;
        await storage.remove(owner.handle, repo.name);
        logger.error('Reclaimed orphaned repository storage', { repoId: repo.id });
        await storage.create(owner.handle, repo.name, { defaultBranch: repo.defaultBranch });
      }
    }
    catch (error) { store.repositories.delete(repo.id); throw error; }
    store.audit.append({ actorType: p.type, actorId: p.id, action: 'repo.create', target: repo.id });
    return c.json(ok({ ...repo, cloneUrl: `${deps.publicUrl}/${owner.handle}/${repo.name}.git` }), 201);
  });
  app.get('/:owner/:name', c => {
    const params = parseInput(z.object({ owner: z.string(), name: z.string() }), c.req.param());
    assertValidName(params.owner, 'owner'); assertValidName(params.name, 'repository');
    const { owner, repo } = resolveRepo(store, params.owner, params.name); assertRepoAccess(c.get('principal'), repo, 'read');
    return c.json(ok({ ...repo, cloneUrl: `${deps.publicUrl}/${owner.handle}/${repo.name}.git` }));
  });
  app.patch('/:owner/:name', async c => {
    const { owner, repo } = resolveRepo(store, c.req.param('owner'), c.req.param('name'));
    assertRepoAccess(c.get('principal'), repo, 'admin');
    const p = requirePrincipal(c);
    const input = await parseJsonBody(c, patch);
    const updated = store.transaction(() => {
      const updated = store.repositories.update(repo.id, input);
      store.audit.append({ actorType: p.type, actorId: p.id, action: 'repo.update', target: repo.id }); return updated;
    });
    return c.json(ok({ ...updated, cloneUrl: `${deps.publicUrl}/${owner.handle}/${repo.name}.git` }));
  });
  app.delete('/:owner/:name', async c => {
    const { owner, repo } = resolveRepo(store, c.req.param('owner'), c.req.param('name'));
    assertRepoAccess(c.get('principal'), repo, 'admin');
    const p = requirePrincipal(c);
    store.transaction(() => { store.repositories.delete(repo.id); store.audit.append({ actorType: p.type, actorId: p.id, action: 'repo.delete', target: repo.id }); });
    try { await storage.remove(owner.handle, repo.name); }
    catch {
      logger.error('Repository storage removal failed', { repoId: repo.id });
    }
    return c.json(ok({ deleted: true }));
  });
  return app;
}
