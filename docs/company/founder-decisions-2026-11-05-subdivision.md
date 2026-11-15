# Founder decisions — 2026-11-05 (Subdivision V1, Step 0)

Three questions came out of the package's Step 0 verdicts
(`docs/evidence/2026-11-05/subdivision-v1-step0.md`). The first was put to Tom
as a §9.1 decision; the other two were ruled by Muse (COO).

## 1. The buildability screen gets its own append-only table

**Decision (Tom, 2026-11-05, ~07:39 EST):** add the +1 table
`subdivision_screen_runs`, with full append-only run history. The package's
§9.1 fence ("no new table without approval") is lifted for this one table only.

**Why it came up.** No existing store can hold a screen run honestly:
- `scenarios` is numeric economics;
- `decision_snapshots` takes only the closed decision kinds;
- `evidence_claims` holds observations, not derived verdicts;
- `subdivision_plans` exist only once a plan does, and the screen runs before any plan.

**Rationale on record.** The append-only run history *is* the package's §3.3
disagreement mechanism. Re-running the screen after the facts change keeps
both verdicts visible. A live projection, the other option offered, would
have lost that.

**Effect.** Migration 0304 (numbered 0301 when decided; renumbered 2026-11-08 to sit behind #461, #463 and #459) adds the table, and its database trigger refuses
UPDATE. The `table-count` ratchet goes from 748 to 749.

## 2. The desk records pursue or pass, never "defer"

**Ruling (Muse, 2026-11-05):** drop *defer*. The decision desk records `pursue`
or `pass` only. Deferring means recording nothing yet. `DECISION_KINDS` is
**not** extended: a change to the cross-vertical vocabulary is out of
proportion to this need. §6.1 of the package is amended accordingly.

## 3. County timelines are operator-stated per run

**Ruling (Muse, 2026-11-05):** Leg 3 takes the operator's own p50/p90 timeline
as run inputs.
- Each timeline is labelled as theirs and frozen on the run record.
- The global `county_subdivision_timelines` table stays empty, and no jurisdiction figure is presented anywhere.
- Where a run states no timeline, the pro-forma's withholding rule applies exactly as today: the carry-inclusive margins are withheld, by name.
- The §5.5 critical path computes over the run's stated timeline, where one is stated.

**Premise correction (recorded).** The package's §0 and §2.8 describe the
timeline seeds as present. They are not. Migration 0283 (the P1 false-claims
sweep, 2026-10-20) deleted all six, because they came from an AI review
persona rather than from any county.
