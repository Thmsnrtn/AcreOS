# INTEGRATION — lane D2a (TN bounded loader, TX refusal, dossier drafts)

Proposals for files this lane does not own. Apply in order; each is
independent of the others. No table, no migration, no money-adjacent change.

## P1 — `server/services/landData/ownedParcelStore.ts`: one canonical "complete a batched county load"

**Why.** The bounded TN build keeps a county's parcels in batches
(`saveOwnedParcels` per batch of 500) instead of one `persistLoadedCounty`
call holding the whole county. The coverage-row completion + receipts +
IndexNow step that `persistLoadedCounty` does after saving has no exported
form that takes a *count* instead of the parcels, so
`scripts/land-data/build-tn-showcase.ts` (`databaseStore().complete`) carries
an interim copy of `loadOwnedCounty`'s coverage update. That is a second
implementation of a canonical write — fold it back:

**Before** (current): the private `loadOwnedCounty(target, parcels)` (saves, then
inserts/updates the `countyDiscoveryQueue` row) and the exported
`persistLoadedCounty(target, parcels, receipts)` (calls it, records receipts,
announces to IndexNow).

**After** — replace both with exactly this (the coverage-update body is moved
verbatim, not rewritten):

```ts
/** Mark a county's coverage row complete with the number of parcels kept. */
async function markOwnedCountyComplete(target: OwnedTarget, stored: number): Promise<void> {
  const state = target.state.toUpperCase();
  const county = normalizeCountyName(target.county);
  await db
    .insert(countyDiscoveryQueue)
    .values({ state, county, status: "resolved", lastResult: `loaded from ${target.sourceName}` })
    .onConflictDoNothing();
  await db
    .update(countyDiscoveryQueue)
    .set({ ownedStatus: "complete", ownedRefusalReason: null, ownedParcelsStored: stored, ownedCompletedAt: clock.now(), updatedAt: clock.now() })
    .where(and(eq(countyDiscoveryQueue.state, state), eq(countyDiscoveryQueue.county, county)));
}

/**
 * Complete a county whose parcels were kept (in one call or in batches):
 * coverage row complete with `stored`, each bucket-confirmed receipt recorded
 * on it (what getCorporaStatus() reads for "ingested"), IndexNow told.
 */
export async function completeLoadedCounty(
  target: OwnedTarget,
  stored: number,
  receipts: import("./openDataBucket").UploadReceipt[],
): Promise<{ receiptsRecorded: number }> {
  await markOwnedCountyComplete(target, stored);
  const { recordReceipt } = await import("./openDataBucket");
  for (const r of receipts) await recordReceipt(target.state, normalizeCountyName(target.county), r);
  // The county now has a public guide and parcel pages: tell IndexNow
  // (best-effort; dormant without a key).
  const { announceCountyLoaded } = await import("../publicCountyGuide");
  await announceCountyLoaded(target.state, target.county);
  return { receiptsRecorded: receipts.length };
}

/** Keep a whole county in one call, then complete it. */
export async function persistLoadedCounty(
  target: OwnedTarget,
  parcels: OwnedParcelInput[],
  receipts: import("./openDataBucket").UploadReceipt[],
): Promise<{ stored: number; receiptsRecorded: number }> {
  const stored = await saveOwnedParcels(target, parcels);
  return { stored, ...(await completeLoadedCounty(target, stored, receipts)) };
}
```

Then, in `scripts/land-data/build-tn-showcase.ts` (this lane's file — the
integrator may apply it or hand it back), replace the body of
`databaseStore().complete` with:

```ts
    async complete(stored: number, receipts: UploadReceipt[]) {
      const { completeLoadedCounty } = await import("../../server/services/landData/ownedParcelStore");
      return completeLoadedCounty(owned, stored, receipts);
    },
```

and drop the now-unused dynamic imports of `db`, `countyDiscoveryQueue`,
`drizzle-orm`, `clock`, `recordReceipt` and `announceCountyLoaded` there.
`persistLoadedCounty` then has no production caller (the reachability gate
counts it in **opaque-exports**, +1 — see P6). Recommended: delete it and port
its two test callers to the canonical pair —
`tests/unit/countyLoadAnnouncesToIndexNow.test.ts:32` →
`completeLoadedCounty(target, 0, [])`, and
`tests/db/countyPipelineOnBuiltSchema.ts:228` →
`const stored = await saveOwnedParcels(target, loadedParcels); const persisted = { stored, ...(await completeLoadedCounty(target, stored, [receipt])) };`
(every `check(...)` there stays as is). Update `ownedParcelStore.ts`'s header
comment (it names `build-tn-showcase.ts --comptroller`) to name
`completeLoadedCounty`.

## P2 — no TN ETL job seed (recommendation, not a diff)

The brief suggested a TN job seed as a possible proposal. **Recommendation: do
not seed one.** The Comptroller download is a manual, form-gated file
("we do not offer … any recurring extracts or other automated downloads" —
recorded in `tnParcelSources.ts`, 2026-10-10), so a scheduled job has nothing
it may fetch. A job row would be a handler with no input — "built but unwired"
in reverse. The TN path stays the operator CLI:

```
npx tsx scripts/land-data/build-tn-showcase.ts --plan                    # metros-first order
npx tsx scripts/land-data/build-tn-showcase.ts --comptroller <dir> \
  --county-fips 47165 --mailing-state-field <F> --improvement-value-field <F> --out <dir>
```

If the COO wants the run visible in `etl_runs`, the right shape is a handler
that reads a directory a person dropped (e.g. `OPEN_DATA_INBOX/tn/<fips>/`)
and calls `buildTnCounty` — that needs a COO decision on where downloads land,
and is not proposed here.

## P3 — `server/services/openData/statewideSourceRegistry.ts`: point NOT_READ at the dossier drafts

No new entries (TN and TX have no statewide row; the registry is pinned 1:1
to `STATEWIDE_PARCEL_ENDPOINTS`, IN/OH have none either). One optional wording
change so the unresolved reason names where the reading plan lives:

```diff
 const NOT_READ =
-  "terms not read for this dossier — the D1 build container's network policy does not reach the state host; resolve from the terms' own words";
+  "terms not read for this dossier — the D1/D2a build containers' network policy does not reach the state host; resolve from the terms' own words (reading plan: docs/land-data/dossiers/<STATE>.md)";
```

Check first that no test pins the exact `NOT_READ` text
(`grep -rn "network policy does not reach" tests/`).

## P4 — `server/services/etlHandlers.ts`, migrations, `scripts/migrate.mjs`

**None.** The TX refusal lives in `statewideCadastral.ts` (`buildSpecFor` and
`streamCounty`), so no handler change is needed; `STATEWIDE_BUILD_STATES` is
unchanged.

## P5 — `docs/company/next-moves.md` (integrator's file) — suggested lines

Under the 2026-10-24 D2 entry, replace the **TN** and **TX** "Not done" bullets with:

- **TN (done, D2a).** The Comptroller loader is bounded: `server/services/landData/tnComptrollerCounty.ts` reads the download a page at a time, spills roll and parcels to GISLINK hash buckets, joins per bucket, spills to 0.05° cells, and builds cell by cell (batched `saveOwnedParcels`, `StreamingArtifactWriter`). County by county, metros first (`TN_METRO_COUNTY_ORDER`, FIPS pinned to the county source census); every statewide request is refused. Gate `scripts/d2-tn-memory-gate.ts` (400k parcels, 512 MB cap): TN build 310 MB, statewide build with the parcel-id sort 254 MB; the accumulating and in-memory-sort mutants OOM.
- **TX (refusal made explicit).** `TX_BEACHHEAD_COUNTIES` is empty with its reason; every TX build refuses with it (`tests/unit/txBeachhead.test.ts`).
- **Dossier drafts** for NC, IN, OH, WI, AR, MT, TN, TX, FL in `docs/land-data/dossiers/` — every use class unresolved (TN internal recorded earlier); each lists exactly what must be read.

## P5b — integrator-assigned fixes taken in this lane (statewideCadastral.ts)

- **Digest in the object key.** `buildCounty` (and the TN build) key artifacts `…/<stem>.<sha256[0:16]>.<parquet|pmtiles>` via `artifactObjectKey()`. A second same-day build with different bytes gets a different key; both receipts still resolve (`statewideCadastral.test.ts`: "two same-day builds … BOTH receipts still resolve"). Note for anyone reading `owned_artifacts`: keys written before this change have no digest segment; nothing parses the key.
- **Parcel order.** `ExternalSorter` (bounded: sorted runs of `SORT_RUN_CHARS` = 16M serialized chars spilled to NDJSON, k-way merged) sits between the normalizer and the parquet writer; order is UTF-8 byte order (code-point compare), stable on ties. `CountyBuildDeps.sortRunChars` / `TnBuildDeps.sortRunChars` is the knob (tests force small runs; the memory gate's mutant sets Infinity). The unmodified `scripts/d2-bounded-memory-gate.ts` now measures the sort too (it drives `buildCounty`); `scripts/d2-tn-memory-gate.ts` adds `statewide-build` / `statewide-sort-mutant`.
- **Measured** (`npx tsx scripts/d2-tn-memory-gate.ts`, 400,000 synthetic parcels, child heap 448 MB, cap 512 MB, 2026-10-24, under fleet load): TN build PASS 310 MB kernel peak (VmHWM); TN accumulate-source mutant and accumulate-store mutant both OOM (SIGABRT); statewide build with the sort PASS 254 MB; statewide in-memory-sort mutant OOM (SIGABRT). An earlier merge built on readline's async iterator measured 661 MB (FAIL) — it reads every run ahead without backpressure; the merge now uses a synchronous pull reader with 128 KB chunks.

## P6 — `scripts/ratchets/reachability.json` + retire the accumulate-then-build path  (REQUIRED: the reachability gate is red on this lane's tree until applied)

Measured on this worktree (`node scripts/lint-reachability.mjs --report`,
2026-10-24): the bounded rewrite removed the only production caller of the
pre-D2a in-memory artifact path. Findings this lane caused:

| family | delta | symbol |
|---|---|---|
| unreached-exports | +3 (418 > 415) | `geoParquet.ts::writeGeoParquet`, `geoParquet.ts::readGeoParquet`, `pmtilesWriter.ts::buildPmtiles` |
| module-orphans | +1 (34 > 33) | `server/services/landData/pmtilesWriter.ts` |
| opaque-exports | +2 (20 > 18) | `openDataBucket.ts::uploadAndConfirm` (buffered upload; the CLI now streams with `uploadFileAndConfirm`), `ownedParcelStore.ts::persistLoadedCounty` |
| stale allowlist | 1 | `export:server/services/landData/geoParquet.ts::decodeWkb` — now REACHED (tnComptrollerCounty's streamed read-back decodes WKB) |

Do not raise baselines. Recommended (deletion, the gate's own advice):

1. **Remove the stale allowlist entry** `export:server/services/landData/geoParquet.ts::decodeWkb` from `scripts/ratchets/reachability.json`.
2. **Delete `server/services/landData/pmtilesWriter.ts`** (whole-FeatureCollection tiler; replaced by `StreamingArtifactWriter`'s partitioned tiler).
3. **Delete `writeGeoParquet`, `readGeoParquet`** and their private helpers (`SCHEMA_DEF`, `geoMetadata`, `writeGeoParquetRows`, `LoadedGeoParquet` if then unused except by `readGeoParquetRows`) from `geoParquet.ts`; keep `encodeWkb`, `decodeWkb`, `readGeoParquetRows`, `ParquetColumnDef`, `OwnedParcelRow` (if still referenced).
4. **Delete `uploadAndConfirm`** from `openDataBucket.ts` (a bulk artifact must stream).
5. **P1's deletion of `persistLoadedCounty`.**
6. **Port, do not drop, the invariants** in `tests/unit/landDataPipeline.test.ts`:
   - "GeoParquet writer + loader round-trips rows and geometry exactly" → write the same three rows through `StreamingArtifactWriter` (schema = the TN columns) and read back with `readGeoParquetRows`; keep every `expect` (geo version 1.1.0, primary column, WKB, exact geometry, deeded_acres null round trip).
   - "PMTiles archive opens and a tile decodes to MVT features" → same features through `StreamingArtifactWriter`; header zooms become `[14, 15, 1]` (the streaming writer's z14–15), keep the tile/feature/`access` property asserts.
   - "refuses to build an empty archive" → `StreamingArtifactWriter.finish()` with zero rows rejects `/empty artifacts/` (already pinned in `statewideCadastral.test.ts` — may simply reference it).
   - the two `uploadAndConfirm` receipt tests → `uploadFileAndConfirm` on a temp file (the truncation case is already pinned in `statewideCadastral.test.ts`; keep the "SHA-256 + bucket on the receipt" assert).
   After 1–6: unreached-exports 415, module-orphans 33, opaque-exports 18, no stale entry — back to baseline, nothing raised.

If the integrator prefers not to delete in this wave, the alternative is five
TEST SEAM allowlist entries with REVOCATION lines — but that would record the
retired unbounded path as a live seam, which it no longer is.

## Behaviour changes in `build-tn-showcase.ts` (documented in its header)

- Artifacts are per county: `tn-<county>.parquet` / `tn-<county>.pmtiles` (were `tn-parcel-facts.parquet` / `tn-parcels.pmtiles`); object keys `tn/<county>/<date>/tn-<county>.<sha256[0:16]>.<ext>` (were `tn/<date>/…`, where two counties — or two runs — on one day overwrote each other).
- GeoParquet rows are ascending by `source_parcel_id` in UTF-8 byte order (the D2b diff order).
- PMTiles zooms 14–15 (the streaming writer's partition grain), were 10–15.
- The county must resolve (FIPS / name / the file's own `COUNTY_NAME`); the old default parcel-key FIPS `47000` is gone. **Open question:** any county loaded before D2a without `--county-fips` has parcel keys `TN-47000-…`; a reload now writes `TN-<fips>-…` keys, i.e. new rows beside the old ones. A one-off reconcile may be needed (read-only count first).
- A roll field the roll lacks, or a roll field named with no roll file, is refused (a missing improvement field used to read as `NaN` → "vacant").
- A deleted `.dbf` row no longer shifts later parcels' attributes onto the wrong geometry.
- Uploads stream the file (`uploadFileAndConfirm`, HEAD-confirmed) instead of buffering it.
- New flags: `--plan`, `--county <name>`; `--statewide` is refused.
