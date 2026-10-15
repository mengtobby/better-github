# Task list

Legend: ✅ done · 🔄 in progress · ⏳ planned

## Phase 0: Foundation ✅
- ✅ Searched for reusable parts. Chose the `git http-backend` CGI (Node git servers are unmaintained), Hono, zod and better-sqlite3. See the ADRs.
- ✅ Repo, TypeScript strict, ESLint, Vitest with an 80% coverage gate, pinned versions that support Node 20.
- ✅ Shared contracts: `AppError`, the response envelope, ids, clock, the HTTP error handler and zod parsing.
- ✅ PRD, architecture, ADRs 0001–0004, AGENTS.md.

## Phase 1: Core forge ✅ (merged 2026-10-15)
114 tests in 22 files, 98.7% line coverage. A live server smoke test covered signup, a scoped agent token, `git push` and API reads, plus the no-leak checks.

Shipped via cxw plans `p1-core` → `p1b-app` → `p1c-review-fixes` → `p1d-api-fixes` → `p1e-final-fixes`. Blind reviews found 2 + 3 + 1 + 1 blocking issues (all fixed), including token-scope escalation, private-repo existence leaks, unbounded memory and process lifetimes, and a CPU DoS in diff matching.

| Task | Owns | Depends on |
|---|---|---|
| `db`: schema, migrations, Store (users, agents, repositories, tokens, audit) | `src/db/**` | none |
| `git-transport`: bare-repo storage + Smart HTTP | `src/git/**` | none |
| `scm`: server-side source control API (refs, tree, blob, log, diff, blame, merge-base, merge) | `src/scm/**` | none |
| `auth`: passwords, tokens, permissions, middleware | `src/auth/**` | db |
| `api-repo-content`: git and source-control HTTP routes, repo lookup | `src/api/repo-lookup.ts`, `src/api/routes/{git,scm}.ts` | auth, git-transport, scm |
| `api-app`: app shell, accounts, agents, tokens, repo routes, rate limiting, config, main, end-to-end flow | `src/api/{app,rate-limit}.ts`, `src/api/routes/{users,tokens,agents,repos}.ts`, `src/config.ts`, `src/main.ts`, `test/**` | all of the above |

### Open Phase 1 advisories (non-blocking; fix at the start of Phase 2)
- **medium** `src/git/http-lifecycle.ts`: timers are cleared once stdout drains, so a git child that hangs after closing stdout is never killed. Keep a kill timer until the process exits.
- **medium** `src/scm/scm.ts`: raw and patch output share one byte budget, so a diff with about 70k+ files can return no hunks at all. Budget the raw and patch parts separately.
- **medium** `src/api/routes/repos.ts`: the orphan-reclaim guard always passes, so a concurrent DELETE and re-CREATE of the same name can race. Use a tombstone rename or a per-name lock.
- **low** `src/scm/merge.ts`: the lock regex also matches "is at A but expected B", so the CONFLICT message is wrong (the status is right).
- **low** `src/scm/diff-parse.ts`: paths that aren't valid UTF-8 don't match their patch header, so the file comes back with no hunks.
- **low** `src/api/routes/users.ts`: listings for restricted tokens filter in memory instead of in SQL.
- **low** `src/auth/permissions.ts`: there's no collaborator model yet, so non-owners can only read public repos.

## Phase 2: Agent-native workflow ⏳
Change Requests (intent and plan) · signed provenance · push guards (secrets, hallucinated dependencies) via pre-receive · merge rules as code · risk scoring · triage queue

## Phase 3: Contribution health ⏳
Reputation · quotas · quarantine inbox · AI disclosure · untrusted-input tainting

## Phase 4: Web UI ⏳
Repo browser · Change Request review · triage queue · status page · Playwright end-to-end tests

## Phase 5: Ecosystem ⏳
MCP server · CLI · GitHub import and mirroring · usage metering · SBOM and CRA export

## Known environment notes
- Node 20.12 is end-of-life (April 2026). Upgrading to Node 22 LTS would allow Vitest 4.1.11+, which fixes dev-only advisories in tinypool and @vitest/mocker, and better-sqlite3 13.
- npm 10.5 hits an `edgesOut` bug on `npm install <pkg>`. Edit package.json and run a plain `npm install` instead.
- OneDrive can lock `coverage/` between runs (EPERM on rmdir). Delete the folder and re-run, or move the repo out of OneDrive.
- The Codex sandbox can't run vitest here. cxw runs the gates outside the sandbox, so every task description needs to tell workers not to report "blocked" for that.
