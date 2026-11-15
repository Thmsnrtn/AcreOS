# Subdivision V1, Leg 4: decision-loop closure (2026-11-09)

Branch `claude/subdiv-leg4-api`, stacked on PR #462's branch `claude/subdivision-legs1-2-screen-yield` (Legs 1–2), whose tree contains Leg 3 (#464, merged 2026-11-07, `0abcce7`) via main. The spec is package 2026-11 §5.5 and §6–§8.4. The Step 0 verdicts are in `subdivision-v1-step0.md`, the rulings in `founder-decisions-2026-11-05-subdivision.md`, and the Leg 4 scope record is the 2026-11-09 API-burn note. This leg runs under ruling 3: the timeline is operator-stated for each run.

This document was written by the test-and-evidence stage. The build stages S1–S3 are `e2452174`, `ab500f81` and `5fc1b72b`.

**Read this first: the tests listed below were written but not executed in the session that wrote them.** The session's shell refused every `vitest` invocation (`npm test` and `npx vitest`), and it could not read the scope record, which lives outside the repo. The counts below are counts of written tests, not of passing ones. Run the batch listed under "Gates still owed" before trusting any line here.

## What it adds

**§5.5, the entitlement critical path: `shared/subdivision/criticalPath.ts`** (`subdivision-critical-path v1`; moved here from Leg 3).
- Pure and browser-safe. The as-of date is an input and there is no clock inside, so the same inputs give the same answer.
- Measures elapsed time against the decision run's own stated p50/p90 (ruling 3). The decision's `recordedAt` plus the stated days gives the p50 and p90 end dates. Position is `within_p50`, `between_p50_p90` or `past_p90`. Boundaries are inclusive: day 30 of a 30-day p50 is still within.
- **Withheld, by name:**
  - no decision on record;
  - a decision with either timeline unstated (no timeline is assumed);
  - an unreadable as-of or decision date.
- **Slipped gates:** open gates only (anything except `approved` / `skipped`) whose expected return is strictly before as-of. `daysOverdue` is an exact whole-UTC-day count, ordered by sequence.
- **Projected finish** is the latest expected return among open gates. `overrunVsP90Days` is signed. An open gate with no dates gives `projectedFinish: null` plus a stated reason. No open gates gives null with no reason (nothing left to project).
- No county figure is read. A gate's expected return is whatever the operator recorded, or absent.

**§6.1, the decision: `POST /api/subdivision/decide`** (`server/routes-subdivision-decision.ts`).
- Goes through the shared kit (`recordUnderwrittenDecision`): engine `subdivision_feasibility`, pack `"subdivider"`. The engine and pack are fixed by the route, not taken from the body. The operator's inputs are recomputed server-side, and the evidence-rule-v2 ownership guard runs before any write.
- Only `pursue` and `pass` are accepted (`defer` was dropped by ruling; `offer` is not a subdivision call). `reviewDueAt` is required-nullable: a missing key is refused, null is an answer, and a past date is refused.
- The decision is recorded on the parent parcel only. A child lot (`parentParcelId` set) is refused.
- **Screen evidence is frozen on the scenario** as `derived` assumptions: run id, rule version, triggered and not-determinable counts, and both yield ends with their bases. A yield end that did not compute is not frozen as a number. With no run on record, one `screen_state: "not screened"` assumption says so.
- The subdivider desk is the decision kit's second production adoption, after the flip desk (`server/routes-flip-decision.ts`, Fix-and-Flip Leg 1) (Leg 3's "Found for Leg 4").

**§6.2, pricing locks: `GET /api/subdivision/parcels/:id/desk`.** Locks are listed with `grading: "ungraded_pricing_act"`. A lock is a pricing act: its record cites no scenario and carries no review date, by design, and the desk never rewrites, back-fills or regrades one.

**§6.3, the loop closes through the existing `GET /api/decisions/due`.** That route takes no pack filter, so a pursue/pass recorded here with a review date is asked for its outcome like any other decision. The desk adds no second queue. The desk read model also reports `hasOutcome` per decision.

**§7, the desk panel: `client/src/components/parcels/subdivision-decision-desk.tsx`.**
- Shows the latest screen run as a fact (not copied into the form), your stated scenario, the record form, decisions and locks, and the entitlement path.
- Every field starts empty and nothing is pre-selected. The record button stays disabled until a kind, a choice, a rationale of at least 10 characters and a review-date answer are all given.
- States "not advice, not a recommendation, no score" and asserts neither.

## Step 0 verdicts and rulings relied on

(Taken from the in-tree docs and the build's own headers, because the scope record was not readable from the writing session.)
- **Ruling 3 (2026-11-05):** operator-stated timelines. The critical path computes over the run's stated p50/p90, not per-gate lead times. The permit templates' `expectedDays` are unsourced constants for four TN counties and are not used.
- **`defer` is dropped (Muse, 2026-11-05):** the decision vocabulary has no `defer`. The desk says "Recording nothing is how you defer", and the route refuses `defer` outright.
- **Locks are ungraded by design (§6.2):** a lock is a pricing act, shown with its true grading state.
- **Decision kit unadopted (Step 0 §2.10–2.11, via Leg 3):** `recordUnderwrittenDecision`, `UnderwritingWorkbench` and the engine-fields file had no production caller. The subdivider desk is the first adopter.
- **No county timelines:** the county-timeline seeds were deleted in 0283 and the table is empty by design. Nothing here reads it.

## What was NOT built

- **The ladder caveat removal (§9.6).** This is Tom's call on proof and is not part of this lane. No ladder or public-claim copy changes here.
- The pursue/pass desk does not pre-fill gross proceeds or land cost from the locked grid or the parcel's purchase price (a Leg 3 intention). Every field is operator-entered, which is what §7.2 requires.
- No second review queue, no per-gate slippage from template constants, no county lead times.

## Test inventory (written, not yet run)

| File | Tests | What it pins |
|---|---|---|
| `tests/unit/subdivisionCriticalPath.test.ts` | 27 | Withheld cases; golden dates (Jan 1 + 30 / 60 → Jan 31 / Mar 2); the position at each boundary (days 0, 29, 30, 31, 60, 61); time-of-day does not move a boundary; slipped-gate rules and ordering; projected finish and signed overrun; no-dates versus no-open-gates reasons |
| `tests/unit/subdivisionDecisionRoute.test.ts` | 21 | §8.4 #15 and #17. Exactly one scenario plus one decision; literal pack `"subdivider"`; the decision cites the scenario; review date as sent; real-engine golden metrics (cost 280,000 / margin 120,000 / profit 118,000); screen evidence frozen, or `screen_state`; missing key, null, past date; `defer` and `offer` refused; cross-tenant 404 (tenant-aware db fake); child lot refused |
| `tests/unit/subdivisionDecisionOutcomeLoop.test.ts` | 6 | §8.4 #16. The real kit and stores over an in-memory db fake: a subdivider decision is returned by `decisionsDueForOutcome` (no pack filter, oldest first, org-scoped, null-date and not-yet-due excluded); interim then terminal outcomes append; the snapshot row, body and scenario are byte-identical before and after |
| `tests/unit/subdivisionDecisionDesk.test.tsx` | 20 | Screen run, bases and unscreened state; locks ungraded; decisions list; critical-path withheld and computed (all positions, slipped gate, signed overrun); record disabled until a review-date answer; only entered fields are POSTed; explicit-null review date; no "recommend" / "score" in any decision block |
| **Total** | **74** | |

**Level pinned for §8.4 #16:** the real store and kit functions over an in-memory db fake that reads each query's rendered WHERE clause and ORDER BY (not a Postgres run). The existing decision tests are source-shape scans, so there was no mocked-db harness to mirror. A predicate the fake does not know is not evaluated.

**Not covered by this stage:** the `GET …/desk` read model has no route-level test of its own (its output is exercised only through the UI test's mocked payload). The desk panel renders a fixed note about locks rather than the payload's `gradingNote` string, so changing `gradingNote` on the server would not change the page.

## Driver verification (2026-11-09, after the writing session)

The batch above has since been run by the driver on this tree: the four suites pass 74/74, and a fifth suite added afterwards — `tests/unit/subdivisionDeskReadRoute.test.ts`, 13 tests pinning the GET desk read model (cross-tenant 404, newest-run selection, decision/lock shaping, the critical-path assembly, the org-scoped gate join) — passes 13/13. Fence suites pass unmodified (statewideLookupClearance, moneyCustodyHardStop, customerMoneyRouting, impossibleDatesAreRefused, repoSweepsDeclareTheirBudget), the subdivision family + kit suites pass 138/138, ratchets all pass with table-count measured 750 = baseline (no new table), and the reachability + date-format lints pass after two driver fixes (house `formatDate` in the panel; two internal-only consts in criticalPath.ts unexported). Two gates remain CI's: the full app typecheck (`check:app` aborts under this VM's memory contention) and the merged-tree bundle figure. The mutation pass listed below has not been run.

## Gates still owed

- `npx vitest run tests/unit/subdivisionCriticalPath.test.ts tests/unit/subdivisionDecisionRoute.test.ts tests/unit/subdivisionDecisionOutcomeLoop.test.ts tests/unit/subdivisionDecisionDesk.test.tsx`
- `npm run check`, redirected to a file and read by exit status, not through a pipe.
- Mutation pass: drop the org predicate from the property read, drop the `reviewDueAt` refine, add `defer` to `KINDS`, drop `notInArray` from the due sweep, change `<=` to `<` in the position test. Each should turn at least one test red.
- The mount and reachability changes that go with the kit's first adoption (the COO-hold exemptions flagged in Leg 3) belong to the build stages, not this one.
