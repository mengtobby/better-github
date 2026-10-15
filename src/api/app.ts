import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { authMiddleware } from '../auth/middleware.js';
import type { TokenService } from '../auth/tokens.js';
import type { Config } from '../config.js';
import type { Store } from '../db/store.js';
import type { RepoStorage } from '../git/storage.js';
import type { Scm } from '../scm/scm.js';
import type { Clock } from '../shared/clock.js';
import type { ErrorLogger } from '../shared/http.js';
import { createErrorHandler } from '../shared/http.js';
import { isAppError } from '../shared/errors.js';
import { ok, fail } from '../shared/envelope.js';
import { createRateLimit } from './rate-limit.js';
import { createUserRoutes } from './routes/users.js';
import { createTokenRoutes } from './routes/tokens.js';
import { createAgentRoutes } from './routes/agents.js';
import { createRepoRoutes } from './routes/repos.js';
import { createScmRoutes } from './routes/scm.js';
import { createGitRoutes } from './routes/git.js';

export interface AppDeps {
  readonly config: Config; readonly store: Store; readonly storage: RepoStorage;
  readonly scm: Scm; readonly tokens: TokenService; readonly clock?: Clock; readonly logger?: ErrorLogger;
}
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(createErrorHandler(deps.logger));
  app.notFound(c => c.json(fail('NOT_FOUND', 'Not found'), 404));
  const authenticate = authMiddleware(deps.tokens);
  const invalidCredentials = createRateLimit(deps.config.authRateLimitPerMinute, deps.clock);
  app.use('*', async (c, next) => {
    // Run authentication alone so route-level 401s never consume this budget.
    try { await authenticate(c, async () => {}); }
    catch (error) {
      if (c.req.header('Authorization') !== undefined && isAppError(error) && error.code === 'UNAUTHORIZED') {
        return invalidCredentials(c, async () => { throw error; });
      }
      throw error;
    }
    await next();
  });
  app.use('*', createRateLimit(deps.config.rateLimitPerMinute, deps.clock));
  const strict = createRateLimit(deps.config.authRateLimitPerMinute, deps.clock);
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST' && ['/api/v1/users', '/api/v1/tokens'].includes(c.req.path)) return strict(c, next);
    await next();
  });
  app.get('/healthz', c => c.json(ok({ status: 'ok' })));
  const common = { ...deps, publicUrl: deps.config.publicUrl };
  app.route('/api/v1', createUserRoutes(common));
  app.route('/api/v1', createTokenRoutes(common));
  app.route('/api/v1', createAgentRoutes(common));
  app.route('/api/v1/repos', createRepoRoutes(common));
  app.route('/api/v1/repos', createScmRoutes(deps));
  app.route('/', createGitRoutes({ ...deps, gitBin: deps.config.gitBin }));
  return app;
}
