import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import type { Db } from '../db/database.js';
import { createStore } from '../db/store.js';
import type { Store } from '../db/store.js';
import { fixedClock } from '../shared/clock.js';
import { createTokenService, TOKEN_TTL } from './tokens.js';
import type { TokenService } from './tokens.js';

let db: Db;
let store: Store;
let tokens: TokenService;
let clock: ReturnType<typeof fixedClock>;
let userId: string;
let agentId: string;
beforeEach(() => {
  clock = fixedClock('2026-01-01T00:00:00Z');
  db = openDatabase(':memory:');
  store = createStore(db, clock);
  tokens = createTokenService(store, clock);
  userId = store.users.create({ handle: 'alice', email: 'alice', passwordHash: 'hash' }).id;
  agentId = store.agents.create({ handle: 'bot', sponsorUserId: userId, displayName: 'Bot' }).id;
});
afterEach(() => db.close());

describe('token issuance', () => {
  it('stores only hashes, applies defaults and returns frozen principals with touched usage', () => {
    const issued = tokens.issueUserToken(userId, { scopes: ['repo:write'], label: 'CLI', repoIds: ['repo'] });
    expect(issued.token).toMatch(/^bgh_u_[A-Za-z0-9_-]{43}$/);
    expect(issued.record.tokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(JSON.stringify(store.tokens.listByPrincipal('user', userId))).not.toContain(issued.token);
    expect(Date.parse(issued.record.expiresAt) - clock().getTime()).toBe(TOKEN_TTL.userDefaultMs);
    clock.advance(100);
    const principal = tokens.authenticate(issued.token)!;
    expect(principal).toMatchObject({ type: 'user', id: userId, userId, handle: 'alice', tokenId: issued.record.id });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
    expect(Object.isFrozen(principal.repoIds)).toBe(true);
    expect(store.tokens.findById(issued.record.id)?.lastUsedAt).toBe(clock().toISOString());
    expect(issued.record.lastUsedAt).toBeNull();
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: ['repo:read'] });
    expect(agent.token).toMatch(/^bgh_a_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(agent.record.expiresAt) - clock().getTime()).toBe(TOKEN_TTL.agentDefaultMs);
    expect(tokens.authenticate(agent.token)).toMatchObject({ type: 'agent', id: agentId, userId, handle: 'bot', repoIds: null });
    expect(createTokenService(store).issueUserToken(userId, { scopes: [] }).record.repoIds).toBeNull();
  });
  it('enforces TTL bounds and valid scope inputs', () => {
    for (const ttlMs of [0, -1, NaN, Infinity, 1.5, TOKEN_TTL.userMaxMs + 1]) {
      expect(() => tokens.issueUserToken(userId, { scopes: [], ttlMs })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [], ttlMs: TOKEN_TTL.agentMaxMs + 1 }))
      .toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    for (const scope of ['agents:manage', 'tokens:manage'] as const) {
      expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [scope] }))
        .toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(tokens.issueUserToken(userId, { scopes: ['tokens:manage'], ttlMs: TOKEN_TTL.userMaxMs })).toBeDefined();
    expect(tokens.issueAgentToken(userId, agentId, { scopes: [], ttlMs: TOKEN_TTL.agentMaxMs })).toBeDefined();
    expect(() => tokens.issueUserToken('missing', { scopes: [] })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => tokens.issueUserToken('', { scopes: [] })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
  it('requires an active agent belonging to the sponsor', () => {
    for (const [sponsor, agent] of [['other', agentId], [userId, 'missing']]) {
      expect(() => tokens.issueAgentToken(sponsor!, agent!, { scopes: [] })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
    store.agents.revoke(agentId);
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [] })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('authentication and revocation', () => {
  it('rejects unknown, expired, revoked, orphaned and revoked-agent tokens', () => {
    for (const raw of ['', 'unknown', `bgh_u_${'a'.repeat(43)}`]) expect(tokens.authenticate(raw)).toBeNull();
    const user = tokens.issueUserToken(userId, { scopes: [], ttlMs: 1 });
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] });
    clock.advance(1);
    expect(tokens.authenticate(user.token)).toBeNull();
    store.agents.revoke(agentId);
    expect(tokens.authenticate(agent.token)).toBeNull();
    const active = tokens.issueUserToken(userId, { scopes: [] });
    const principal = tokens.authenticate(active.token)!;
    tokens.revoke(active.record.id, principal);
    tokens.revoke(active.record.id, principal);
    expect(tokens.authenticate(active.token)).toBeNull();
    const missing = tokens.issueUserToken(userId, { scopes: [] });
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    expect(tokens.authenticate(missing.token)).toBeNull();
  });
  it('rejects inconsistent stored identities and invalid expiry', () => {
    const user = tokens.issueUserToken(userId, { scopes: [] });
    db.prepare('UPDATE tokens SET expires_at = ? WHERE id = ?').run('invalid', user.record.id);
    expect(tokens.authenticate(user.token)).toBeNull();
    db.prepare('UPDATE tokens SET expires_at = ?, principal_type = ? WHERE id = ?')
      .run('2027-01-01T00:00:00Z', 'agent', user.record.id);
    expect(tokens.authenticate(user.token)).toBeNull();
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] });
    db.prepare('UPDATE tokens SET principal_id = ? WHERE id = ?').run('missing', agent.record.id);
    expect(tokens.authenticate(agent.token)).toBeNull();
  });
  it('lets users revoke their own or sponsored tokens, denying other users and agents', () => {
    const user = tokens.issueUserToken(userId, { scopes: [] });
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] });
    const principal = tokens.authenticate(user.token)!;
    const bot = tokens.authenticate(agent.token)!;
    expect(() => tokens.revoke(user.record.id, bot)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.revoke(agent.record.id, { ...principal, id: 'other' })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.revoke('missing', principal)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    tokens.revoke(agent.record.id, principal);
    expect(tokens.authenticate(agent.token)).toBeNull();
  });
});
