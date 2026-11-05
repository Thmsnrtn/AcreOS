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

## Not built in this PR

**§5.5, the entitlement critical path.** It needs a per-gate lead time to compute anything. Under ruling 3 the operator states one end-to-end p50/p90 per run, and no per-gate figure. The only per-gate figures on main are the permit templates' `expectedDays`, and those are code constants for four TN counties with no source. Computing a critical path or slippage from them would present an unsourced timeline as fact, which §7.2 forbids.

There are two honest shapes. Muse should pick one:
- **(a)** Take operator-stated per-gate lead times on the run, then compute expected completion and slippage over them.
- **(b)** Report elapsed time against the run's own end-to-end p50/p90 only.

## Found for Leg 4 (Step 0 §2.10–2.11, refined)

The decision kit is unadopted, and it is held on main:
- `recordUnderwrittenDecision`, `UnderwritingWorkbench` and `RENTAL_ACQUISITION_FIELDS` have no production caller.
- `scripts/ratchets/reachability.json` exempts them under a **COO HOLD (2026-10-21)**, with `buyAndHoldStaysHeld.test.ts` pinning that nothing mounts the buy-and-hold route.

The subdivider desk would be the kit's **first production adoption**. Mounting it makes those exemptions stale, so they would be removed in the same PR. That is a visible change to a COO hold, so it is flagged now for Muse rather than discovered in Leg 4. The engine fields file (the desk's form) moves to Leg 4 with the desk, so this PR adds nothing unwired.

## Gates (run here)
- `check:app` exits 0, and every `npm run check` sub-gate passes, plus `lint` and `lint:voice`. The `internalOnlyExportsShared` reachability baseline is lowered from 420 to 419: `projectCarryForMonths` now has a caller in another module.
- New tests: 21. Golden case: the hand arithmetic, and an IRR solved independently and checked by NPV.
- Mutants: 7, all red.
- Related batch: 46 files, 656 tests, including `verticalReadiness`, `scenarioDeterminism`, `statewideLookupClearance` and `moneyCustodyHardStop`.
- Build passes. Bundle 9,798 KB: no client change.
