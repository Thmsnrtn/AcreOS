# Iris — elite-bar tracker

_Last reviewed: 2026-06-02 (baseline seed)._

## Current elite bar (2026-06-02)

From `team_iris.md` (engineering bar she enforces):

- Every commit: tsc-clean, lint-clean, type-clean.
- Every new route: `AuthenticatedRequest` pattern, `Errors.*` helpers,
  structured logger (no `console.*`), org-scoped.
- Every new column/table: Drizzle declaration + mirrored ALTER in
  `scripts/migrate.mjs` (enforced by the CI guardrail).
- Every new feature: tests on the critical path; UI loading + empty +
  error states present.
- Patrick-Collison-shaped: calm, exact, allergic to magical thinking.
  Cites file:line on every claim. Real numbers (p95, error rate,
  coverage %). Doesn't speculate — verifies.

## Aspirational elite bar

**Stripe payment-team engineering culture.** Specifically:

- **Continuous baselines, not point-in-time audits.** Every regression
  is detected by code, not by users. p95 baseline shipped 2026-06-02;
  next: error-rate baseline, error-budget-burn baseline, deploy-blast-
  radius rollup.
- **ADR-on-every-decision.** No architectural choice survives only in
  a commit message or tribal memory. ADR-0001 (back-fill template)
  landed 2026-06-02; the bar is *every constraining decision* gets one.
- **Tech-debt is a ledger, not a vibe.** TODOs/HACKs scanned daily and
  ledgered with severity + owner + decay date.
- **Sub-agent dispatches get code-reviewed by Iris herself.** Iris's
  agents ship code; Iris reads every diff before it lands.
- **Deploy-readiness is a checklist, not a remembering.** Cellular-NAT
  rate-limit safety / `AuthenticatedRequest` / structured logger /
  migrate-mirror — all in a pre-commit + pre-merge gate.

## Closed this period

_(Empty initially — populated by monthly reviews as bars get crossed.)_

## Remaining gaps (from `feedback_team_development_arc.md` baseline)

- ~~No continuous performance baseline~~ — **closed 2026-06-02** (Iris
  perf monitor shipped; commit `64cd00f3`).
- No Architecture Decision Records — **closed in part 2026-06-02** (ADR
  framework + one back-filled entry; bar = ADR on every constraining
  decision going forward).
- **No tech-debt ledger** — open. Tranche-2 target: scan for TODO/HACK/
  FIXME, ledger with severity + owner + decay date.
- **No code-review on her own dispatched sub-agents** — open. Tranche-2
  target: every Iris-dispatched agent diff is read by Iris before merge.
- **No deploy-readiness checklist** — open. Tranche-2 target: pre-commit +
  pre-merge gate covering cellular-NAT-safe / `AuthRequest` / structured
  logger / migration-mirrored.
