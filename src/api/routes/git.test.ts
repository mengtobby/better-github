import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../../db/database.js';
import type { Db } from '../../db/database.js';
import { createStore } from '../../db/store.js';
import { createRepoStorage } from '../../git/storage.js';
import { authMiddleware } from '../../auth/middleware.js';
import type { AppEnv } from '../../auth/middleware.js';
import { createTokenService } from '../../auth/tokens.js';
import { createErrorHandler } from '../../shared/http.js';
import { createGitRoutes } from './git.js';

const execute = promisify(execFile);
let directory: string;
let db: Db;
let store: ReturnType<typeof createStore>;
let app: Hono<AppEnv>;
let basic: string;
let excluded: string;
let outsider: string;
let server: ReturnType<typeof serve> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'api-git-'));
  db = openDatabase(':memory:'); store = createStore(db);
  const owner = store.users.create({ handle: 'alice', email: 'alice@example.com', passwordHash: 'hash' });
  const other = store.users.create({ handle: 'other', email: 'other@example.com', passwordHash: 'hash' });
  store.repositories.create({ ownerId: owner.id, name: 'demo', visibility: 'public' });
  store.repositories.create({ ownerId: owner.id, name: 'secret', visibility: 'private' });
  const storage = createRepoStorage(join(directory, 'repos'));
  await storage.create('alice', 'demo', { defaultBranch: 'main' });
  await storage.create('alice', 'secret', { defaultBranch: 'main' });
  const tokens = createTokenService(store);
  basic = `Basic ${Buffer.from(`alice:${tokens.issueUserToken(owner.id, { scopes: ['repo:write'] }).token}`).toString('base64')}`;
  outsider = `Bearer ${tokens.issueUserToken(other.id, { scopes: ['repo:write'] }).token}`;
  const agent = store.agents.create({ handle: 'bot', displayName: 'Bot', sponsorUserId: owner.id });
  excluded = `Bearer ${tokens.issueAgentToken(owner.id, agent.id, { scopes: ['repo:write'], repoIds: [] }).token}`;
  app = new Hono<AppEnv>(); app.onError(createErrorHandler()); app.use('*', authMiddleware(tokens));
  app.route('/', createGitRoutes({ store, storage }));
});
afterEach(async () => {
  if (server) { await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; }
  db.close(); await rm(directory, { recursive: true, force: true });
});
const advertise = (name: string, service = 'git-upload-pack'): string => `/alice/${name}.git/info/refs?service=${service}`;

it('serves public reads, challenges anonymous private reads and pushes, and hides repos from outsiders', async () => {
  const response = await app.request(advertise('demo'));
  expect(response.status).toBe(200); await response.arrayBuffer();
  for (const route of [advertise('secret'), advertise('demo', 'git-receive-pack'), '/alice/demo.git/git-receive-pack']) {
    const result = await app.request(route, { method: route.endsWith('/git-receive-pack') ? 'POST' : 'GET' });
    expect(result.status).toBe(401);
    expect(result.headers.get('WWW-Authenticate')).toBe('Basic realm="better-github"');
  }
  for (const Authorization of [outsider, excluded]) {
    expect((await app.request(advertise('secret'), { headers: { Authorization } })).status).toBe(404);
  }
  expect((await app.request(advertise('demo'), { headers: { Authorization: excluded } })).status).toBe(403);
  for (const route of ['/unrelated', advertise('missing'), '/missing/demo.git/info/refs?service=git-upload-pack']) {
    expect((await app.request(route)).status).toBe(404);
  }
});

it('pushes and clones using real git over Basic HTTP, and audits the push', async () => {
  server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>(resolve => { if (server!.listening) resolve(); else server!.once('listening', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const remote = `http://127.0.0.1:${address.port}/alice/demo.git`;
  const local = join(directory, 'local');
  const git = async (args: string[]): Promise<void> => {
    await execute('git', ['-c', 'credential.helper=', '-c', `http.extraHeader=Authorization: ${basic}`,
      '-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', ...args],
    { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  };
  await git(['init', '--initial-branch=main', local]);
  await writeFile(join(local, 'hello.txt'), 'hello\n');
  await git(['-C', local, 'add', '.']);
  await git(['-C', local, 'commit', '-m', 'initial']);
  await git(['-C', local, 'push', remote, 'main']);
  await git(['clone', remote, join(directory, 'clone')]);
  expect(store.audit.list({ limit: 10 })).toContainEqual(expect.objectContaining({ action: 'git.push' }));
}, 30000);
