import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../../db/database.js';
import type { Db } from '../../db/database.js';
import { createStore } from '../../db/store.js';
import { createTokenService } from '../../auth/tokens.js';
import { authMiddleware } from '../../auth/middleware.js';
import type { AppEnv } from '../../auth/middleware.js';
import { createRepoStorage } from '../../git/storage.js';
import { createGitRunner } from '../../scm/runner.js';
import { createScm } from '../../scm/scm.js';
import { createErrorHandler } from '../../shared/http.js';
import { createScmRoutes } from './scm.js';
import { resolveRepo } from '../repo-lookup.js';

let db: Db;
let directory: string;
let app: Hono<AppEnv>;
let auth: Record<string, string>;
let excluded: Record<string, string>;
let root: string;
let store: ReturnType<typeof createStore>;
let git: (args: readonly string[], input?: string) => Promise<string>;
beforeEach(async () => {
  db = openDatabase(':memory:'); store = createStore(db);
  directory = await mkdtemp(join(tmpdir(), 'api-scm-'));
  const storage = createRepoStorage(directory);
  const owner = store.users.create({ handle: 'alice', email: 'alice@example.com', passwordHash: 'hash' });
  store.repositories.create({ ownerId: owner.id, name: 'demo', visibility: 'public' });
  store.repositories.create({ ownerId: owner.id, name: 'secret', visibility: 'private' });
  const disk = await storage.create('alice', 'demo', { defaultBranch: 'main' });
  const runner = createGitRunner();
  git = async (args, input) => (await runner.run(args, { cwd: disk, input, env: {
    GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@example.com',
    GIT_COMMITTER_NAME: 'Alice', GIT_COMMITTER_EMAIL: 'alice@example.com',
  } })).stdout.toString().trim();
  const blob = await git(['hash-object', '-w', '--stdin'], 'hello\n');
  const tree = await git(['mktree'], `100644 blob ${blob}\ta.txt\n`);
  root = await git(['commit-tree', tree], 'initial');
  await git(['update-ref', 'refs/heads/main', root]);
  const tokens = createTokenService(store);
  auth = { Authorization: `Bearer ${tokens.issueUserToken(owner.id, { scopes: ['repo:write'] }).token}` };
  const agent = store.agents.create({ handle: 'bot', displayName: 'Bot', sponsorUserId: owner.id });
  excluded = { Authorization: `Bearer ${tokens.issueAgentToken(owner.id, agent.id, { scopes: ['repo:write'], repoIds: [] }).token}` };
  app = new Hono<AppEnv>(); app.onError(createErrorHandler()); app.use('*', authMiddleware(tokens));
  app.route('/api/v1/repos', createScmRoutes({ store, storage, scm: createScm(runner) }));
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
const url = (suffix: string): string => `/api/v1/repos/alice/demo/${suffix}`;

it('reads every SCM endpoint from a real bare repository', async () => {
  for (const suffix of ['refs', 'tree', 'tree?ref=main&path=', 'blob?path=a.txt', 'commits',
    'commits?ref=main&path=a.txt&limit=1&skip=0', `commits/${root}`, 'compare?base=main&head=main&threeDot=true',
    'compare?base=main&head=main&threeDot=false', 'blame?path=a.txt', 'merge-base?a=main&b=main']) {
    const response = await app.request(url(suffix));
    expect(response.status, suffix).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  }
});

it('hides private repositories and applies agent allow lists on every route', async () => {
  for (const suffix of ['refs', 'tree', 'blob?path=a.txt', 'commits', `commits/${root}`,
    'compare?base=main&head=main', 'blame?path=a.txt', 'merge-base?a=main&b=main', 'merges']) {
    const method = suffix === 'merges' ? 'POST' : 'GET';
    expect((await app.request(url(suffix).replace('/demo/', '/secret/'), { method })).status).toBe(404);
    expect((await app.request(url(suffix), { method, headers: excluded })).status).toBe(403);
  }
  expect(() => resolveRepo(store, 'missing', 'demo')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  expect(() => resolveRepo(store, 'alice', 'missing')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});

it('rejects malformed queries and bodies with VALIDATION', async () => {
  for (const suffix of ['tree?ref=-bad', 'tree?path=../bad', 'blob', 'blame', 'commits?limit=101',
    'commits?skip=-1', 'commits/nope', 'compare?base=main&head=main&threeDot=1', 'merge-base?a=main']) {
    const response = await app.request(url(suffix));
    expect(response.status, suffix).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  }
  for (const body of ['{', '{}', JSON.stringify({ target: '-bad', source: 'main', message: 'm' })]) {
    expect((await app.request(url('merges'), { method: 'POST', headers: auth, body })).status).toBe(400);
  }
});

it('merges and audits, reports up-to-date and leaves conflicted branches unchanged', async () => {
  const commit = async (text: string, parent: string): Promise<string> => {
    const blob = await git(['hash-object', '-w', '--stdin'], text);
    const tree = await git(['mktree'], `100644 blob ${blob}\ta.txt\n`);
    return git(['commit-tree', tree, '-p', parent], 'change');
  };
  const source = await commit('source\n', root);
  await git(['update-ref', 'refs/heads/source', source]);
  const post = (target: string, source: string) => app.request(url('merges'), {
    method: 'POST', headers: auth, body: JSON.stringify({ target, source, message: 'Merge' }),
  });
  const mergedResponse = await post('main', 'source');
  const mergedSha = await git(['rev-parse', 'main']);
  expect(mergedResponse.status).toBe(200);
  expect(await mergedResponse.json()).toMatchObject({ data: { status: 'merged', sha: mergedSha } });
  expect(await git(['show', '-s', '--format=%ae', mergedSha])).toBe('alice@users.noreply.better-github.invalid');
  expect(await (await post('main', 'source')).json()).toMatchObject({ data: { status: 'up-to-date' } });
  const other = await commit('other\n', root);
  await git(['update-ref', 'refs/heads/other', other]);
  const response = await post('main', 'other');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT', details: { conflicts: ['a.txt'] } } });
  expect(await git(['rev-parse', 'main'])).toBe(mergedSha);
  expect(store.audit.list({ limit: 10 }).filter(event => event.action === 'repo.merge')).toHaveLength(3);
});
