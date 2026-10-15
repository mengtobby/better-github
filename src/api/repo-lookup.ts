import type { Store } from '../db/store.js';
import type { User, Repository } from '../db/types.js';
import { notFound } from '../shared/errors.js';

export interface ResolvedRepo { readonly owner: User; readonly repo: Repository }

export function resolveRepo(store: Store, owner: string, name: string): ResolvedRepo {
  const user = store.users.findByHandle(owner);
  const repo = user && store.repositories.findByOwnerAndName(user.id, name);
  if (!user || !repo) throw notFound('Repository');
  return { owner: user, repo };
}
