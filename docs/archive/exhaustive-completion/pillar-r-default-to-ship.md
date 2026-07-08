# Pillar R — Default to ship, with retract built in

**Goal:** the Balanced auto-merge gate puts the founder on the path of
every user-visible change forever. Flip the default so that proven
agents in proven categories auto-execute, and the founder reviews
*outcomes* on a 7-day window instead of *proposals* up-front.

The system has the building blocks already:
- `company_agents.trustScore` — 0-100 per agent
- `trustAuthorityEscalation.ts` — tier ladder unlocking actions at
  60/75/90 trust thresholds
- `evolutionPipeline.ts` Stage 6 — "regression check" exists but isn't
  wired to actual retract
- `audit_events` — every action traceable
- `decisions_inbox_items.outcomeScore` — already supports -2..+2
  outcome scoring

What's missing: graduation tracking per-category, automatic retract on
regression, and founder-facing telemetry showing "what shipped while
you slept."

---

## Design

### Category trust graduation

Per (agent, action_category) tuple track:
- `consecutiveAccepted` — count of approved proposals in a row
- `consecutiveRetracted` — count of post-merge retracts in a row
- `graduationTier` — `manual` | `notify_only` | `silent`

Promotion rules:
- 10 consecutive accepted at `manual` → promote to `notify_only` (auto-merges; founder gets a one-line notification)
- 50 consecutive accepted at `notify_only` → promote to `silent` (auto-merges; shows up in the weekly digest)
- 1 retracted at `silent` → demote to `notify_only`
- 1 retracted at `notify_only` → demote to `manual`
- 3 consecutive retracted at `manual` → category SUSPENDED for that agent (founder explicit re-enable required)

### Automatic retract on regression

`agent_proposal_observations` table — every shipped agent change gets
a 7-day observation row. A nightly cron compares telemetry deltas
(error rate, Pax response-quality, customer churn proxy) before vs
after the merge. If any metric regresses beyond a threshold, the
cron auto-reverts the commit and demotes the agent's graduation tier.

### Outcome-not-output review surface

`/founder/outcomes` — the inverse of `/founder/agent-queue`. Instead
of "things waiting for your approval," it's "things that shipped
recently — confirm continuation or retract." Shipped this PR as a
section of `/founder/now`.

---

## What ships in this PR

1. **`agent_action_graduations` schema** — per (agent, category) tier
   tracking.
2. **`agent_proposal_observations` schema** — 7-day post-merge
   telemetry-watch window per agent-shipped change.
3. **`server/services/trustGraduation.ts`** — pure functions for
   tier transitions, retract decisions, and SUSPENDED gates.
4. **Auto-execute hook** — autonomousDecisionExecutor.ts checks
   graduation tier *before* hitting AUTO_EXECUTE_THRESHOLD. When tier
   is `notify_only` or `silent`, auto-executes regardless of
   confidence (subject to the existing simulation gate).
5. **Retract cron** — daily job that checks each open observation
   and triggers `git revert` via the existing PR-generation plumbing
   if telemetry regresses.
6. **`/founder/now` integration** — recently-shipped silent-tier
   changes appear in the "running fine" section with a one-click
   retract button if anything looks off.

Queued (in pillar-r doc): per-customer Pax response-quality telemetry
plumbing; gradient-based tier promotion (the binary
manual→notify→silent is too coarse for some categories); founder UI
for explicit tier override.
