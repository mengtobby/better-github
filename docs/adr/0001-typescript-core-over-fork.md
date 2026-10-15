# ADR 0001: New TypeScript core instead of forking an existing forge

Status: accepted · 2026-10-14

## Context
Forgejo/Gitea (Go), GitLab (Ruby) and OneDev (Java) are mature forges. Our main difference from them is an agent-native core: agent identities, provenance, intent-level review, and policy merge rules. Adding those to a large codebase someone else designed would mean fighting its human-centred assumptions. Go and Rust toolchains are also not installed in this environment.

## Decision
Build a new TypeScript core. Reuse proven parts instead of writing them: the system `git` binary for the wire protocol and repository operations, plus established npm libraries (Hono, zod, better-sqlite3).

## Consequences
- We control the domain model from day one.
- We must build forge basics (repos, auth, browsing) ourselves. Phase 1 covers the minimum.
- Throughput depends on how well we shell out to git. The `scm` module keeps this behind an interface so it can later move to a native library such as libgit2 or gitoxide.
