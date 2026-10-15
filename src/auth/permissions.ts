import type { Repository, Scope } from '../db/types.js';
import { forbidden, notFound, unauthorized } from '../shared/errors.js';
import type { Principal } from './principal.js';

export type RepoAction = 'read' | 'write' | 'admin';

export function hasScope(principal: Principal, scope: Scope): boolean {
  return principal.scopes.includes(scope);
}

export function canAccessRepo(principal: Principal | null, repo: Repository, action: RepoAction): boolean {
  if (action === 'read' && repo.visibility === 'public') {
    return principal === null || principal.repoIds === null || principal.repoIds.includes(repo.id);
  }
  if (!principal || principal.userId !== repo.ownerId) return false;
  if (principal.repoIds !== null && !principal.repoIds.includes(repo.id)) return false;
  return hasScope(principal, 'repo:admin')
    || (action !== 'admin' && hasScope(principal, 'repo:write'))
    || (action === 'read' && hasScope(principal, 'repo:read'));
}

export function assertRepoAccess(principal: Principal | null, repo: Repository, action: RepoAction): void {
  if (canAccessRepo(principal, repo, action)) return;
  if (repo.visibility === 'private' && !canAccessRepo(principal, repo, 'read')) throw notFound('Repository');
  if (principal === null) throw unauthorized();
  throw forbidden();
}
