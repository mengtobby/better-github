import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { AppEnv } from '../../auth/middleware.js';
import { assertRepoAccess } from '../../auth/permissions.js';
import type { Store } from '../../db/store.js';
import type { RepoStorage } from '../../git/storage.js';
import { parseGitPath, serveGitHttp } from '../../git/smart-http.js';
import { AppError } from '../../shared/errors.js';
import { resolveRepo } from '../repo-lookup.js';

export interface GitRouteDeps { readonly store: Store; readonly storage: RepoStorage; readonly gitBin?: string }

function remoteAddress(c: Context<AppEnv>): string | undefined {
  // In-process Hono requests have no socket; never trust forwarded headers.
  try { return getConnInfo(c).remote.address; } catch { return undefined; }
}

export function createGitRoutes(deps: GitRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.all('*', async c => {
    const url = new URL(c.req.url);
    const route = parseGitPath(url.pathname, c.req.method, url.searchParams);
    if (!route) return c.notFound();
    const principal = c.get('principal');
    const action = route.service === 'git-receive-pack' ? 'write' : 'read';
    const candidateOwner = deps.store.users.findByHandle(route.owner);
    const candidate = candidateOwner && deps.store.repositories.findByOwnerAndName(candidateOwner.id, route.name);
    if (!principal && (action === 'write' || !candidate || candidate.visibility !== 'public')) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', undefined, { headers: {
        'WWW-Authenticate': 'Basic realm="better-github"',
      } });
    }
    const { owner, repo } = resolveRepo(deps.store, route.owner, route.name);
    assertRepoAccess(principal, repo, action);
    const rest = route.kind === 'advertise' ? 'info/refs' : route.service;
    const response = await serveGitHttp(c.req.raw, {
      projectRoot: deps.storage.root,
      relativePath: `${owner.handle.toLowerCase()}/${repo.name.toLowerCase()}.git/${rest}`,
      remoteUser: principal?.handle,
      remoteAddr: remoteAddress(c),
      gitBin: deps.gitBin,
      onComplete: outcome => {
        if (route.kind === 'rpc' && action === 'write' && principal
          && outcome.exitCode === 0 && !outcome.aborted && !outcome.timedOut) {
          deps.store.audit.append({ actorType: principal.type, actorId: principal.id, action: 'git.push', target: repo.id });
        }
      },
    });
    return response;
  });
  return app;
}
