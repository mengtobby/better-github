import type { Db } from './database.js';
import type { Clock } from '../shared/clock.js';
import { newId } from '../shared/ids.js';
import type { TokenRepo } from './store.js';
import type { Token, PrincipalType } from './types.js';
import { all, get, write } from './rows.js';

export function createTokenRepo(db: Db, clock: Clock): TokenRepo {
  const findById = (id: string): Token | null => get(db, 'SELECT * FROM tokens WHERE id = ?', id);
  return Object.freeze({
    create(input) {
      const id = newId('tok');
      write(db, 'INSERT INTO tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)', id,
        input.tokenHash, input.principalType, input.principalId, input.label ?? '', JSON.stringify(input.scopes),
        input.repoIds === null || input.repoIds === undefined ? null : JSON.stringify(input.repoIds), input.expiresAt, clock().toISOString());
      return findById(id)!;
    },
    findById,
    findByHash: (hash: string): Token | null => get(db, 'SELECT * FROM tokens WHERE token_hash = ?', hash),
    listByPrincipal: (type: PrincipalType, id: string): readonly Token[] => all(db,
      'SELECT * FROM tokens WHERE principal_type = ? AND principal_id = ? ORDER BY rowid', type, id),
    revoke: (id: string): boolean => write(db, 'UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', clock().toISOString(), id) > 0,
    revokeAllForPrincipal: (type: PrincipalType, id: string): number => write(db,
      'UPDATE tokens SET revoked_at = ? WHERE principal_type = ? AND principal_id = ? AND revoked_at IS NULL', clock().toISOString(), type, id),
    touch(id) { write(db, 'UPDATE tokens SET last_used_at = ? WHERE id = ?', clock().toISOString(), id); },
  } satisfies TokenRepo);
}
