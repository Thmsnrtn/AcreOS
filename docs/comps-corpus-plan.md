# Comps Corpus Plan — turn on geographic, attribute-aware land comps

> **Status: PREPARED, not executed.** A reviewable plan; nothing here runs
> against prod until you approve it. Prepared during the Phase-2 charter work
> (audit: `docs/audit/PLATFORM-AUDIT.md` §7). This is Phase-2 shortest-path #1 —
> the change that lets the valuation stop being demo-grade.

## Why the valuation is demo-grade today

`server/services/acreOSValuation.ts` selects comps from `transaction_training`
by **state + 24-month recency + acreage band only**. There is no geography and
no land-attribute matching, for one root reason: **`transaction_training` has no
lat/long and no attribute columns.** Wave 11 already made the *number* honest
(no fabricated distance, no silent LLM nudge); this plan makes it *good* by
giving the corpus the data real comp selection needs.

Three things are broken or dead around this:
1. **`server/jobs/countyAssessorIngest.ts`** fetches ATTOM comps + tax lists
   nightly — but `registerCountyAssessorIngestJob` / `countyAssessorIngestJob`
   have **zero call sites**, so the corpus feeder never runs. Its tax-delinquent
   fetcher is also a stub returning `[]`.
2. The **GBM "trained model"** has no artifact on disk and its retrain job was
   deleted 2026-08-01 — yet `routes-deals.ts` deal-close comments still cite "the
   weekly retrain + MAE-gated promotion flywheel" as live.
3. The **flagship test** (`tests/unit/acreOSValuation.test.ts`) is a mirror test
   that re-implements a **better** `selectComparables` (haversine + zoning/road
   matching) than what ships, and never imports the production service.

## Guardrails (charter §5)

- Expand-contract migration only; the column adds below are additive and
  reversible. Write the rollback before the migration.
- The valuation path stays deployable at every commit; comp selection degrades
  gracefully to the current state/acreage ranking whenever coordinates are
  absent (Wave 11 already made "distance unknown" first-class).
- **No AI/comp number without provenance** stays true throughout (Wave 11).
- Corpus quality is validated against a domain expert before this is called
  "defensible" — that is the Phase-2 exit gate and it needs real data + a person.

## Steps

### 1. Schema: add geography + attributes to `transaction_training` (expand)
Additive, nullable columns (no backfill required to deploy):
`latitude`, `longitude`, `zip_code`, `zoning`, `road_access`, `flood_zone`,
`slope_percent`, `wetlands_percentage`. All nullable — existing rows stay valid.
- Expand-contract: add columns nullable; nothing reads them until step 3.
- **Rollback:** drop the columns (no data depends on them yet).
- Ship the migration through the generated-migration path once the Wave-10
  cutover has landed — do NOT hand-append to `migrate.mjs` (that is the drift
  class). If the cutover has not landed, this waits behind it.

### 2. Corpus feeder: decide and wire (or delete) `countyAssessorIngest`
Pick ONE, explicitly (this is a founder/cost decision — the parcel-licensing
decision card, ruling #14, governs paid pulls):
- **(a) Turn it on:** register `countyAssessorIngestJob` in
  `server/jobs/runScheduledJobs.ts`, have it **persist the lat/long + attributes
  it already fetches then currently drops**, and replace the tax-list stub with a
  real fetch (or remove that responsibility). Gated on the parcel-licensing
  decision and a spend cap.
- **(b) Corpus-from-closes only:** keep the on-platform deal-close feeder
  (`routes-deals.ts` already writes anonymized `transaction_training` rows) and
  add lat/long + attributes to THAT write path; delete the unregistered
  `countyAssessorIngest` job so nothing pretends it runs.
- Either way: reconcile the stale "weekly retrain flywheel" comments in
  `routes-deals.ts`, and decide the GBM (register a retrain job or delete the
  dead `trained_model` path + its README claims).
- **Rollback:** (a) unregister the job; (b) revert the write-path change.

### 3. Valuation: promote real comp selection
Move the test file's `selectComparables` (haversine distance + zoning/road/
attribute matching) into `server/services/acreOSValuation.ts`, using the new
columns:
- Compute **real distances** — which then flow into `computeConfidence` (Wave
  11), so the proximity bonus is finally earned honestly instead of skipped.
- Weight comps by attribute similarity (zoning, access, flood) in addition to
  acreage/recency.
- Keep the graceful fallback: rows without coordinates rank on the current
  state/acreage signal and report distance `null` (already supported).
- **Convert the mirror test into a real one** that imports the production
  service, and remove `acreOSValuation.test.ts` from the tautology baseline
  (`tests/unit/tautologyTestRatchet.test.ts`) in the same commit.
- **Rollback:** the old ranking is a pure function; keep it behind a flag for one
  release.

### 4. Mechanize against "built but unwired" (audit critique #15)
Add a ratchet asserting every exported BullMQ queue/worker has a registration
call site — the countyAssessorIngest job is exactly the defect this catches, and
it is this repo's single most common failure class.

### 5. Non-linear price-per-acre (follow-up, once the corpus has volume)
With attributes + volume, replace weighted-average `$/acre × acres` with a
bracketed / log price-per-acre curve (small parcels ≠ large parcels linearly).
Derive adjustment coefficients from paired sales rather than the current invented
percentages. This is a later step — it needs corpus volume to be meaningful.

## Definition of done

- `transaction_training` carries geography + attributes; the feeder decision is
  made and wired (or the dead job is deleted).
- Production comp selection uses real distance + attribute similarity; the mirror
  test is a real test and out of the tautology baseline.
- The queue-registration ratchet is green.
- Blind domain-expert review finds the comp quality at least matches incumbents
  (Phase-2 exit gate).

## What needs YOU

- The **parcel-licensing decision** (ruling #14) if you choose corpus option (a)
  — paid county/ATTOM pulls have a cost and a license.
- Real county/close data volume for step 5 and for the exit-gate validation.
- The Wave-10 migration cutover landed first, so step 1 ships through generated
  migrations rather than the drift-prone `migrate.mjs`.
