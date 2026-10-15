import { z } from 'zod';
import { parseInput } from '../shared/http.js';
import type { Db } from './database.js';
import type { Clock } from '../shared/clock.js';
import { newId } from '../shared/ids.js';
import type { RepositoryRepo } from './store.js';
import type { Repository } from './types.js';
import { all, get, write } from './rows.js';

export function createRepositoryRepo(db: Db, clock: Clock): RepositoryRepo {
  const findById = (id: string): Repository | null => get(db, 'SELECT * FROM repositories WHERE id = ?', id);
  return Object.freeze({
    create(input) {
      const id = newId('repo');
      write(db, 'INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.ownerId,
        input.name, input.description ?? '', input.visibility ?? 'private', input.defaultBranch ?? 'main', clock().toISOString());
      return findById(id)!;
    },
    findById,
    findByOwnerAndName: (ownerId: string, name: string): Repository | null =>
      get(db, 'SELECT * FROM repositories WHERE owner_id = ? AND name = ? COLLATE NOCASE', ownerId, name),
    listByOwner(ownerId, q) {
      const page = parseInput(z.object({ limit: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), includePrivate: z.boolean() }), q);
      const where = 'WHERE owner_id = ? AND (? OR visibility = \'public\')';
      const params = [ownerId, Number(page.includePrivate)];
      const count = get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM repositories ${where}`, ...params)!;
      return Object.freeze({ items: all<Repository>(db, `SELECT * FROM repositories ${where} ORDER BY rowid LIMIT ? OFFSET ?`, ...params, page.limit, page.offset), total: count.total });
    },
    update(id, patch) {
      write(db, 'UPDATE repositories SET description = COALESCE(?, description), visibility = COALESCE(?, visibility), default_branch = COALESCE(?, default_branch) WHERE id = ?',
        patch.description ?? null, patch.visibility ?? null, patch.defaultBranch ?? null, id);
      return findById(id);
    },
    delete: (id: string): boolean => write(db, 'DELETE FROM repositories WHERE id = ?', id) > 0,
  } satisfies RepositoryRepo);
}
