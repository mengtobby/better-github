import type { Db } from './database.js';
import { conflict, validationError } from '../shared/errors.js';

function freeze(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function row<T>(value: unknown): T | null {
  if (value === undefined) return null;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const name = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    result[name] = ['scopes', 'repo_ids', 'metadata'].includes(key) && typeof entry === 'string'
      ? JSON.parse(entry) as unknown : entry;
  }
  return freeze(result) as T;
}

export function get<T>(db: Db, sql: string, ...params: unknown[]): T | null {
  return row<T>(db.prepare(sql).get(...params));
}

export function all<T>(db: Db, sql: string, ...params: unknown[]): readonly T[] {
  return Object.freeze(db.prepare(sql).all(...params).map((entry) => row<T>(entry)!));
}

export function write(db: Db, sql: string, ...params: unknown[]): number {
  try {
    return db.prepare(sql).run(...params).changes;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const field = /\.(\w+)$/.exec(error.message)?.[1] ?? 'value';
        throw conflict(`${field} already exists`);
      }
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw validationError('Referenced owner or sponsor does not exist');
      if (error.code === 'SQLITE_CONSTRAINT_CHECK') throw validationError('Invalid field value');
    }
    throw error;
  }
}
