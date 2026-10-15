# ADR 0003: Git transport via `git http-backend`

Status: accepted · 2026-10-14

## Context
Node Git-server packages are unmaintained (node-git-server was last published in 2022). Writing our own pack protocol carries a lot of risk.

## Decision
Serve Git Smart HTTP by running `git http-backend` as a CGI process. Our Hono layer does authentication and authorization before git runs. Receive-pack is enabled per request through `GIT_CONFIG_*` environment variables. Git never sees credentials.

## Consequences
- Protocol support is complete and proven: v0/v2, shallow clones, partial clone filters.
- One process per Git request. That's acceptable for v1. Caching and a long-lived server can come later.
- Phase 2 push guards hook in through `pre-receive` hooks plus actor environment variables passed through `GitHttpOptions.env`.
