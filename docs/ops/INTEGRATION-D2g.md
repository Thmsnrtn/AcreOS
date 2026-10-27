# D2g — integration proposals (shared files; the integrator applies)

D2g changed only its own files. `server/routes.ts` needs **no change**:
`registerOpsRoutes` is already mounted, and the `/api/ops/data` handler is
unchanged; it serves the new fields through `loadDataOpsMetrics`. The proposals
below are for files D2g does not own.

## 1. `scripts/ratchets/reachability.json`: two new test-seam exports

`foldCoverageByState` has a production caller (`loadDataOpsMetrics`), but the
existing D2g entries show the ratchet counts module-internal use as no import.
If the ratchet flags them, add entries next to the existing D2g ones:

```json
{
  "kind": "export",
  "id": "server/services/ops/dataOpsMetrics.ts::foldCoverageByState",
  "reason": "TEST SEAM (D2g, 2026-10-24). Pure fold loadDataOpsMetrics applies to county_discovery_queue groups; exported so dataOpsMetrics.test.ts pins owned/known/parcels per state with the stated denominator and the every-county-in-one-bucket invariant. REVOCATION: when a production module imports it, remove this entry."
},
{
  "kind": "export",
  "id": "server/services/ops/dataOpsMetrics.ts::foldReleaseInventory",
  "reason": "TEST SEAM (D2g, 2026-10-24). Pure fold over D2b release rows, applied by loadDataOpsMetrics only when a release reader is passed; exported so dataOpsMetrics.test.ts pins newest-first, current-conflict reporting and malformed vYYYY.MM.N names. REVOCATION: when D2b's reader is wired and a production module imports it, remove this entry."
},
{
  "kind": "export",
  "id": "server/services/ops/dataOpsMetrics.ts::RELEASE_INVENTORY_NOT_BUILT",
  "reason": "TEST SEAM (D2g, 2026-10-24). The not_built inventory the endpoint serves until D2b's store exists; exported so dataOpsMetrics.test.ts pins that an absent store is not an empty list. REVOCATION: when the D2b reader is wired, un-export it."
}
```

## 2. Wiring D2b's release reader (after D2b lands)

`loadDataOpsMetrics(now, windowDays, releases?: ReleaseReader)` takes an
optional reader `() => Promise<ReleaseInventoryRow[]>`, where each row is
`{ releaseId, name, createdAt (ISO string), current, countyCount, parcelCount }`.
To wire it, change the `/api/ops/data` handler in `server/routes-ops.ts`:

```diff
-      return res.json(await loadDataOpsMetrics(clock.now(), days));
+      const { listReleasesForOps } = await import("./services/<D2b release module>");
+      return res.json(await loadDataOpsMetrics(clock.now(), days, listReleasesForOps));
```

`listReleasesForOps` should return platform-wide release metadata only. A
release is not tenant data, but if D2b's table carries an org column, project it
out. The endpoint test's projection allow-list does not cover D2b's table; add
its expected columns to `ALLOWED` in `tests/unit/dataOpsMetrics.endpoint.test.ts`
when wiring. Once wired, revoke the `foldReleaseInventory` and
`RELEASE_INVENTORY_NOT_BUILT` reachability entries.

## 3. Two cache lanes write no `answering_layer` (not D2g's files)

`server/services/parcel.ts` (≈L833, `cacheLane: "parcel_snapshots"`) and
`server/services/data-cache/lookup-cache.ts` (≈L155, `cacheLane: "cached_lookups"`)
call `recordLookup` with `cached: true` and **no `answeringLayer`**, so today
their rows land in `fallThrough.unattributed.cachedFlag` instead of in
`warehouse`. Proposed fix, owned by whoever owns those files: add
`answeringLayer: "cache", intentClass: <category>` to both calls. The vocabulary
test will then see two more literal sites, both already bucketed. After the fix,
`warehouseCost.cacheFlaggedWithoutLayer` should trend to zero for new rows.

Related: `server/jobs/dataSourceProbe.ts` writes probe rows with no layer. That
is correct, because they are not demand. The fold excludes them by
`provider_name 'probe:*'`.

## 4. No DDL, no migrations, no money-adjacent changes.
