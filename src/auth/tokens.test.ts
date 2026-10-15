import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import type { Db } from '../db/database.js';
import { createStore } from '../db/store.js';
import type { Store } from '../db/store.js';
import { fixedClock } from '../shared/clock.js';
import type { Principal } from './principal.js';
import { ALL_SCOPES } from '../db/types.js';
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
function issuer(): Principal {
  return tokens.authenticate(tokens.issueUserToken(userId, { scopes: ALL_SCOPES }, null).token)!;
}

describe('token issuance', () => {
  it('stores only hashes, applies defaults and returns frozen principals with touched usage', () => {
    const issued = tokens.issueUserToken(userId, { scopes: ['repo:write'], label: 'CLI', repoIds: ['repo'] }, null);
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
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: ['repo:read'] }, issuer());
    expect(agent.token).toMatch(/^bgh_a_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(agent.record.expiresAt) - clock().getTime()).toBe(TOKEN_TTL.agentDefaultMs);
    expect(tokens.authenticate(agent.token)).toMatchObject({ type: 'agent', id: agentId, userId, handle: 'bot', repoIds: null });
    expect(createTokenService(store).issueUserToken(userId, { scopes: [] }, null).record.repoIds).toBeNull();
  });
  it('enforces TTL bounds and valid scope inputs', () => {
    for (const ttlMs of [0, -1, NaN, Infinity, 1.5, TOKEN_TTL.userMaxMs + 1]) {
      expect(() => tokens.issueUserToken(userId, { scopes: [], ttlMs }, null)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [], ttlMs: TOKEN_TTL.agentMaxMs + 1 }, issuer()))
      .toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    for (const scope of ['agents:manage', 'tokens:manage'] as const) {
      expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [scope] }, issuer()))
        .toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    }
    expect(tokens.issueUserToken(userId, { scopes: ['tokens:manage'], ttlMs: TOKEN_TTL.userMaxMs }, null)).toBeDefined();
    expect(tokens.issueAgentToken(userId, agentId, { scopes: [], ttlMs: TOKEN_TTL.agentMaxMs }, issuer())).toBeDefined();
    expect(() => tokens.issueUserToken('missing', { scopes: [] }, null)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => tokens.issueUserToken('', { scopes: [] }, null)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
  it('requires an active agent belonging to the sponsor', () => {
    for (const [sponsor, agent] of [['other', agentId], [userId, 'missing']]) {
      expect(() => tokens.issueAgentToken(sponsor!, agent!, { scopes: [] }, issuer())).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
    store.agents.revoke(agentId);
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [] }, issuer())).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('authentication and revocation', () => {
  it('rejects unknown, expired, revoked, orphaned and revoked-agent tokens', () => {
    for (const raw of ['', 'unknown', `bgh_u_${'a'.repeat(43)}`]) expect(tokens.authenticate(raw)).toBeNull();
    const user = tokens.issueUserToken(userId, { scopes: [], ttlMs: 1 }, null);
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] }, issuer());
    clock.advance(1);
    expect(tokens.authenticate(user.token)).toBeNull();
    store.agents.revoke(agentId);
    expect(tokens.authenticate(agent.token)).toBeNull();
    const active = tokens.issueUserToken(userId, { scopes: [] }, null);
    const principal = tokens.authenticate(active.token)!;
    tokens.revoke(active.record.id, principal);
    tokens.revoke(active.record.id, principal);
    expect(tokens.authenticate(active.token)).toBeNull();
    const missing = tokens.issueUserToken(userId, { scopes: [] }, null);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    expect(tokens.authenticate(missing.token)).toBeNull();
  });
  it('rejects inconsistent stored identities and invalid expiry', () => {
    const user = tokens.issueUserToken(userId, { scopes: [] }, null);
    db.prepare('UPDATE tokens SET expires_at = ? WHERE id = ?').run('invalid', user.record.id);
    expect(tokens.authenticate(user.token)).toBeNull();
    db.prepare('UPDATE tokens SET expires_at = ?, principal_type = ? WHERE id = ?')
      .run('2027-01-01T00:00:00Z', 'agent', user.record.id);
    expect(tokens.authenticate(user.token)).toBeNull();
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] }, issuer());
    db.prepare('UPDATE tokens SET principal_id = ? WHERE id = ?').run('missing', agent.record.id);
    expect(tokens.authenticate(agent.token)).toBeNull();
  });
  it('lets users revoke their own or sponsored tokens, denying other users and agents', () => {
    const user = tokens.issueUserToken(userId, { scopes: ['tokens:manage'] }, null);
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: [] }, issuer());
    const principal = tokens.authenticate(user.token)!;
    const bot = tokens.authenticate(agent.token)!;
    expect(() => tokens.revoke(user.record.id, bot)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.revoke(agent.record.id, { ...principal, id: 'other' })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.revoke('missing', principal)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    tokens.revoke(agent.record.id, principal);
    expect(tokens.authenticate(agent.token)).toBeNull();
  });
});

describe('issuer boundaries', () => {
  it('requires the matching user and management scope for each grant', () => {
    const by = issuer();
    for (const bad of [{ ...by, type: 'agent' as const }, { ...by, id: 'other' }, { ...by, scopes: [] }]) {
      expect(() => tokens.issueUserToken(userId, { scopes: [] }, bad)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
      expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [] }, bad)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
    expect(() => tokens.issueUserToken(userId, { scopes: ['repo:admin'] }, { ...by, scopes: ['tokens:manage'] }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: ['repo:write'] }, { ...by, scopes: ['agents:manage'] }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it('bounds repository lists and expiry for both token types', () => {
    const by = tokens.authenticate(tokens.issueUserToken(userId, { scopes: ALL_SCOPES, repoIds: ['A'], ttlMs: 1000 }, null).token)!;
    for (const issue of [
      (opts: Parameters<TokenService['issueUserToken']>[1]) => tokens.issueUserToken(userId, opts, by),
      (opts: Parameters<TokenService['issueUserToken']>[1]) => tokens.issueAgentToken(userId, agentId, opts, by),
    ]) {
      for (const repoIds of [undefined, null, ['B'], ['A', 'B']]) {
        expect(() => issue({ scopes: [], repoIds })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
      }
      const child = issue({ scopes: ['repo:read'], repoIds: ['A'] });
      expect(child.record.expiresAt).toBe(by.expiresAt);
      expect(tokens.authenticate(child.token)?.expiresAt).toBe(by.expiresAt);
      expect(issue({ scopes: [], repoIds: [], ttlMs: 1 }).record.expiresAt).toBe(new Date(clock().getTime() + 1).toISOString());
    }
    for (const expiresAt of ['invalid', clock().toISOString()]) {
      expect(() => tokens.issueUserToken(userId, { scopes: [] }, { ...by, expiresAt }))
        .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
  });
  it('allows read-only users and agents to revoke themselves, but not other tokens', () => {
    const user = tokens.issueUserToken(userId, { scopes: ['repo:read'] }, null);
    const agent = tokens.issueAgentToken(userId, agentId, { scopes: ['repo:read'] }, issuer());
    const by = tokens.authenticate(user.token)!;
    const bot = tokens.authenticate(agent.token)!;
    expect(() => tokens.revoke(agent.record.id, by)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    tokens.revoke(user.record.id, by);
    tokens.revoke(agent.record.id, bot);
    expect(tokens.authenticate(user.token)).toBeNull();
    expect(tokens.authenticate(agent.token)).toBeNull();
  });
});

describe('token lineage', () => {
  it('allows narrower repository scopes while requiring explicit management scopes', () => {
    const by = { ...issuer(), scopes: ['repo:admin', 'tokens:manage'] as const };
    expect(tokens.issueUserToken(userId, { scopes: ['repo:read'] }, by).record.scopes).toEqual(['repo:read']);
    expect(tokens.issueUserToken(userId, { scopes: ['repo:write'] }, by).record.scopes).toEqual(['repo:write']);
    expect(tokens.issueUserToken(userId, { scopes: ['repo:read'] },
      { ...by, scopes: ['repo:write', 'tokens:manage'] }).record.scopes).toEqual(['repo:read']);
    for (const scopes of [['repo:write'], ['agents:manage']] as const) {
      expect(() => tokens.issueUserToken(userId, { scopes }, { ...by, scopes: ['repo:read', 'tokens:manage'] }))
        .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
    expect(() => tokens.issueUserToken(userId, { scopes: [] }, { ...by, scopes: ['repo:admin'] }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => tokens.issueAgentToken(userId, agentId, { scopes: [] }, by))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
  it('records issuers and revokes children and grandchildren without touching siblings', () => {
    const parent = issuer();
    const child = tokens.issueUserToken(userId, { scopes: ALL_SCOPES }, parent);
    const grandchild = tokens.issueAgentToken(userId, agentId, { scopes: ['repo:read'] },
      tokens.authenticate(child.token)!);
    const unrelated = tokens.issueUserToken(userId, { scopes: [] }, null);
    expect(child.record.issuedByTokenId).toBe(parent.tokenId);
    expect(grandchild.record.issuedByTokenId).toBe(child.record.id);
    expect(unrelated.record.issuedByTokenId).toBeNull();
    tokens.revoke(parent.tokenId, parent);
    expect(tokens.authenticate(child.token)).toBeNull();
    expect(tokens.authenticate(grandchild.token)).toBeNull();
    expect(tokens.authenticate(unrelated.token)).not.toBeNull();
  });
});
