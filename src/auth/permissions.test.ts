import { describe, expect, it } from 'vitest';
import type { Repository, Scope } from '../db/types.js';
import type { Principal } from './principal.js';
import { assertRepoAccess, canAccessRepo, hasScope } from './permissions.js';

const repo: Repository = { id: 'repo', ownerId: 'owner', name: 'repo', description: '',
  visibility: 'private', defaultBranch: 'main', createdAt: '2026-01-01T00:00:00Z' };
function principal(scopes: readonly Scope[], patch: Partial<Principal> = {}): Principal {
  return { type: 'user', id: 'owner', userId: 'owner', handle: 'owner', scopes, repoIds: null, tokenId: 'token', expiresAt: '2027-01-01T00:00:00Z', ...patch };
}

describe('repository permissions', () => {
  it('allows anonymous public reads and hides private repositories', () => {
    const publicRepo = { ...repo, visibility: 'public' as const };
    expect(canAccessRepo(null, publicRepo, 'read')).toBe(true);
    expect(() => assertRepoAccess(null, publicRepo, 'read')).not.toThrow();
    expect(() => assertRepoAccess(null, publicRepo, 'write')).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    for (const action of ['read', 'write', 'admin'] as const) {
      expect(canAccessRepo(null, repo, action)).toBe(false);
      expect(() => assertRepoAccess(null, repo, action)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    }
  });
  it('intersects scope hierarchy with ownership for users and sponsored agents', () => {
    for (const type of ['user', 'agent'] as const) {
      for (const scope of ['repo:read', 'repo:write', 'repo:admin'] as const) {
        const owner = principal([scope], { type, id: type === 'agent' ? 'bot' : 'owner' });
        expect(hasScope(owner, scope)).toBe(true);
        expect(canAccessRepo(owner, repo, 'read')).toBe(true);
        expect(canAccessRepo(owner, repo, 'write')).toBe(scope !== 'repo:read');
        expect(canAccessRepo(owner, repo, 'admin')).toBe(scope === 'repo:admin');
        expect(canAccessRepo({ ...owner, userId: 'other' }, repo, 'read')).toBe(false);
        expect(() => assertRepoAccess({ ...owner, userId: 'other' }, repo, 'read'))
          .toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      }
    }
    expect(() => assertRepoAccess(principal(['repo:read']), repo, 'write')).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => assertRepoAccess(principal([]), repo, 'read')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
  it('enforces repository allow-lists and permits public reads without scopes', () => {
    const publicRepo = { ...repo, visibility: 'public' as const };
    expect(canAccessRepo(principal([], { userId: 'other' }), publicRepo, 'read')).toBe(true);
    expect(canAccessRepo(principal(['repo:admin'], { userId: 'other' }), publicRepo, 'write')).toBe(false);
    expect(() => assertRepoAccess(principal([]), publicRepo, 'write')).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    for (const target of [repo, publicRepo]) {
      expect(canAccessRepo(principal(['repo:admin'], { repoIds: [] }), target, 'read')).toBe(false);
      expect(canAccessRepo(principal(['repo:admin'], { repoIds: [] }), target, 'write')).toBe(false);
      expect(canAccessRepo(principal(['repo:admin'], { repoIds: ['repo'] }), target, 'write')).toBe(true);
    }
  });
});
