# Notes V2 Leg 2 — workout NPV comparison (2026-11-05)

Package: `claude-package-notes-v2-2026-11.md`, Leg 2. Built off main `da74f12`.
The spec's §0 was verified on `f7f2e3f`; only #457 (parcel ingest) landed in
between, and it touches no file in this package.

**Traceability.** This lands gap 3's workout half: "workout net-present-value
engine (modify vs foreclose vs deed-in-lieu, by state cost/timeline)". It is
the economics on the existing loss-mit case file. Per §8, state cost and
timeline are operator-entered.

## Step 0 verdicts (Leg 2 items)

| Item | Verdict |
|---|---|
| §2.1 head + census | Main `da74f12`. The newest migration was 0300, and this leg adds 0301. Table count is unchanged at 748, the table-count ratchet passes, and **no new table** is added. |
| §2.3 spine extension | Migration 0301 widens the `note_events` CHECKs only: a new category `analysis`, the type `workout_analysis_run`, and the source `workout_engine`. The new `note_events_source_matches_category` binds the source to the category both ways. The append-only triggers are untouched. The V1 shapes validate as before (`noteEvents.realdb.test.ts` passes unchanged, and 0301 tests the V1 inserts directly). |
| §2.5 loss-mit state | `note_loss_mit_cases` / `_actions` exist with no economics. Case opening is manual only (`POST /api/notes/:id/loss-mit-case`). A run reads the open case to name it, and never writes to it. |
| §2.6 yield + payoff precedent | Runs follow the `note_payoff_quotes` pattern: the full input snapshot and the engine version on every record. The yield endpoint is untouched. |
| §2.9 storage | Runs ride the `note_events` spine (category `analysis`), not the case's action log. The action log is a mutable table with a free-text `notes` column. The spine is append-only by trigger, org-private, and carries jsonb `detail` / `source_ref`. |
| §2.10 foreclosure data | **No cited mortgage-foreclosure timeline or cost data exists in the repo.** `taxLienStateRules.ts` covers tax-sale redemption, not mortgage foreclosure. `content/learn/note-investing/*.json` is educational. `statuteRegister.ts` names SCRA only. So the foreclosure and deed-in-lieu timelines and costs are **operator-entered, labelled as such**, with an optional citation field. Nothing is presented as a state's law. |

## What was built

- **`shared/notes/workoutEngine.ts`.** The one pure engine, `workout-engine v1`.
  - It compares six paths in a fixed neutral order: hold/perform, modification, forbearance, deed-in-lieu, foreclosure, charge-off/hold-for-exit.
  - Each path returns its line-item cash flows (period, in, out, net, discounted, components), its stated assumptions, and any forgiven or uncollected amounts as facts.
  - It returns a sensitivity grid: collateral value ×0.8–1.2 and timeline ×0.75–1.25.
  - The conventions travel on every run.
  - A path with unstated inputs is `not_stated`. A path missing a required input is `refused` and names the input.
  - The output has no recommendation, rank or score field.
- **`server/services/notes/workoutAnalysis.ts`.** It assembles a run:
  - **Recorded inputs:** balance, rate and payment come from the note record, with the same provenance chips V1 shows.
  - **Operator-stated inputs:** arrears (AcreOS records no arrears amount), the discount rate (no platform default), costs, and the scenario terms.
  - **Collateral value basis:** the warehouse market value, or an operator-stated value with the warehouse value kept beside it.
  - It appends exactly one `note_events` row per run. Superseding names the earlier run and keeps it.
  - `getWorkoutRun` re-runs the engine on the stored snapshot (the reproduction check).
- **`server/routes-note-workout.ts`.** It serves `POST`, `GET list` and `GET one` on `/api/notes/:id/workout-analyses`. The guard is the same as the note record's (owner/admin). Another org's note gets a 404.
- **`client/src/components/notes/NoteWorkoutAnalysisPanel.tsx`.** It sits on the note page under the loss-mit card. It has an inputs form, a provenance column for every input, paths in the engine's order, expandable cash flows that re-add to the NPV, the sensitivity grid, and earlier runs kept. Copy: "It is not advice, and running it changes nothing on the note or its loss-mit case."

## Proof

| Spec test | Where | Result |
|---|---|---|
| 7: hand-computed golden case, to the cent | `workoutEngine.test.ts` against `shared/notes/golden/workout-golden.expected.json` | All six NPVs and every discounted line match. The expected file is produced by `workout-golden.compute.py`: independent Python Decimal arithmetic, not this engine. The columns re-add to each NPV. |
| 8: missing-input refusal | `workoutEngine.test.ts` | Removing each input refuses exactly the affected paths and names the input. Removing the discount rate, balance, rate or payment refuses the whole run. |
| 9: snapshot integrity | `workoutAnalysis.realdb.test.ts` | After `UPDATE acquired_notes` changes the balance, rate and payment, the stored run reproduces. A new run differs, and the superseded run is kept. |
| 10: sensitivity | `workoutEngine.test.ts` | The direction and the discounted magnitude are right, and spot cells match the independent arithmetic. |
| 11: claims shape | `workoutEngine.test.ts` | A structural key walk finds no recommend/best/score/rank/winner key (vacuity floor: more than 50 keys read). Path order holds when the largest NPV changes path (vacuity checked). |
| 18: cross-tenant | `workoutAnalysis.realdb.test.ts` | Org B cannot create, list or read runs on org A's note, and org A's runs are unaffected. |
| Write set | `workoutAnalysis.realdb.test.ts` | One run appends 1 analysis row and nothing else. The open case's row is byte-identical, and no action rows or note changes are made. |
| 0301 constraints | `workoutAnalysis.realdb.test.ts` | Analysis rows refuse UPDATE/DELETE. The source↔category binding is refused in both directions, and the type↔category binding holds. |
| Reproduction is not decoration | `workoutReproduction.test.ts` | Changing one cent in any path gives `differs`, and so does a changed input. Reordered keys still `reproduces`. Another engine version is named. |

**Mutants, each caught and then restored.**
- Discount off by one period: 10 failures.
- Floor rounding: 8 failures.
- Servicing cost dropped: 5 failures.
- A run that writes the open case's summary: the write-set test fails.

**Real-database finding fixed during the build.** Postgres `jsonb` does not keep key order, so a stored run never `JSON.stringify`-matched its recomputation. The reproduction check now compares canonical JSON (keys sorted at every depth).

## Gates (local, 2026-11-05)

- **`npm run check`:**
  - `check:app` (tsc) exits 0.
  - Every other step of the chain was run individually and each exits 0. Fixes made: no raw `res.status`, unneeded exports dropped, one documented test seam allowlisted, `Verbs.CANCEL`.
  - **`check:tests` could not run here.** tsc was SIGKILLed (exit 137) on this 8 GB, no-swap container. The gate refuses to report a count from a killed run, so its figure (baseline 151) comes from CI.
- **vitest.**
  - The affected population: 103 files and 1,120 tests touching notes, events, routes, migrations, schema, reachability, the custody and 1099 ratchets, and the constitution. They ran against a real Postgres 16 schema built from the repo. The one failure, the route manifest, was fixed: the route was added to `server/routeManifest.ts` and the snapshot gained exactly one line.
  - **The full suite could not finish on this 2-core container**, so the full count comes from CI.
- **Custody and tax ratchets** (`moneyCustodyHardStop`, `customerMoneyRouting`, `bookkeeping1099`) are in the population above, unmodified and green. No tax file is touched.
- **Build.** It passes. Total JS is **9,816 KB against the 9,823 KB ceiling**. Main is 9,798 KB, so the delta is +18 KB: the new panel plus the engine's `CONVENTIONS` constant it renders. There is no duplication. Headroom is now 7 KB.

## Fences held

- No sends, no notices, no case changes.
- No money movement and no payment surface.
- No tax output. Forgiven or uncollected amounts are facts only, and a test asserts no 1099/taxable text.
- No new table.
- No recommendation, and no leg triggers another. Leg 1 does not exist yet, and nothing here opens or reads a ladder.

## Staging proof (§10): owed after merge, not claimed here

The golden workout case runs on staging and reproduces the fixture's NPVs. One
run is stored, the note is edited, and the run reproduces. The sensitivity grid
renders, and a missing-value note refuses the affected paths by name.
**Atlas row (proposed):** "Notes — workout NPV comparison present; evidence
model on staging" — only once that staging proof is recorded.
