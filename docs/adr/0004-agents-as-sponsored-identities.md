# ADR 0004: Agents are sponsored identities with short-lived scoped tokens

Status: accepted · 2026-10-14

## Context
Agents typically use a human's long-lived personal access token. That makes their actions impossible to tell apart from the human's, over-privileges them, and makes a leaked token very damaging. Leaked secrets rose 34% in 2025, and agent-written commits leak secrets at about twice the baseline rate.

## Decision
Agents are first-class principals, each tied to exactly one sponsoring user. Agent tokens:
- expire by default after 1 hour, and after 24 hours at most;
- may be limited to specific repositories;
- can never mint tokens or manage agents.

Effective permission = what the sponsor is allowed ∩ the token's scopes ∩ the token's repo allow-list. Revoking an agent revokes all of its tokens.

## Consequences
- Every action can be attributed to "agent X, sponsored by Y", which Phase 2 provenance builds on.
- Agents need a way to refresh tokens. That comes from their sponsor's tooling, and later from the MCP server.
