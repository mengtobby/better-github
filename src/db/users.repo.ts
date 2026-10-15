import type { Db } from './database.js';
import type { Clock } from '../shared/clock.js';
import { newId } from '../shared/ids.js';
import type { UserRepo } from './store.js';
import type { User } from './types.js';
import { get, write } from './rows.js';

export function createUserRepo(db: Db, clock: Clock): UserRepo {
  const findById = (id: string): User | null => get(db, 'SELECT * FROM users WHERE id = ?', id);
  return Object.freeze({
    create(input) {
      const id = newId('usr');
      write(db, 'INSERT INTO users VALUES (?, ?, ?, ?, ?)', id, input.handle, input.email, input.passwordHash, clock().toISOString());
      return findById(id)!;
    },
    findById,
    findByHandle: (handle: string): User | null => get(db, 'SELECT * FROM users WHERE handle = ?', handle),
    findByEmail: (email: string): User | null => get(db, 'SELECT * FROM users WHERE email = ?', email),
  } satisfies UserRepo);
}
