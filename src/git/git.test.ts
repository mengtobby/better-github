import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createErrorHandler } from '../shared/http.js';
import { assertValidName, isValidName } from './names.js';
import { createRepoStorage } from './storage.js';
import { parseGitPath, serveGitHttp } from './smart-http.js';

const execute = promisify(execFile);
const directories: string[] = [];
async function temp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forge-git-'));
  directories.push(directory);
  return directory;
}
async function git(args: string[]): Promise<void> {
  await execute('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Test',
    GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'test@example.com',
    GIT_CONFIG_KEY_2: 'core.autocrlf', GIT_CONFIG_VALUE_2: 'false' } });
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('names and routes', () => {
  it('accepts valid names and rejects unsafe or reserved names', () => {
    for (const name of ['a', 'Ab_1.z-9', 'a'.repeat(100)]) expect(isValidName(name)).toBe(true);
    for (const name of ['', '-a', 'a-', '.a', 'a.', 'a..b', 'a.git', 'A.GIT', '../a', 'a/b', 'a\0b', 'a'.repeat(101)]) {
      expect(isValidName(name)).toBe(false);
      expect(() => assertValidName(name, 'owner')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(() => assertValidName('valid', 'repository')).not.toThrow();
  });
  it('recognizes only smart HTTP routes', () => {
    for (const service of ['git-upload-pack', 'git-receive-pack']) {
      expect(parseGitPath('/Alice/demo.git/info/refs', 'GET', new URLSearchParams({ service })))
        .toEqual({ owner: 'Alice', name: 'demo', service, kind: 'advertise' });
      expect(parseGitPath(`/Alice/demo.git/${service}`, 'POST', new URLSearchParams()))
        .toEqual({ owner: 'Alice', name: 'demo', service, kind: 'rpc' });
    }
    for (const pathname of ['/a/b', '/../demo.git/info/refs', '/a/x..y.git/info/refs', '/a/demo.git/unknown', '/a/%2e%2e.git/info/refs']) {
      expect(parseGitPath(pathname, 'GET', new URLSearchParams({ service: 'git-upload-pack' }))).toBeNull();
    }
    expect(parseGitPath('/a/demo.git/info/refs', 'POST', new URLSearchParams({ service: 'git-upload-pack' }))).toBeNull();
    expect(parseGitPath('/a/demo.git/info/refs', 'GET', new URLSearchParams({ service: 'unknown' }))).toBeNull();
    expect(parseGitPath('/a/demo.git/git-upload-pack', 'GET', new URLSearchParams())).toBeNull();
  });
});

describe('repository storage', () => {
  it('creates, checks and removes normalized repositories', async () => {
    const root = await temp();
    const storage = createRepoStorage(root);
    expect(storage.root).toBe(root);
    expect(await storage.exists('Alice', 'Demo')).toBe(false);
    const repo = await storage.create('Alice', 'Demo');
    expect(repo).toBe(path.join(root, 'alice', 'demo.git'));
    expect(await readFile(path.join(repo, 'HEAD'), 'utf8')).toContain('refs/heads/main');
    expect(await storage.exists('alice', 'demo')).toBe(true);
    await expect(storage.create('alice', 'demo')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(() => storage.pathFor('..', 'demo')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    await expect(storage.exists('alice', '-demo')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(storage.create('alice', 'other', { defaultBranch: '-evil' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await storage.remove('alice', 'demo');
    await storage.remove('alice', 'demo');
    expect(await storage.exists('alice', 'demo')).toBe(false);
  });
  it('cleans up failed initialization', async () => {
    const storage = createRepoStorage(await temp(), { gitBin: 'nonexistent-git-for-test' });
    await expect(storage.create('a', 'b', { defaultBranch: 'develop' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await storage.exists('a', 'b')).toBe(false);
  });
});

describe('git HTTP transport', () => {
  it('clones, pushes a commit, and reads it through a fresh clone', async () => {
    const root = await temp();
    await createRepoStorage(root).create('alice', 'demo');
    const app = new Hono();
    app.onError(createErrorHandler());
    app.all('*', (c) => {
      const url = new URL(c.req.url);
      const route = parseGitPath(url.pathname, c.req.method, url.searchParams);
      if (!route) return c.notFound();
      return serveGitHttp(c.req.raw, { projectRoot: root, relativePath: url.pathname.slice(1),
        remoteUser: 'tester', remoteAddr: '127.0.0.1', env: { GIT_TERMINAL_PROMPT: '0' } });
    });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No TCP address');
      const url = `http://127.0.0.1:${address.port}/alice/demo.git`;
      const first = path.join(root, 'first');
      await git(['clone', url, first]);
      await writeFile(path.join(first, 'hello.txt'), 'Hello forge\n');
      await git(['-C', first, 'add', 'hello.txt']);
      await git(['-C', first, 'commit', '-m', 'First commit']);
      await git(['-C', first, 'push', 'origin', 'main']);
      const second = path.join(root, 'second');
      await git(['clone', url, second]);
      expect(await readFile(path.join(second, 'hello.txt'), 'utf8')).toBe('Hello forge\n');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  it('rejects dangerous paths and bodies beyond the limit', async () => {
    const root = await temp();
    const opts = { projectRoot: root, relativePath: 'a/b.git/git-receive-pack', maxBodyBytes: 2 };
    await expect(serveGitHttp(new Request('http://localhost/', { method: 'POST', body: 'large',
      headers: { 'content-length': '5' } }), opts)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await createRepoStorage(root).create('a', 'b');
    await expect(serveGitHttp(new Request('http://localhost/', { method: 'POST', body: 'large' }), opts))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    for (const relativePath of ['../escape', '/absolute', '-flag', 'a\\b', 'a\0b', 'a/./b']) {
      await expect(serveGitHttp(new Request('http://localhost/'), { ...opts, relativePath }))
        .rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
  it('maps spawn failures to a safe internal error and parses backend statuses', async () => {
    const projectRoot = await temp();
    await expect(serveGitHttp(new Request('http://localhost/'), { projectRoot,
      relativePath: 'a/b.git/info/refs', gitBin: 'nonexistent-git-for-test' }))
      .rejects.toMatchObject({ code: 'INTERNAL', message: 'Git transport failed' });
    await expect(serveGitHttp(new Request('http://localhost/'), { projectRoot,
      relativePath: 'a/b.git/info/refs', gitBin: process.execPath }))
      .rejects.toMatchObject({ code: 'INTERNAL', message: 'Git transport failed' });
    const response = await serveGitHttp(new Request('http://localhost/?service=git-upload-pack'), {
      projectRoot, relativePath: 'a/b.git/info/refs' });
    expect(response.status).toBe(404);
    await response.text();
  });
});
