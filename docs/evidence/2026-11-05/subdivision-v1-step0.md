# Subdivision V1 — Step 0 verdicts (2026-11-05)

Package: `claude-package-subdivision-v1` (Muse, 2026-11-05). Head checked: **main `da74f12`** (#457 squash). Every verdict says how it was established: **read** (code at this head), or **unverified** (needs staging; this session has no staging access — no Fly token, Actions paths refused).

## Premise contradictions (spec stop condition — reported, not built around)

1. **County timelines are not seeded — the table is empty by design.** §0 and §2.8 describe `county_subdivision_timelines` as carrying "seeded planning-office estimates". At this head there are **zero** seed rows:
   - migration `0283_county_timelines_drop_persona_seed.sql` (P1 false-claims sweep, 2026-10-20) deleted all six TN rows, because they came from an AI review persona ("Brigid"), not from any county;
   - `tests/unit/countyTimelinesNoPersonaSeed.test.ts` pins that no seed returns;
   - **no route writes the table** (`routes-county-timelines.ts`: two GETs and the carry-cost POST), and the table is global (no `organization_id`), so an operator cannot enter their own county's timeline either.

   Consequences:
   - every carry projection and every carry-inclusive margin is withheld on every parcel today;
   - §5.5's critical path has no lead-time data to compute over;
   - §10 step 4's "timeline present → both margins compute" leg cannot run on staging without someone inserting a global jurisdiction row, which is §9.3's Tom-blocker;
   - §2.8's grading has nothing to grade.
2. **The standalone screen record cannot ride the existing stores (§9.1 blocker, as the spec anticipated).** Each store was checked:
   - **`scenarios`** is the economics table. Its inputs are a flat `Record<string, number|string>` capped at 40 keys, and its metrics are numbers only. A three-valued verdict carrying evidence and a priced resolution path does not fit honestly. Encoding verdicts as 0/1/null would make a screen read as an economics engine.
   - **`decision_snapshots`** takes only the closed `DECISION_KINDS` set, and a screen is not a decision. Storing screens there would also count them as subdivider decisions.
   - **`evidence_claims`** holds observations. A verdict is a derived projection, and that table's own header rules out storing resolved values.
   - **`subdivision_plans`** exists only where a plan exists, and the screen must run before any plan.
3. **Leg 4's three choices do not map onto the decision vocabulary.** `DECISION_KINDS` is closed: `pursue, pass, offer, acquire, hold, dispose, price, finance`.
   - `proceed` maps to `pursue`, and `pass` maps to `pass`.
   - **`defer` has no kind.** Adding one changes a closed, cross-vertical vocabulary, which calls for a governed change, not a leg detail.
4. **No perc result is stored anywhere** (§2.5). The closest things are:
   - a permit gate's status and notes (`soil_percolation_tests`);
   - SSURGO `septicSuitability`, which is a soil rating, not a test result;
   - the evidence predicate `property.septic_rating`.

   §3.4's "recorded perc result" therefore has no store. A new evidence predicate is code, not a table, so it is buildable. It is named here because §3.4 assumes a record exists.

## Step 0 items

| # | Item | Verdict |
|---|---|---|
| 1 | Head and census | **Read.** main `da74f12`; newest migration block `0300`; `table-count` at 748 (strict, down-only). `scenarios` and `decision_snapshots` exist in the schema. Staging row presence is **unverified**. |
| 2 | Foundation | **Read.** Seven SD-1 tables as named: `subdivision_plans`, `permit_checklists`, `permit_gates`, `lot_basis_allocations`, `lot_pricing_rules`, `county_subdivision_timelines`, `cc_r_templates`. `properties.parent_parcel_id` is a self-FK with `ON DELETE SET NULL`, alongside `child_lot_number`. **Staging row counts are unverified** (no staging access). |
| 3 | Endpoints and surfaces | **Read.** **Seven** registered modules, not three: subdivisions, lot-basis, subdivision-plans, permit-tracker, lot-pricing, county-timelines and ccr-template (`routes.ts` 2462–2474). Every route is `isAuthenticated` + `getOrCreateOrg` and org-filtered. **No client caller** for `GET /api/parcels/:id/pro-forma`, `POST /api/parcels/:id/carry-cost`, `PATCH/DELETE /api/lots/:childId` or `realize-cogs`, so the pro-forma is built but unwired. The sidebar module is gated `["subdivider","developer"]` (`layout-sidebar.tsx:638`). The parcel-detail Subdivision tab and the four pages are **not** persona-gated. developer→subdivider mapping: `shared/models/persona-mapping.ts:71-72`. |
| 4 | Calculator contracts | **Read.** `computeProForma` has one caller (the unwired pro-forma route). `computeRollup` imports nothing from `shared/subdivision/`: it re-derives basis (the same formula appears in four places), sums `soldPrice` rather than realized COGS, and breaks even on `listPrice` rather than the locked grid. Its header promises an "IRR placeholder" that does not exist. The legs must not add a fifth copy. |
| 5 | Parcel facts (the screen's evidence base) | **Read.** Per fact: **access** is `properties.roadAccess` text plus DD booleans, with provenance only on owned-pipeline facts (TN); **flood**, **wetlands** and **soils** sit in `enrichmentData` with `{source, asOf}`, plus evidence predicates; **slope** comes from `terrain.ts` (USGS 3DEP, not stored) and `properties.terrain` text, while LandProfile's terrain variant has no caller; **easements** are only in DD checklist/dossier JSON with no provenance; **zoning** is text with **no minimum-lot fact**; **water/sewer** are `properties.utilities` booleans with no provenance; **perc** has no field (contradiction 4). |
| 6 | Decision link (0234) | **Read.** The lot-pricing lock writes a `decision_snapshots` row under pack `subdivider` with a frozen rule set and alternatives. It cites **no scenario**, and `reviewDueAt` is null **deliberately**: the code comment (`routes-lot-pricing.ts`) argues the outcome vocabulary fits a single position resolving, not N lots selling. Leg 4's delta is both a scenario citation and a review date, on a go/no-go decision rather than on the price lock. |
| 7 | Entitlement critical path | **Read: absent.** Nothing joins `permit_gates` to timelines. "Stalled" is computed in four places with two different comparisons. Templates are code constants: four TN counties (Williamson, Hickman, Maury, Davidson) plus a generic one. `POST /api/parcels/:id/permits` instantiates a checklist without checking that the template's state matches the parcel's. |
| 8 | Timeline seed grading | **Nothing to grade** (contradiction 1). |
| 9 | Storage | **Blocker for the standalone screen record** (contradiction 2). Feasibility runs fit `scenarios` through a registered engine. Decisions fit the kit. |
| 10 | Engine registration | **Read.** `rentalAcquisition` is an `EngineSpec` with `verticals: ["buy_and_hold"]` and a fields file at `shared/economics/fields/rentalAcquisition.ts`, aggregated by `server/services/economics/engines/index.ts` into `ALL_ENGINES`. `previewUnderwriting` accepts any engine that declares a vertical. Inputs are bounded to 40 flat keys, so phases and sensitivity have to fit that envelope. |
| 11 | Outcome loop | **Read.** `decisionsDueForOutcome` filters on org, a non-null `reviewDueAt` that is due, and the decision not yet resolved. **No pack filter**, so a subdivider decision surfaces. `REVIEW_CHOICES`: 14, 30 or 90 days, or "No set date", so the smallest honest offset is 14 days and the §10 step 7 outcome is a dated open leg. The outcome kinds (`acquired, sold, offer_accepted, offer_rejected, abandoned, still_open`) can express a go/no-go outcome. |
| 12 | Lookup-gate touchpoints | **Read.** No subdivision module calls `parcel.ts` lookups. Intake is the org's own `properties` row. LandProfile assembly (`GET /api/properties/:id/land-profile`) is the only enrichment surface near the subdivision tab; whether its providers ride the statewide gate is a separate path from the gated `parcel.ts` and is listed for the Leg 1 build to check. |

## Rulings received (2026-11-05)

Recorded in `docs/company/founder-decisions-2026-11-05-subdivision.md`.
- **Q1, screen storage: Tom approved +1 table, `subdivision_screen_runs`** (append-only, migration 0301 — renumbered 0304 on 2026-11-08, behind #461 0301, #463 0302 and #459 0303). `table-count` goes from 748 to 749.
- **Q2, defer: dropped** (Muse). The desk records `pursue` or `pass`; `DECISION_KINDS` is unchanged.
- **Q3, timelines: operator-stated per run** (Muse). The global table stays empty. The §0/§2.8 premise correction is recorded.

## Legs 1–2 as built (one PR)

The screen run freezes the yield estimate that its sub-minimum-yield trigger reads, so the two legs share storage cleanly, and §1 allows them to share a PR.

**Corrections and limits stated in the code:**
- **Yield range ends (§4.1).** The spec calls the minimum-lot basis "low" and the target basis "high". Dividing by the *minimum* lot yields the *most* lots, so the build computes each end for what it is: low = smaller net ÷ larger lot, high = larger net ÷ smaller lot. Each end names its basis.
- **Facts come from the operator.** Step 0 §2.5 found almost none of the trigger facts stored with provenance. v1 therefore reads every fact as the operator records it on the run, with its source and as-of, frozen verbatim. A value without a source is refused, not recorded. No enrichment or lookup is consulted (§7.3).
- **Soil-rule septic infeasibility (§3.4's "stated infeasibility rule") is not built.** The septic trigger reads a recorded perc result or a sewer-availability fact. The perc-estimate slot is typed and always null, and the route refuses any value in it.
- **The §3.5 portfolio chip is not built.** "Screen-stale-on-newer-facts" cannot be defined while facts live only on runs. The panel's run history is the v1 surface.

## Independent audit (2026-11-05): findings and dispositions

1. **Fixed: a target lot below the stated minimum hid the sub-minimum-yield trigger.** The stated minimum is now a floor: a smaller target is never divided by, and the basis says so. Tested in both the yield and screen suites.
2. **Fixed: the panel silently dropped a value with no source.** Each field is now refused by name: a value with no source, a source with no value, or a number that does not parse. The run is disabled until the field is fixed or cleared. A minimum lot with no citation is refused the same way.
3. **Fixed: resolution paths were the same whatever was missing.** A missing threshold or gross acreage now resolves as "state … for this run (free, now, you)". A missing fact about the land keeps its priced path.
4. **Fixed: the "unknown is not clear" tests covered too little.** They now remove, one at a time, every fact a clear verdict requires, across the clean, perc-only, sewer-only and no-floodplain bases. Both mutants the auditor named go red.
5. **Fixed: drawn counts were not frozen.** Each run freezes `drawnPlansAtRun` and returns `reconciliationAtRun`. The panel shows both "At this run" and "Today" lines.
6. **Fixed: the no-write scan was narrow.** It now covers `server/` and `scripts/`, aliases, schema namespaces and raw SQL in any quoting, with a canary for each shape.
7. **Fixed:** the gross acreage's source and every deduction's as-of now render; the empty and error states use `EmptyState` and `QueryErrorState`; and every "Source" and "As of" field carries a screen-reader label naming its fact.
8. **Partly fixed (item 9):**
   - Fixed: a strict numeric id (`42abc` is refused); a child lot is refused with "screen its parent"; and a cap of 50 runs, with a "showing the newest 50" notice.
   - **Not done:** staleness against a stated as-of (free text in v1), and limiting the floodway trigger to the buildable area. The flood trigger stays conservative: any floodway acreage fires it.
9. **For Muse to accept explicitly:** the §3.5 portfolio chip and the soil-rule septic infeasibility are not built.
