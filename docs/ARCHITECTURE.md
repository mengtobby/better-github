# Architecture

## Stack

Node 20 (≥20.12) and TypeScript 5.9 (strict, ESM, NodeNext). The HTTP layer is [Hono](https://hono.dev) on `@hono/node-server`. Validation uses zod 4. Storage is SQLite via better-sqlite3, behind a repository interface. Git work is done by the system `git` binary (≥2.38, which `merge-tree --write-tree` requires). Tests run on Vitest 3 with v8 coverage, and the coverage gate is 80%.

## Module map (Phase 1)

```
src/
  shared/      errors, envelope, ids, clock, http (error handler, zod parsing)   [Phase 0]
  db/          SQLite schema, migrations, repository-pattern store               [P1: db]
  auth/        passwords, scoped short-lived tokens, permissions, middleware     [P1: auth]
  git/         bare-repo storage + Git Smart HTTP via `git http-backend`         [P1: git-transport]
  scm/         server-side source control: refs, tree, blob, log, diff, blame,
               merge-base, merge                                                [P1: scm]
  api/         Hono app, routes, rate limiting                                  [P1: api-*]
  config.ts    env config (zod)                                                 [P1: api-app]
  main.ts      composition root                                                 [P1: api-app]
test/          cross-module integration / end-to-end flows                      [P1: api-app]
```

### Phase 2 additions

```
src/
  policy/      .forge/policy.yml schema + parse, glob matcher, risk assessment,
               merge decision (pure)                                            [P2a]
  guards/      secret scanner, dependency extraction + registry existence checks [P2a]
  provenance/  Ed25519 signing key, canonical JSON, signed push statements       [P2a]
  hooks/       hook scripts + runner, one-time hook sessions, /internal/hooks
               callback, quarantine-bound git runner                            [P2a]
  workflow/    Change Request service, push service (guards + provenance),
               triage                                                           [P2b]
```

`policy`, `guards` and `provenance` are pure or nearly pure and import only `shared` and `scm` *types*. `workflow` is the only module that composes them with `db` and `scm`. See ADR 0005 and ADR 0006.

Dependencies point downward only: `api → auth, git, scm, db → shared`. `git` and `scm` never import `db` or `auth`. They take absolute repo paths, so they stay reusable and easy to test.

## Request flow

```
client ──HTTP──▶ Hono app ─ authMiddleware (Bearer / Basic → Principal | null)
                    │      ─ rateLimit (per principal or IP)
                    ├─ /api/v1/...            JSON API, envelope responses
                    │     └─ assertRepoAccess(principal, repo, action) → store / scm
                    └─ /:owner/:name.git/...  Git Smart HTTP
                          └─ assertRepoAccess → serveGitHttp → `git http-backend` (CGI)
```

## Identity model

- **User**: a human account, which may own repositories.
- **Agent**: a non-human identity. Every agent has exactly one sponsoring user and can never do more than its sponsor.
- **Token**: a bearer credential for one principal. It carries `scopes`, an optional `repoIds` allow-list, an expiry and a revocation flag. Only a SHA-256 hash is stored; the raw token is shown once. Prefixes are `bgh_u_` (user) and `bgh_a_` (agent).
  - User tokens: default 30-day expiry, maximum 90 days.
  - Agent tokens: default 1-hour expiry, maximum 24 hours. They can't hold `agents:manage` or `tokens:manage`.
- **Effective permission** = what the sponsor is allowed ∩ the token's scopes ∩ the token's repo allow-list.
- **Private repos** return `404` to anyone without read access, so their existence never leaks.

Scopes: `repo:read`, `repo:write`, `repo:admin`, `agents:manage`, `tokens:manage`.

## Conventions every module follows

- Expected failures throw `AppError` (`src/shared/errors.ts`), never a bare `Error`. Route handlers never write their own error responses; `createErrorHandler` maps the error to an envelope.
- JSON responses use `ok()` / `fail()` from `src/shared/envelope.ts`.
- Untrusted input is parsed with zod through `parseInput` / `parseJsonBody`.
- Returned domain objects are readonly and never mutated; updates return new objects.
- Child processes use `execFile` / `spawn` with an argument array, **never a shell**. User-supplied refs and paths are validated, and refs are passed after `--end-of-options` where git supports it.
- Time comes from an injected `Clock`. IDs come from `newId(prefix)`.
- Files are small and organized by domain (200–400 lines typical, 800 max). Tests sit next to the code as `*.test.ts`.

## Gates

`npm run typecheck`, `npm run lint`, `npm run test:coverage`. Coverage thresholds: lines, functions and statements 80%; branches 75%.
