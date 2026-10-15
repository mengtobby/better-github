# ADR 0006: Merge and guard policy lives in the repository (`.forge/policy.yml`)

Status: accepted · 2026-10-15

## Context
"Human attention is the scarce resource" means routine agent changes should merge without a person and risky ones should wait for one. Where that line sits is a per-project decision, and it must be reviewable and versioned like code.

## Decision
- **Where the policy is read from.** Policy is YAML at `.forge/policy.yml`, read from the **target branch** (never from the change being evaluated, so a change can't relax its own rules). If the file is missing, `DEFAULT_POLICY` applies.
- **What it controls:**
  - protected branches, and whether agents or humans may push to them directly;
  - guard modes (`block` / `warn` / `off`) for secrets and dependencies;
  - auto-merge eligibility (enabled, maximum risk level);
  - required human approvals by path glob and by risk level;
  - risk tuning (sensitive paths, test paths, large-change threshold).
- **Pure core.** Risk assessment and the merge decision are **pure functions** with explainable outputs. Every decision carries human-readable reasons.
- **Which approvals count.** Only human approvals of the current head commit count:
  - agents' approvals never count;
  - an author can't approve their own change;
  - a sponsor *can* approve their own agent's change, because that is the supervision model.
- **Default.** The default policy protects `main` from direct agent pushes, auto-merges only low-risk changes, and requires a human for changes to `.forge/**` or anything rated medium risk or above.

## Consequences
- Changes to the policy go through Change Requests, and by default they need a human.
- Because evaluation is pure, it is cheap to unit-test thoroughly and to show in the UI later.
