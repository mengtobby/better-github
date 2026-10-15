import type { Db } from './database.js';
import type { Clock } from '../shared/clock.js';
import { conflict } from '../shared/errors.js';
import { newId } from '../shared/ids.js';
import type { AgentRepo } from './store.js';
import type { Agent } from './types.js';
import { all, get, write } from './rows.js';

export function createAgentRepo(db: Db, clock: Clock): AgentRepo {
  const findById = (id: string): Agent | null => get(db, 'SELECT * FROM agents WHERE id = ?', id);
  return Object.freeze({
    create(input) {
      return db.transaction(() => {
        if (db.prepare('SELECT id FROM users WHERE handle = ?').get(input.handle)) {
          throw conflict('Handle already taken', { field: 'handle' });
        }
        const id = newId('agt');
        write(db, 'INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, NULL)', id, input.handle,
          input.sponsorUserId, input.displayName, input.model ?? null, clock().toISOString());
        return findById(id)!;
      }).immediate();
    },
    findById,
    findByHandle: (handle: string): Agent | null => get(db, 'SELECT * FROM agents WHERE handle = ?', handle),
    listBySponsor: (id: string): readonly Agent[] => all(db, 'SELECT * FROM agents WHERE sponsor_user_id = ? ORDER BY rowid', id),
    revoke(id) {
      write(db, 'UPDATE agents SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', clock().toISOString(), id);
      return findById(id);
    },
  } satisfies AgentRepo);
}
