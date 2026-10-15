# ADR 0005: Push guards and provenance via git hooks that call back to the server

Status: accepted · 2026-10-15

## Context
Push guards (secret scanning, hallucinated-dependency checks, branch protection) must be able to **reject** a push before any ref moves. Provenance must record exactly which refs moved and who moved them. Only git's `pre-receive` and `post-receive` hooks see the ref updates, and inside `pre-receive` the new objects sit in a quarantine directory.

## Decision
- **Server-managed hook scripts.** At startup the server writes `pre-receive` and `post-receive` shell scripts plus a small plain-JS runner (`forge-hook-runner.mjs`) into `DATA_DIR/hooks`. Each Git push request sets `core.hooksPath` to that directory through `GitHttpOptions.config`. Nothing is installed per repository.
- **One-time hook session.** For each receive-pack request the git route creates a one-time **hook session** (random token, 15-minute TTL) bound to the authenticated principal and the repo. The token reaches the hook only through the environment (`FORGE_HOOK_TOKEN`), so the hook can't claim any other identity.
- **Callback over loopback.** The runner reads the ref updates on stdin and POSTs them, together with the quarantine environment (`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_QUARANTINE_PATH`), to `POST /internal/hooks` on loopback. The server validates the quarantine paths (they must be inside the repo), runs the guards with a git runner bound to that quarantine environment, and replies `{allow, messages}`.
- **Messages and failure modes.** The runner prints the messages to stderr, so pushers see `remote: …`. `pre-receive` **fails closed**: an unreachable server rejects the push. `post-receive` fails open.

## Consequences
- The guards and provenance logic are ordinary TypeScript that can be tested, not shell.
- Each push costs one extra loopback HTTP call per hook.
- Hooks need `sh`, which Git for Windows ships, and the Node binary. `process.execPath` is passed as `FORGE_NODE`.
- `/internal/hooks` must never be reachable from outside. It only accepts valid one-time hook tokens and should be bound to loopback.
