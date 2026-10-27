# D2d integration notes (lane D2d: self-healing source adapters)

This lane changed only the files it owns. These notes are proposals for
**shared or other-lane files**, plus findings the owners of those files should
know. The integrator applies the proposals, or decides not to.

## Observation-shape contract (task 3): confirmed, with three gaps

What the statewide handler (`server/services/etlHandlers.ts`) writes to
`etl_runs.observation`:

| Run                                   | Observation                                         | `remap`                          |
|---------------------------------------|-----------------------------------------------------|----------------------------------|
| Success, no drift                     | `{ ...CountyBuildReport, remap: null }` (finalize)  | `null`                           |
| Success after a promoted heal         | `{ ...CountyBuildReport, remap: RemapAttempt }`     | `outcome: "promoted"`            |
| Failure: heal rejected / no proposal  | `{ kind: "statewide_cadastral_drift", remap }` (`runState.failureObservation`, written by the orchestrator) | `outcome: "rejected" \| "no_proposal"` |
| Failure: any other error              | `null`                                              | n/a                              |

`foldRemapRates` (`server/services/ops/dataOpsMetrics.ts`) reads
`observation.remap.outcome`. That matches both the success shape and the
failure shape.

`tests/unit/adapterRemapObservation.test.ts` locks this contract in place:

- It feeds **real** `healDrift` outputs, wrapped in both shapes and
  round-tripped through JSON, into the real `foldRemapRates`.
- It pins the handler's and the orchestrator's write sites by source scan,
  with comments stripped first.
- It pins `healDrift`'s population to exactly one production caller.

### Gap 1: a promoted heal whose rebuild fails is lost (etlHandlers, integrator-owned)

After a promotion the handler calls `buildCounty(...)` again. If that rebuild
throws (upload, paging, RSS ceiling), the run fails. `failureObservation` was
never set, so the run's observation is `null`. The promoted attempt and its
evidence are not recorded. The rate under-counts promotions, and the next run
re-heals from the seed or the older mapping.

Proposed change (`statewideCadastralEtlHandler`, inside the `catch`):

```diff
         if (remap.outcome !== "promoted" || !remap.mappingAfter) {
           // The refusal stands, unchanged; the attempt is kept in the failed run's observation.
           if (opts.runState) opts.runState.failureObservation = { kind: "statewide_cadastral_drift", remap };
           throw err;
         }
+        // A promoted heal is recorded even if the rebuild below fails.
+        if (opts.runState) opts.runState.failureObservation = { kind: "statewide_cadastral_drift_rebuild_failed", remap };
         report = await buildCounty(buildSpecFor(state, remap.mappingAfter), config, deps());
       }
```

Consequence: `activeMappingFromRuns` would then adopt that promoted mapping
from a *failed* run. The mapping passed golden verification and the failure
was the rebuild's, so this is the intended reading. If the COO prefers "adopt
only from a successful run", `loadActiveMapping` should filter
`etlRuns.status = 'success'` instead. That file is mine, so say which.
`adapterRemapObservation.test.ts`'s source pin matches the existing
`failureObservation = { kind: "statewide_cadastral_drift", remap }` line, so
this diff keeps it green.

### Gap 2: `latestOutcome` is never assigned (dataOpsMetrics, lane D2g)

`JobRemapRate.latestOutcome` is initialized to `null` and never set, so the
ops page always shows `null`. Rows arrive newest-first. Proposed fix in
`foldRemapRates`:

```diff
     if (remap?.outcome) {
       j.attempts += 1;
+      if (j.latestOutcome === null) j.latestOutcome = remap.outcome;
       if (remap.outcome === "promoted") j.promoted += 1;
```

D2g's own test (`tests/unit/dataOpsMetrics.test.ts`) does not assert
`latestOutcome`. It should, so that this field cannot silently read `null`.

### Gap 3: what the "auto-remap rate" denominator is (question, D2g)

`promotionRate = promoted / runs`. That measures how often a source needs
healing, which is the "a source that remaps often is a source to replace"
signal. It is not the heal success rate (`promoted / attempts`). Both are
derivable from the fields already returned. The COO should name which one is
"the" ops metric.

## Findings for files other lanes own

1. **A same-name type change is not drift** (`statewideCadastral.ts`,
   D2a/D1b). Conformance compares field names only. When `JV` goes from
   double to string under the same name, the build does not stop. This is
   benign today: `sourceNumber` parses numeric strings, and fixture
   `06-type-change-same-name` proves all five golden parcels still reproduce.
   A value field that turned into a coded or formatted string, for example
   `"100K"`, would instead read as `null` silently.
2. **`SchemaDriftError` does not carry the layer's `objectIdField`**
   (`statewideCadastral.ts`). Some services report the object id as
   `esriFieldTypeInteger` instead of OID. That object id can be *proposed* as
   the parcel key (fixture `19-objectid-as-integer-alias-trap`). Golden
   verification rejects it, because no golden parcel id is an object id, so
   nothing wrong is promoted. Excluding the object id at proposal time would
   need `SchemaDriftError` to carry `objectIdField`. Proposed: add
   `readonly objectIdField: string | null` to the constructor and pass
   `meta.objectIdField` from `streamCounty`. `proposeRemap` would then drop
   that field from the candidates. This is not applied, because the file is
   not mine.
3. **A promoted remap outlives a seed correction** (design question). The
   active mapping is the newest promoted remap, and it wins over the seed
   indefinitely. If a later commit corrects the seed's field map, the old
   promoted remap still overrides it. Options:
   (a) store the seed mapping's hash in `RemapAttempt` and adopt only when it
   equals the current seed's hash;
   (b) accept it as is.
   I recommend (a). It is a small change in `adapterRemap.ts` plus
   `buildSpecFor`, and I left it for COO direction.
4. **`loadActiveMapping` reads the newest 200 runs.** After more than 200
   runs without a promotion, the mapping silently falls back to the seed,
   drifts, and re-heals. This is safe, because the heal re-verifies against
   golden, but it inflates the rate. The fix is a `WHERE` on
   `observation->'remap'->>'outcome' = 'promoted'`, which needs raw SQL under
   the raw-SQL ratchet, so I left it.

## No DDL, no migrations, no money-adjacent change

This lane needs no table. It touches nothing related to billing, credits or
pricing.
