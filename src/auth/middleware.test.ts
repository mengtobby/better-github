import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import type { Db } from '../db/database.js';
import { createStore } from '../db/store.js';
import { fixedClock } from '../shared/clock.js';
import { createErrorHandler } from '../shared/http.js';
import { ok } from '../shared/envelope.js';
import { authMiddleware, requirePrincipal } from './middleware.js';
import type { AppEnv } from './middleware.js';
import { createTokenService } from './tokens.js';

let db: Db;
let app: Hono<AppEnv>;
let raw: string;
beforeEach(() => {
  db = openDatabase(':memory:');
  const clock = fixedClock('2026-01-01T00:00:00Z');
  const store = createStore(db, clock);
  const user = store.users.create({ handle: 'alice', email: 'alice', passwordHash: 'hash' });
  const tokens = createTokenService(store, clock);
  raw = tokens.issueUserToken(user.id, { scopes: [] }).token;
  app = new Hono<AppEnv>();
  app.onError(createErrorHandler());
  app.use('*', authMiddleware(tokens));
  app.get('/', (c) => c.json(ok(c.get('principal'))));
  app.get('/required', (c) => c.json(ok(requirePrincipal(c))));
});
afterEach(() => db.close());

describe('authentication middleware', () => {
  it('sets anonymous principal and requires authentication when requested', async () => {
    expect(await (await app.request('/')).json()).toMatchObject({ data: null });
    expect((await app.request('/required')).status).toBe(401);
  });
  it('accepts Bearer and Basic with arbitrary usernames', async () => {
    for (const header of [`Bearer ${raw}`, `bearer ${raw}`, `Basic ${Buffer.from(`ignored:${raw}`).toString('base64')}`,
      `Basic ${Buffer.from(`:${raw}`).toString('base64')}`]) {
      const response = await app.request('/required', { headers: { Authorization: header } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { handle: 'alice', type: 'user' } });
    }
  });
  it('rejects present invalid credentials without anonymous fallback', async () => {
    for (const header of ['', 'Bearer', 'Bearer bad', 'Digest abc', 'Basic !!!',
      `Basic ${Buffer.from('no-colon').toString('base64')}`, `Basic ${Buffer.from('user:bad').toString('base64')}`]) {
      const response = await app.request('/', { headers: { Authorization: header } });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }
  });
});
