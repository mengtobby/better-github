import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { fixture } from './helpers.js';

const execute = promisify(execFile);
it('an agent pushes, reads, compares and merges a private repository over HTTP', async () => {
  const f = await fixture();
  const server = serve({ fetch: f.app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const base = `http://127.0.0.1:${address.port}`;
    async function api(route: string, method = 'GET', body?: unknown, token?: string): Promise<Response> {
      return fetch(`${base}/api/v1${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    }
    async function signup(handle: string): Promise<string> {
      expect((await api('/users', 'POST', { handle, email: `${handle}@example.com`, password: 'a long password!' })).status).toBe(201);
      const result = await (await api('/tokens', 'POST', { handle, password: 'a long password!' })).json() as { data: { token: string } }; return result.data.token;
    }
    const alice = await signup('alice'), bob = await signup('bob');
    const repo = await (await api('/repos', 'POST', { name: 'demo' }, alice)).json() as { data: { id: string } };
    expect((await api('/agents', 'POST', { handle: 'alice-bot', displayName: 'Alice bot' }, alice)).status).toBe(201);
    const issued = await (await api('/agents/alice-bot/tokens', 'POST', { scopes: ['repo:read', 'repo:write'], repoIds: [repo.data.id] }, alice)).json() as { data: { token: string } };
    const agent = issued.data.token;
    const header = `Authorization: Basic ${Buffer.from(`alice-bot:${agent}`).toString('base64')}`;
    const cwd = path.join(f.dir, 'clone');
    const git = async (args: readonly string[], working = cwd): Promise<void> => {
      await execute('git', ['-c', `http.extraHeader=${header}`, ...args], { cwd: working, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
    };
    await git(['clone', `${base}/alice/demo.git`, cwd], f.dir);
    await git(['config', 'user.name', 'alice-bot']);
    await git(['config', 'user.email', 'alice-bot@users.noreply.better-github.invalid']);
    await writeFile(path.join(cwd, 'README.md'), 'initial\n');
    await git(['add', '.']); await git(['commit', '-m', 'Initial']); await git(['push', 'origin', 'HEAD:main']);
    // Create the feature ref directly; no checkout/branch commands are needed.
    await writeFile(path.join(cwd, 'feature.txt'), 'feature\n');
    await git(['add', '.']); await git(['commit', '-m', 'Feature']); await git(['push', 'origin', 'HEAD:feature']);
    expect(await (await api('/repos/alice/demo/tree?ref=feature', 'GET', undefined, agent)).json()).toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ name: 'feature.txt' })]) });
    expect(await (await api('/repos/alice/demo/compare?base=main&head=feature', 'GET', undefined, agent)).json()).toMatchObject({ data: { files: expect.arrayContaining([expect.objectContaining({ newPath: 'feature.txt' })]) } });
    const merged = await api('/repos/alice/demo/merges', 'POST', { target: 'main', source: 'feature', message: 'Merge feature' }, agent);
    expect(merged.status).toBe(200);
    const commits = await (await api('/repos/alice/demo/commits?ref=main', 'GET', undefined, agent)).json() as { data: readonly { message: string }[] };
    expect(commits.data.some(commit => commit.message === 'Feature')).toBe(true);
    expect((await api('/repos/alice/demo')).status).toBe(404);
    expect((await api('/repos/alice/demo', 'GET', undefined, bob)).status).toBe(404);
    expect((await api('/agents/alice-bot', 'DELETE', undefined, alice)).status).toBe(200);
    expect((await api('/repos/alice/demo/tree', 'GET', undefined, agent)).status).toBe(401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
    await f.close();
  }
}, 60000);
