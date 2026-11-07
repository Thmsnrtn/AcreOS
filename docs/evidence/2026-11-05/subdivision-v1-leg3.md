# Subdivision V1, Leg 3: feasibility engine (2026-11-05)

Branch `claude/subdivision-leg3-feasibility`, off main `4b2044b`. The Step 0 verdicts are in PR #462's `subdivision-v1-step0.md`, and the rulings in `founder-decisions-2026-11-05-subdivision.md`. This leg runs under ruling 3: the timeline is operator-stated for each run.

## What it adds

**Pure module: `shared/subdivision/feasibility.ts`** (`subdivision-feasibility v1`).
- Adds the operator's hard and soft cost lines to the pro-forma's land and carry. The wastewater path decides which line applies: a sewer project marks septic "not applicable", and vice versa.
- **Refuse per line.** An absent line refuses its section by name, along with every figure that sums it. A stated 0 computes and is labelled "stated zero". A cost entered on the line that does not apply is refused.
- **Carry runs over the operator's own p50/p90 timeline**, using the existing `projectCarryForMonths`. With no timeline stated, the carry, both carry-inclusive margins and the IRR are withheld by name. The before-carry margin is still reported.
- **IRR** is solved over monthly cash flows paced by the operator's absorption. The cash flows are returned with the result so the IRR can be checked.
- **Phases** are the operator's own, allocated by lot count.
- **Sensitivity grid:** lot price ±10% and ±20%, pace ±25%, infrastructure ±15%. Each cell is recomputed from the same snapshot.

**Engine: `subdivision_feasibility`** (`server/services/economics/engines/subdivisionFeasibility.ts`).
- Declares `verticals: ["subdivider"]`; it is the only engine that does.
- Registered in `ALL_ENGINES`.
- Every modelling choice and substitution is declared as an assumption with its origin and basis:
  - cost timing, the pace (yours, not a forecast) and the phasing;
  - the wastewater path;
  - the timeline ("your own … not a county figure");
  - omitted debt or opportunity carry ("not entered — excluded").
- The existing `POST /api/scenarios/preview` serves it unchanged.

**Three metrics added to the closed registry:** `margin_before_carry`, `margin_after_carry_p90` and `margin_per_lot`. `profit` is the margin after p50 carry, and is null when no timeline is stated. It is never the before-carry figure.

**Route: `POST /api/scenarios/subdivision-feasibility/sensitivity`** returns the §5.3 grid and records nothing.

## §5.5, the entitlement critical path: moved to Leg 4

Ruling 3 decides the shape: the critical path "computes over the run's stated timeline, where one is stated". That is elapsed time against the run's own end-to-end p50/p90, not per-gate slippage. No honest per-gate lead time exists:
- the operator states one end-to-end timeline per run;
- the permit templates' `expectedDays` are unsourced constants for four TN counties.

Leg 3 persists no run (preview only), so there is no stated timeline for a checklist to read until the Leg 4 desk freezes one on the decision's scenario. The computation therefore ships in Leg 4, beside the desk:
- the expected completion is the checklist's first submission plus the stated p50/p90;
- the overrun is the days past each.

Per-gate slippage from the template constants is not built.

## Inputs the desk fills (Leg 4)

Gross proceeds and land cost are free inputs here. On the Leg 4 desk they come from the locked pricing grid's total and the parent's purchase price, server-side, with the origin declared. The wastewater path is an operator input, not read from the §3 screen.

## Found for Leg 4 (Step 0 §2.10–2.11, refined)

The decision kit is unadopted, and it is held on main:
- `recordUnderwrittenDecision`, `UnderwritingWorkbench` and `RENTAL_ACQUISITION_FIELDS` have no production caller.
- `scripts/ratchets/reachability.json` exempts them under a **COO HOLD (2026-10-21)**, with `buyAndHoldStaysHeld.test.ts` pinning that nothing mounts the buy-and-hold route.

The subdivider desk would be the kit's **first production adoption**. Mounting it makes those exemptions stale, so they would be removed in the same PR. That is a visible change to a COO hold, so it is flagged now for Muse rather than discovered in Leg 4. The engine fields file (the desk's form) moves to Leg 4 with the desk, so this PR adds nothing unwired.

## Gates (run here)
- `check:app` exits 0, and every `npm run check` sub-gate passes, plus `lint` and `lint:voice`. The `internalOnlyExportsShared` reachability baseline is lowered from 420 to 419: `projectCarryForMonths` now has a caller in another module.
- New tests: 32. Golden case: the hand arithmetic, and an IRR solved independently and checked by NPV. Long-horizon IRRs and one sensitivity cell's IRR were also solved independently.
- Mutants: 7, plus 5 on the audit fixes, all red.
- Related batch: 46 files, 656 tests, including `verticalReadiness`, `scenarioDeterminism`, `statewideLookupClearance` and `moneyCustodyHardStop`.
- Build passes. Bundle 9,798 KB: no client change.

## Independent audit (2026-11-05): findings and dispositions

1. **Blocker, fixed: an unbounded pace or timeline could loop without end.** Lots are now capped at 10,000, a timeline at 3,650 days, and entitlement plus sell-out at 600 months. Each limit is refused before any loop, and a test pins that refusal is instant.
2. **Fixed: the IRR was wrongly withheld on long horizons.** The solver now works over [−50%, +1,000%] a month, so NPV stays finite at every allowed horizon. Each failure has its own reason. A 144-month IRR and a 184-month IRR are now tested against independent solutions.
3. **Fixed: a debt principal with no rate was costed at 0% interest.** It is now refused; a stated 0 is accepted.
4. **Fixed: `normalisedInputs` stored the raw request.** Unknown keys are now refused, and only consumed keys are stored.
5. **Fixed: phases did not re-add.** Phases now use largest-remainder allocation, so every column re-adds exactly, and they carry per-phase carry and margin after carry. They are tested.
6. **Fixed:** a p90 shorter than the p50 is refused.
7. **Fixed: engine choices were mixed into the operator's assumptions.** Seven are now separate assumptions with origin `derived`: cost timing, sale price model, sales start, carry spread, IRR timeline, opportunity-cost basis and phase allocation. The operator-stated rows hold only what the operator stated.
8. **Fixed: the §5.5 write-up.** It is rewritten to ruling 3; see above.
9. **Fixed: the sensitivity route had no test.** It is now tested for auth, the 400 mapping and recording nothing, and the route header is updated.
10. **Fixed: `total_cost` would have been misread by the outcome loop.** It is no longer emitted. The project cost is `project_cost_before_carry`, because the outcome loop reads `total_cost` as acquisition cost.
11. **Fixed: test gaps.** Now covered: remainder lots, a timeline that is not a whole number of months, the null-IRR path, a p90-only run, a refused section inside the sensitivity cells, extra keys, the debt-rate refusal, phases, and IRR magnitude.
12. **Fixed: nits.** Cash flows are whole cents that re-add exactly to gross proceeds and to carry, and `hold_months` equals the cash-flow horizon.
