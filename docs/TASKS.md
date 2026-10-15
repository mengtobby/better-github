# Task list

Legend: ✅ done · 🔄 in progress · ⏳ planned

## Phase 0: Foundation ✅
- ✅ Searched for reusable parts. Chose the `git http-backend` CGI (Node git servers are unmaintained), Hono, zod and better-sqlite3. See the ADRs.
- ✅ Repo, TypeScript strict, ESLint, Vitest with an 80% coverage gate, pinned versions that support Node 20.
- ✅ Shared contracts: `AppError`, the response envelope, ids, clock, the HTTP error handler and zod parsing.
- ✅ PRD, architecture, ADRs 0001–0004, AGENTS.md.

## Phase 1: Core forge 🔄 (cxw plan `better-github-p1-core`)
| Task | Owns | Depends on |
|---|---|---|
| `db`: schema, migrations, Store (users, agents, repositories, tokens, audit) | `src/db/**` | none |
| `git-transport`: bare-repo storage + Smart HTTP | `src/git/**` | none |
| `scm`: server-side source control API (refs, tree, blob, log, diff, blame, merge-base, merge) | `src/scm/**` | none |
| `auth`: passwords, tokens, permissions, middleware | `src/auth/**` | db |
| `api-repo-content`: git and source-control HTTP routes, repo lookup | `src/api/repo-lookup.ts`, `src/api/routes/{git,scm}.ts` | auth, git-transport, scm |
| `api-app`: app shell, accounts, agents, tokens, repo routes, rate limiting, config, main, end-to-end flow | `src/api/{app,rate-limit}.ts`, `src/api/routes/{users,tokens,agents,repos}.ts`, `src/config.ts`, `src/main.ts`, `test/**` | all of the above |

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
