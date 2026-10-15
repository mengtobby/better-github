import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../auth/middleware.js';
import { requirePrincipal } from '../../auth/middleware.js';
import { assertRepoAccess } from '../../auth/permissions.js';
import type { Store } from '../../db/store.js';
import type { RepoStorage } from '../../git/storage.js';
import { isValidName } from '../../git/names.js';
import type { Scm } from '../../scm/scm.js';
import { assertSafeRef, assertSafePath } from '../../scm/validate.js';
import { ok, fail } from '../../shared/envelope.js';
import { parseInput, parseJsonBody } from '../../shared/http.js';
import { resolveRepo } from '../repo-lookup.js';

export interface ScmRouteDeps { readonly store: Store; readonly storage: RepoStorage; readonly scm: Scm }

const ref = z.string().min(1).superRefine(value => { assertSafeRef(value); });
const path = z.string().superRefine(value => { assertSafePath(value); });
const location = z.object({ owner: z.string().refine(isValidName), name: z.string().refine(isValidName) });
const reading = z.object({ ref: ref.optional(), path: path.optional() });
const file = z.object({ ref: ref.optional(), path: path.min(1) });
const history = reading.extend({
  limit: z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(1).max(100)).default(30),
  skip: z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()).default(0),
});
const merge = z.object({ target: ref, source: ref, message: z.string().min(1).max(2000),
  strategy: z.enum(['merge', 'squash', 'ff-only']).optional(),
  expectedTargetSha: z.string().regex(/^[a-fA-F0-9]{40}$/u).optional() });

export function createScmRoutes(deps: ScmRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  function repository(c: Context<AppEnv>, action: 'read' | 'write' = 'read') {
    const params = parseInput(location, c.req.param());
    const resolved = resolveRepo(deps.store, params.owner, params.name);
    assertRepoAccess(c.get('principal'), resolved.repo, action);
    return { ...resolved, disk: deps.storage.pathFor(resolved.owner.handle, resolved.repo.name) };
  }
  app.get('/:owner/:name/refs', async c => {
    const { disk } = repository(c);
    parseInput(z.object({}), c.req.query());
    return c.json(ok(await deps.scm.listRefs(disk)));
  });
  app.get('/:owner/:name/tree', async c => {
    const { disk, repo } = repository(c), q = parseInput(reading, c.req.query());
    return c.json(ok(await deps.scm.readTree(disk, q.ref ?? repo.defaultBranch, q.path)));
  });
  app.get('/:owner/:name/blob', async c => {
    const { disk, repo } = repository(c), q = parseInput(file, c.req.query());
    return c.json(ok(await deps.scm.readBlob(disk, q.ref ?? repo.defaultBranch, q.path)));
  });
  app.get('/:owner/:name/commits', async c => {
    const { disk, repo } = repository(c), q = parseInput(history, c.req.query());
    return c.json(ok(await deps.scm.log(disk, q.ref ?? repo.defaultBranch, { path: q.path, limit: q.limit, skip: q.skip })));
  });
  app.get('/:owner/:name/commits/:sha', async c => {
    const { disk } = repository(c);
    const sha = parseInput(z.string().regex(/^[a-fA-F0-9]{40}$/u), c.req.param('sha'));
    return c.json(ok(await deps.scm.getCommit(disk, sha)));
  });
  app.get('/:owner/:name/compare', async c => {
    const { disk } = repository(c);
    const q = parseInput(z.object({ base: ref, head: ref, threeDot: z.enum(['true', 'false']).optional() }), c.req.query());
    return c.json(ok(await deps.scm.diff(disk, q.base, q.head, { threeDot: q.threeDot === 'true' })));
  });
  app.get('/:owner/:name/blame', async c => {
    const { disk, repo } = repository(c), q = parseInput(file, c.req.query());
    return c.json(ok(await deps.scm.blame(disk, q.ref ?? repo.defaultBranch, q.path)));
  });
  app.get('/:owner/:name/merge-base', async c => {
    const { disk } = repository(c), q = parseInput(z.object({ a: ref, b: ref }), c.req.query());
    return c.json(ok(await deps.scm.mergeBase(disk, q.a, q.b)));
  });
  app.post('/:owner/:name/merges', async c => {
    const { disk, repo } = repository(c, 'write'), principal = requirePrincipal(c);
    const input = await parseJsonBody(c, merge);
    const domain = principal.type === 'agent' ? 'agents' : 'users';
    const result = await deps.scm.merge(disk, { ...input, author: {
      name: principal.handle, email: `${principal.handle}@${domain}.noreply.better-github.invalid`,
    } });
    deps.store.audit.append({ actorType: principal.type, actorId: principal.id, action: 'repo.merge', target: repo.id, metadata: { status: result.status } });
    return result.status === 'conflict'
      ? c.json(fail('CONFLICT', 'Merge conflicts', { conflicts: result.conflicts }), 409)
      : c.json(ok(result));
  });
  return app;
}
