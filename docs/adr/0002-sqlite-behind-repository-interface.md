# ADR 0002: SQLite behind a repository-pattern store

Status: accepted · 2026-10-14

## Context
Version 1 must run with nothing to install. Postgres is the likely production target.

## Decision
Use SQLite through better-sqlite3 (a synchronous API, WAL mode, foreign keys on). All data access goes through `Store` interfaces in `src/db/`. No other module writes SQL.

better-sqlite3 is pinned to **12.9.0**, the newest release with a prebuilt Windows binary for Node 20.

## Consequences
- Fast, simple tests: each test gets its own in-memory database.
- Moving to Postgres later means a new `Store` implementation. Because the interfaces are synchronous, that move also means making them async.
