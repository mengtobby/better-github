import type { Db } from './database.js';

const migrations = [`
CREATE TABLE users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
 sponsor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, display_name TEXT NOT NULL,
 model TEXT, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE repositories (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
 default_branch TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id, name COLLATE NOCASE));
CREATE TABLE tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 principal_type TEXT NOT NULL CHECK(principal_type IN ('user','agent')), principal_id TEXT NOT NULL,
 label TEXT NOT NULL, scopes TEXT NOT NULL, repo_ids TEXT, expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT);
CREATE INDEX tokens_principal ON tokens(principal_type, principal_id);
CREATE TABLE audit_events (id TEXT PRIMARY KEY, at TEXT NOT NULL,
 actor_type TEXT NOT NULL CHECK(actor_type IN ('user','agent','system')), actor_id TEXT,
 action TEXT NOT NULL, target TEXT, metadata TEXT NOT NULL);
CREATE INDEX audit_target ON audit_events(target);
CREATE INDEX audit_actor ON audit_events(actor_id);
`, `
ALTER TABLE tokens ADD COLUMN issued_by_token_id TEXT REFERENCES tokens(id) ON DELETE SET NULL;
CREATE INDEX tokens_issued_by ON tokens(issued_by_token_id);
`];

export function migrate(db: Db): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const record = db.prepare('INSERT INTO schema_migrations(version) VALUES (?)');
    migrations.forEach((sql, index) => {
      if (!applied.get(index + 1)) {
        db.exec(sql);
        record.run(index + 1);
      }
    });
  })();
}
