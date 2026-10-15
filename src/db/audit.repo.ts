import { z } from 'zod';
import { parseInput } from '../shared/http.js';
import type { Db } from './database.js';
import type { Clock } from '../shared/clock.js';
import { newId } from '../shared/ids.js';
import type { AuditRepo } from './store.js';
import type { AuditEvent } from './types.js';
import { all, get, write } from './rows.js';

export function createAuditRepo(db: Db, clock: Clock): AuditRepo {
  return Object.freeze({
    append(input) {
      const id = newId('evt');
      write(db, 'INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)', id, clock().toISOString(),
        input.actorType, input.actorId ?? null, input.action, input.target ?? null, JSON.stringify(input.metadata ?? {}));
      return get<AuditEvent>(db, 'SELECT * FROM audit_events WHERE id = ?', id)!;
    },
    list(q) {
      const query = parseInput(z.object({ target: z.string().optional(), actorId: z.string().optional(), limit: z.number().int().nonnegative() }), q);
      return all<AuditEvent>(db, 'SELECT * FROM audit_events WHERE (? IS NULL OR target = ?) AND (? IS NULL OR actor_id = ?) ORDER BY at DESC, rowid DESC LIMIT ?',
        query.target ?? null, query.target ?? null, query.actorId ?? null, query.actorId ?? null, query.limit);
    },
  } satisfies AuditRepo);
}
