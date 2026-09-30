# Decision memo — The roadmap stop rule (2026-09-30)

**Decider:** Founder (explicit, via structured decision in session).
**Status:** DECIDED.

## Context

`docs/company/roadmap-2026-10.md` schedules eight H0 engineering waves
(W10.1–W10.8). What remains before G0 after them is owner action — keys,
spend, legal, design partners — not engineering. The repo's own research warns
against "the recursive maturity program": polishing surface nobody has proved.

## Decision

After W10.1–W10.8 merge, **no H1 feature wave starts until G0's owner actions
are done.** Until then only these run:

- the credential-triggered waves KA–KD, each the day its key lands;
- debt, deletion and consolidation waves with net LOC ≤ 0.

## Options not taken

- Keep building engineering-only H1 waves in parallel — faster on engineering,
  but it polishes unproven surface.
- Debt-only (no consolidation) — stricter than needed.

## Consequence

The scoreboard will show that the constraint is the owner-action list
(`roadmap-2026-10.md` §A, K4 first), not engineering.
