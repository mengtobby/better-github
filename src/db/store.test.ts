import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate, type Db } from './database.js';
import { createStore, type Store } from './store.js';
import { fixedClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { ALL_SCOPES } from './types.js';

let db: Db;
let store: Store;
const clock = fixedClock('2026-01-01T00:00:00Z');
beforeEach(() => { db = openDatabase(':memory:'); store = createStore(db, clock); });
afterEach(() => { db.close(); });
const user = () => store.users.create({ handle: 'Alice', email: 'Alice@example.com', passwordHash: 'hash' });

describe('database and store', () => {
  it('migrates idempotently and configures SQLite', () => {
    migrate(db); migrate(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(2);
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(createStore(db).users.create({ handle: 'real', email: 'real', passwordHash: 'hash' }).createdAt).toMatch(/^\d{4}-/);
  });
  it('persists file databases using WAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-db-'));
    let fileDb: Db | undefined;
    try {
      const path = join(dir, 'test.sqlite');
      fileDb = openDatabase(path);
      expect(fileDb.pragma('journal_mode', { simple: true })).toBe('wal');
      createStore(fileDb, clock).users.create({ handle: 'saved', email: 'saved', passwordHash: 'hash' });
      fileDb.close(); fileDb = openDatabase(path);
      expect(createStore(fileDb).users.findByHandle('saved')).not.toBeNull();
    } finally { if (fileDb?.open) fileDb.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('rolls back every write on failure, including nested transactions', () => {
    expect(() => store.transaction(() => {
      const owner = user();
      store.transaction(() => store.repositories.create({ ownerId: owner.id, name: 'repo' }));
      throw new Error('abort');
    })).toThrow('abort');
    expect(store.users.findByHandle('Alice')).toBeNull();
    expect(store.transaction(() => user()).handle).toBe('Alice');
  });
});

describe('users repository', () => {
  it('creates frozen users and performs case-insensitive lookups', () => {
    const value = user();
    expect(value).toMatchObject({ id: expect.stringMatching(/^usr_/), passwordHash: 'hash', createdAt: clock().toISOString() });
    expect(Object.isFrozen(value)).toBe(true);
    expect(store.users.findById(value.id)).toEqual(value);
    expect(store.users.findByHandle('ALICE')).toEqual(value);
    expect(store.users.findByEmail('ALICE@EXAMPLE.COM')).toEqual(value);
    expect(store.users.findByEmail('missing')).toBeNull();
    expect(store.users.findById('missing')).toBeNull();
  });
  it('reports unique fields without SQL details', () => {
    user();
    for (const [handle, email, field] of [['alice', 'other', 'handle'], ['other', 'alice@example.com', 'email']]) {
      try {
        store.users.create({ handle: handle!, email: email!, passwordHash: 'hash' });
        expect.fail('expected conflict');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'CONFLICT', message: `${field} already exists` });
      }
    }
  });
});

describe('agents repository', () => {
  it('creates, lists and revokes agents using the clock', () => {
    const owner = user();
    const a = store.agents.create({ handle: 'bot', sponsorUserId: owner.id, displayName: 'Bot' });
    const b = store.agents.create({ handle: 'bot2', sponsorUserId: owner.id, displayName: 'Bot 2', model: 'model' });
    expect(a).toMatchObject({ id: expect.stringMatching(/^agt_/), model: null, revokedAt: null });
    expect(Object.isFrozen(a)).toBe(true);
    expect(store.agents.findByHandle('BOT')).toEqual(a);
    expect(store.agents.listBySponsor(owner.id)).toEqual([a, b]);
    expect(store.agents.listBySponsor('missing')).toEqual([]);
    clock.advance(1000);
    const revoked = store.agents.revoke(a.id);
    expect(revoked?.revokedAt).toBe(clock().toISOString());
    clock.advance(1000);
    expect(store.agents.revoke(a.id)).toEqual(revoked);
    expect(a.revokedAt).toBeNull();
    expect(store.agents.revoke('missing')).toBeNull();
    expect(() => store.agents.create({ handle: 'BOT', sponsorUserId: owner.id, displayName: '' })).toThrow('handle already exists');
    expect(() => store.agents.create({ handle: 'other', sponsorUserId: 'missing', displayName: '' })).toThrow(AppError);
    db.prepare('DELETE FROM users WHERE id = ?').run(owner.id);
    expect(store.agents.findById(a.id)).toBeNull();
  });
});

describe('repositories repository', () => {
  it('defaults fields, enforces names per owner, and cascades deletion', () => {
    const owner = user();
    const repo = store.repositories.create({ ownerId: owner.id, name: 'Demo' });
    expect(repo).toMatchObject({ id: expect.stringMatching(/^repo_/), description: '', visibility: 'private', defaultBranch: 'main' });
    expect(Object.isFrozen(repo)).toBe(true);
    expect(store.repositories.findByOwnerAndName(owner.id, 'DEMO')).toEqual(repo);
    expect(() => store.repositories.create({ ownerId: owner.id, name: 'demo' })).toThrow('name already exists');
    const other = store.users.create({ handle: 'bob', email: 'bob', passwordHash: '' });
    expect(store.repositories.create({ ownerId: other.id, name: 'demo' }).ownerId).toBe(other.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(owner.id);
    expect(store.repositories.findById(repo.id)).toBeNull();
    expect(() => store.repositories.create({ ownerId: 'missing', name: 'x' })).toThrow(AppError);
  });
  it('paginates filtered totals and updates without mutating snapshots', () => {
    const owner = user();
    const a = store.repositories.create({ ownerId: owner.id, name: 'a', visibility: 'public', description: 'old', defaultBranch: 'dev' });
    const b = store.repositories.create({ ownerId: owner.id, name: 'b' });
    const c = store.repositories.create({ ownerId: owner.id, name: 'c', visibility: 'public' });
    expect(store.repositories.listByOwner(owner.id, { limit: 1, offset: 1, includePrivate: false })).toEqual({ items: [c], total: 2 });
    expect(store.repositories.listByOwner(owner.id, { limit: 1, offset: 1, includePrivate: true })).toEqual({ items: [b], total: 3 });
    expect(store.repositories.listByOwner(owner.id, { limit: 0, offset: 0, includePrivate: true }).items).toEqual([]);
    expect(() => store.repositories.listByOwner(owner.id, { limit: -1, offset: 0, includePrivate: true })).toThrow(AppError);
    expect(store.repositories.update(a.id, {})).toEqual(a);
    expect(store.repositories.update(a.id, { description: '', visibility: 'private', defaultBranch: 'main' })).toMatchObject({ description: '', visibility: 'private', defaultBranch: 'main' });
    expect(a.description).toBe('old');
    expect(store.repositories.update('missing', {})).toBeNull();
    expect(store.repositories.delete(b.id)).toBe(true);
    expect(store.repositories.delete(b.id)).toBe(false);
  });
});

describe('tokens repository', () => {
  it('round-trips frozen arrays, defaults fields, and finds principals', () => {
    const input = { tokenHash: 'hash', principalType: 'agent' as const, principalId: 'agent', scopes: [...ALL_SCOPES], repoIds: ['repo'], expiresAt: '2027-01-01T00:00:00Z' };
    const t = store.tokens.create(input);
    input.scopes.pop(); input.repoIds.push('other');
    expect(t).toMatchObject({ id: expect.stringMatching(/^tok_/), label: '', scopes: ALL_SCOPES, repoIds: ['repo'], revokedAt: null, lastUsedAt: null });
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.scopes)).toBe(true);
    expect(Object.isFrozen(t.repoIds)).toBe(true);
    expect(store.tokens.findByHash('hash')).toEqual(t);
    expect(store.tokens.listByPrincipal('agent', 'agent')).toEqual([t]);
    expect(store.tokens.listByPrincipal('user', 'agent')).toEqual([]);
    expect(store.tokens.findById('missing')).toBeNull();
    expect(store.tokens.findByHash('missing')).toBeNull();
    expect(() => store.tokens.create(input)).toThrow('token_hash already exists');
    expect(store.tokens.create({ ...input, tokenHash: 'next', repoIds: null, label: 'next' }).repoIds).toBeNull();
    expect(store.tokens.create({ ...input, tokenHash: 'third', repoIds: undefined }).repoIds).toBeNull();
  });
  it('touches and revokes only matching active tokens', () => {
    const make = (hash: string, type: 'user' | 'agent' = 'user') => store.tokens.create({ tokenHash: hash, principalType: type, principalId: 'p', scopes: [], expiresAt: '2027-01-01T00:00:00Z' });
    const a = make('a'); const b = make('b'); const c = make('c', 'agent');
    clock.advance(1000); store.tokens.touch(a.id); store.tokens.touch('missing');
    expect(store.tokens.findById(a.id)?.lastUsedAt).toBe(clock().toISOString());
    expect(store.tokens.revoke(a.id)).toBe(true);
    expect(store.tokens.findById(a.id)?.revokedAt).toBe(clock().toISOString());
    expect(store.tokens.revoke(a.id)).toBe(false);
    expect(store.tokens.revoke('missing')).toBe(false);
    expect(store.tokens.revokeAllForPrincipal('user', 'p')).toBe(1);
    expect(store.tokens.findById(b.id)?.revokedAt).toBe(clock().toISOString());
    expect(store.tokens.findById(c.id)?.revokedAt).toBeNull();
    expect(store.tokens.revokeAllForPrincipal('user', 'p')).toBe(0);
  });
});

describe('audit repository', () => {
  it('round-trips frozen metadata and orders newest first with filters', () => {
    const metadata = { nested: { values: [1, true, null] } };
    const a = store.audit.append({ actorType: 'user', actorId: 'a', action: 'create', target: 'r', metadata });
    metadata.nested.values.push(2);
    expect(a.metadata).toEqual({ nested: { values: [1, true, null] } });
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.metadata.nested)).toBe(true);
    const b = store.audit.append({ actorType: 'agent', actorId: 'b', action: 'push', target: 'r' });
    clock.advance(1000);
    const c = store.audit.append({ actorType: 'system', action: 'cleanup' });
    expect(c).toMatchObject({ id: expect.stringMatching(/^evt_/), at: clock().toISOString(), actorId: null, target: null, metadata: {} });
    expect(store.audit.list({ limit: 3 })).toEqual([c, b, a]);
    expect(store.audit.list({ target: 'r', limit: 1 })).toEqual([b]);
    expect(store.audit.list({ actorId: 'a', limit: 10 })).toEqual([a]);
    expect(store.audit.list({ target: 'r', actorId: 'b', limit: 10 })).toEqual([b]);
    expect(store.audit.list({ limit: 0 })).toEqual([]);
    expect(() => store.audit.list({ limit: -1 })).toThrow(AppError);
  });
});

describe('shared handle namespace', () => {
  it('rejects user and agent collisions case-insensitively without inserting', () => {
    const owner = user();
    expect(() => store.agents.create({ handle: 'aLiCe', sponsorUserId: owner.id, displayName: 'Bot' }))
      .toThrow(expect.objectContaining({ code: 'CONFLICT', message: 'Handle already taken', details: { field: 'handle' } }));
    expect(store.agents.listBySponsor(owner.id)).toEqual([]);
    const bot = store.agents.create({ handle: 'Bot', sponsorUserId: owner.id, displayName: 'Bot' });
    store.agents.revoke(bot.id);
    expect(() => store.users.create({ handle: 'bOT', email: 'bot@example.com', passwordHash: 'hash' }))
      .toThrow(expect.objectContaining({ code: 'CONFLICT', message: 'Handle already taken', details: { field: 'handle' } }));
    expect(store.users.findByEmail('bot@example.com')).toBeNull();
  });
});

describe('lineage storage', () => {
  it('upgrades an existing schema idempotently and preserves existing tokens', () => {
    db.exec('DROP INDEX tokens_issued_by; ALTER TABLE tokens DROP COLUMN issued_by_token_id; DELETE FROM schema_migrations WHERE version = 2');
    db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
      .run('old', 'oldhash', 'user', 'owner', '', '[]', null, '2027-01-01', clock().toISOString());
    migrate(db); migrate(db);
    expect(store.tokens.findById('old')?.issuedByTokenId).toBeNull();
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(2);
    const child = store.tokens.create({ tokenHash: 'child', principalType: 'user', principalId: 'owner',
      scopes: [], expiresAt: '2027-01-01', issuedByTokenId: 'old' });
    db.prepare('DELETE FROM tokens WHERE id = ?').run('old');
    expect(store.tokens.findById(child.id)?.issuedByTokenId).toBeNull();
  });
  it('revokes all descendants of principal tokens, even through revoked ancestors', () => {
    const make = (hash: string, principalType: 'agent' | 'user', issuedByTokenId: string | null) =>
      store.tokens.create({ tokenHash: hash, principalType, principalId: 'p', scopes: [],
        expiresAt: '2027-01-01', issuedByTokenId });
    const root = make('root', 'agent', null);
    const child = make('child', 'user', root.id);
    const grandchild = make('grandchild', 'user', child.id);
    const other = make('other', 'user', null);
    store.tokens.revoke(child.id);
    expect(store.tokens.revokeAllForPrincipal('agent', 'p')).toBe(2);
    for (const token of [root, child, grandchild]) {
      expect(store.tokens.findById(token.id)?.revokedAt).not.toBeNull();
    }
    expect(store.tokens.findById(other.id)?.revokedAt).toBeNull();
    expect(store.tokens.revokeAllForPrincipal('agent', 'p')).toBe(0);
    expect(store.tokens.revokeDescendants('missing')).toBe(0);
    const next = make('next', 'user', other.id);
    expect(store.tokens.revokeDescendants(other.id)).toBe(1);
    expect(store.tokens.findById(next.id)?.revokedAt).not.toBeNull();
    expect(store.tokens.findById(other.id)?.revokedAt).toBeNull();
  });
});
