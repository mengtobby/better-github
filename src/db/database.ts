import BetterSqlite3 from 'better-sqlite3';
import { migrate } from './migrations.js';

export type Db = BetterSqlite3.Database;
export { migrate } from './migrations.js';

export function openDatabase(file: string): Db {
  const db = new BetterSqlite3(file);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (file !== ':memory:') db.pragma('journal_mode = WAL');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
