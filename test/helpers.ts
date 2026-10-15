import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { createStore } from '../src/db/store.js';
import { createTokenService } from '../src/auth/tokens.js';
import { createRepoStorage } from '../src/git/storage.js';
import { createScm } from '../src/scm/scm.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/api/app.js';
import type { AppDeps } from '../src/api/app.js';
import type { Hono } from 'hono';
import type { AppEnv } from '../src/auth/middleware.js';

interface Fixture extends AppDeps {
  readonly app: Hono<AppEnv>;
  readonly dir: string;
  readonly request: (url: string, method?: string, body?: unknown, token?: string) => Promise<Response>;
  readonly signup: (handle?: string) => Promise<string>;
  readonly close: () => Promise<void>;
}
export async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-app-'));
  const config = loadConfig({ DATA_DIR: dir }), db = openDatabase(config.dbPath), store = createStore(db);
  const deps = { config, store, tokens: createTokenService(store), storage: createRepoStorage(config.reposDir), scm: createScm(), logger: { error: (): void => {} } };
  const app = createApp(deps);
  async function request(url: string, method = 'GET', body?: unknown, token?: string): Promise<Response> {
    return app.request(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function signup(handle = 'alice'): Promise<string> {
    await request('/api/v1/users', 'POST', { handle, email: `${handle}@example.com`, password: 'a long password!' });
    const response = await request('/api/v1/tokens', 'POST', { handle, password: 'a long password!' });
    const data = await response.json() as { data: { token: string } }; return data.data.token;
  }
  return { ...deps, app, dir, request, signup, close: async (): Promise<void> => { db.close(); await rm(dir, { recursive: true, force: true }); } };
}
