# Solene — role evolution log

_Append-only ledger. Newest at the top._

## 2026-06-02 — Perpetual role-development cadence shipped

Solene's role evolved from "self-development is a stated intent" to
"self-development is operating tempo with forcing functions." The
foundational pieces:

- **Monthly team-member review cron** — `scripts/generate-team-member-
  review.mjs` + rotation (Iris/Soren/Beatrice/Krieger) + 1st-of-month
  09:00 UTC cron in `runScheduledJobs.ts`.
- **Quarterly Solene-arc review cron** — `scripts/generate-solene-
  arc-review.mjs` + 1st-of-quarter 09:00 UTC cron.
- **Elite-bar trackers + evolution logs seeded** for all 5 members
  (this tree).
- **Review-skeleton staleness detector** — 9th detector added to
  `selfAudit.ts`, fires `warn` when a generated review skeleton
  still has `TODO(solene):` markers more than 7 days after generation.
  The cadence is real because the audit catches it when it isn't.

## 2026-06-02 — Baseline tranche 2 self-development shipped

Solene's role evolved from "Chief of Staff interface" to "COO with
self-correcting operational disciplines." The foundational pieces:

- **Self-audit framework** — `server/services/solene/selfAudit.ts`
  with 8 detectors (menu-handing, permission-seeking, credential leak,
  stale charter quote, verify-before-dispatch failure, capital
  overspend, team-state collision, brief-context staleness) + drift
  signal + per-session/per-week cron.
- **Capital tracker** — `server/services/solene/capitalTracker.ts`
  with envelope status + amber/red thresholds + monthly projection.
- **Team-state map** — `docs/internal/solene-team-state.md` + 15-min
  regenerator cron; loaded on session start.
- **Weekly retro generator** — `scripts/generate-weekly-retro.mjs` +
  Sunday-23:00-UTC cron; auto-pulls commits / dispatches / audit
  findings / capital, Solene fills the manual sections.
- **Proactive page channel** — page endpoint + discipline doc; for
  genuinely-urgent items between sessions.
