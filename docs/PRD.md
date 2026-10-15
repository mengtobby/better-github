# Product Requirements: an agent-native code forge

Status: draft v0.1 · 2026-10-14 · Background research: [research/github-agent-era-report.md](research/github-agent-era-report.md)

## 1. Problem

Coding agents now produce most new code activity: commit volume grew roughly 14x in a year, and agent-opened pull requests went from 4M to 17M in six months. Today's forges were designed for people working at human speed, and they are failing in predictable ways:

| Failure | Evidence (see research report) |
|---|---|
| Infrastructure can't absorb agent load | GitHub needed 30x capacity; frequent outages in 2026 |
| Workflow assumes humans write and review every line | Review is the bottleneck; agent PRs need more review rounds |
| The open-contribution model drowns in low-quality AI submissions | curl bounty shut down; PR "kill switch" and caps shipped |
| Untrusted text drives privileged automation | Prompt-injection compromises of release pipelines (Cline, LiteLLM) |
| No trustworthy record of who or what made a change | Optional co-author trailers, fake stars, unverifiable signals |
| Lock-in to one agent vendor | Agent vendors bundling their own forges |

## 2. Vision

A Git-compatible forge where **agents do the producing and humans do the supervising**, and where every change can be traced back to who or what made it.

## 3. Users

- **Supervisor**: a developer directing several agents. Needs a review queue ranked by risk, short summaries of what each change intends, and safe automatic merging for routine changes.
- **Agent**: an automated client (any vendor). Needs cheap reads that don't require a full clone, server-side merges, narrowly scoped short-lived credentials, and machine-readable errors.
- **Maintainer**: runs an open-source project. Needs inbound contributions filtered by quality and reputation, without closing the project to outsiders.
- **Org / compliance owner**: needs provenance, SBOMs, audit logs, and EU CRA vulnerability-reporting workflows.

## 4. Principles

1. **Git-compatible, no lock-in.** Any Git client works, and mirroring to or from other forges is supported.
2. **Agents are identities, not shared keys.** Every agent has a human sponsor, least-privilege scopes, and short-lived tokens.
3. **Provenance by default.** Every write records the human, the agent, and the model behind it.
4. **Human attention is the scarce resource.** The product spends it only where risk is.
5. **Untrusted text is data, never instructions.** Content from untrusted sources is flagged before it reaches automation.
6. **Honest operations.** The status page is computed from real health checks.
7. **Vendor-neutral.** Every agent gets the same API, plus an MCP server.

## 5. Scope by phase

| Phase | Deliverable | Acceptance (summary) |
|---|---|---|
| 0 | Foundation: repo, tooling, shared contracts, docs | typecheck, lint and test gates pass |
| 1 | **Core forge**: data layer, accounts, agent identities, scoped tokens, repos, Git Smart HTTP, server-side source control API | An agent token can push over HTTP, then read its tree and merge server-side through the API; private repos are invisible to outsiders |
| 2 | Agent-native workflow: Change Requests (intent and plan), signed provenance, push guards (secrets, hallucinated dependencies), merge rules as code, risk scoring, triage queue | Low-risk changes auto-merge under policy; risky ones queue for a human with a stated reason |
| 3 | Contribution health: reputation, quotas, quarantine inbox, AI disclosure, untrusted-input tainting | Unknown contributors land in quarantine with rate limits based on reputation |
| 4 | Web UI: repo browser, Change Request review, triage queue, status page | Playwright end-to-end tests for the core flows |
| 5 | Ecosystem: MCP server, CLI, GitHub import and mirroring, usage metering, SBOM and CRA export | An agent built on any SDK can complete the full flow over MCP |

## 6. Non-goals (v1)

Hosted CI runners, horizontal scaling across nodes, billing, federation, issue tracking beyond what Change Requests need.

## 7. Success metrics (once deployed)

- Median human review time per merged agent change.
- Share of agent changes merged by policy without a human, and their revert rate.
- Secrets blocked at push.
- Gap between measured and published uptime (target: zero).
