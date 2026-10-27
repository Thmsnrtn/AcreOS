# D2b — immutable dataset releases (`acreos-parcels vYYYY.MM.N`)

Status: **spec + pure core, not wired.** Written 2026-10-24 (lane D2b of the D2
wave). The core lives in `server/services/landData/releases/` and is fully
unit-tested (`tests/unit/datasetRelease*.test.ts`). Storage and serving-path
stamping are **proposals** in `docs/land-data/INTEGRATION-D2b.md`. They need COO
approval because they add two tables.

## 0. Assumptions (the design docs are not in the repo)

The data-sourcing design docs (v1, v2, Amendment 2) that name D2b are not in
this repository. Everything below comes from the code as it stands at
`8d949e85` plus the package brief. Each assumption is written down so it can be
overruled:

| # | Assumption | Consequence if wrong |
|---|---|---|
| A1 | One dataset, `acreos-parcels`, holds the bulk statewide/county parcel artifacts. Other corpora (FEMA, census, …) are out of scope. | `DATASET` becomes a parameter, and the pointer table gets a `dataset` column in its PK (the DDL already carries one). |
| A2 | A release's unit is a **county**: one parquet artifact (the rows) and at most one pmtiles artifact (the tiles), as `statewideCadastral.buildCounty` produces them. | A different grain (a state-wide file) is a new `MANIFEST_FORMAT`. |
| A3 | A release's identity covers **provenance** as well as bytes: ETL job, run id, the layer's as-of, the field map. Two byte-identical artifacts built by different runs are different releases. | If the docs want byte-only identity, drop `source.etlRunId` from the manifest. That is a format bump (`@2`). |
| A4 | The human name is minted at **first promotion** (not at assembly), in the UTC month of that promotion. | The naming code is the same either way. Only the caller changes. |
| A5 | Rollback is allowed to any release that was ever current, and only to those. A release assembled but never promoted cannot be "rolled back to". Promote it instead. | — |
| A6 | Promotion is an operator action (founder/COO or an approved automation), not a side effect of a build. A build produces artifacts and receipts. A release is assembled from them on purpose. | — |
| A7 | Manifests list artifacts only after the bucket confirmed them (`uploadFileAndConfirm` receipt). A dry run has no receipt and so cannot be in a release. | — |

## 1. What a release is

A release is a **manifest** (`ReleaseManifest`, `releaseManifest.ts`):

```
format          "acreos-parcels/release-manifest@1"
dataset         "acreos-parcels"
mappingVersion  row-schema + normalizer version, e.g. "bulk-row@1"
counties[]      one per county:
  state, county            "NC", "wake" (normalizeCountyName form)
  parcelCount              rows written AND read back by the build
  artifacts[]              { kind: parquet|pmtiles, bucket, objectKey, bytes, sha256 }
                           taken from the bucket RECEIPT, cross-checked against the build
  source                   { job, etlRunId, sourceAsOf, layerUrl, fieldMappingDigest }
```

The **source snapshot refs** are the build's own record: `job` + `etlRunId`
point at the `etl_runs` row whose `observation` holds the full
`CountyBuildReport`. `sourceAsOf` is the layer's own `editingInfo.lastEditDate`.
`fieldMappingDigest` is the sha256 of the canonical field map in force, so a
D2d-promoted remap is a visible change. **mappingVersion** names the shape of
the rows (`BULK_SCHEMA` + `normalizeFeature`). It is bumped by hand when either
changes, because nothing in the build derives it today.

`countyEntryFromBuild(report, source)` turns one `CountyBuildReport` into a
county entry. It **refuses** any outcome other than `"ingested"`, and it
refuses when a built artifact has no receipt with the same key, bytes and
digest.

What is deliberately **not** in the manifest: the assembly time, who assembled
it, its human name, and the release it replaced. Those are facts *about* a
release, so they live on the release row and in the pointer history. If they
were in the manifest, the same content could be two releases.

## 2. The content id

```
releaseId = "sha256:" + hex( SHA-256( DOMAIN_TAG + canonicalJson(validate(manifest)) ) )
DOMAIN_TAG = "acreos-parcels/release-manifest@1\n"
```

- **canonicalJson**: object keys sorted (UTF-16 code-unit order, as RFC 8785),
  no whitespace, keys whose value is `undefined` omitted. It **refuses** NaN,
  ±Infinity, bigint, Date, Map, non-plain objects and `undefined` inside
  arrays. It does not let `JSON.stringify` quietly turn these into `null` or a
  string.
- **validate** puts the manifest into canonical order (counties by
  `state/county` in UTF-8 byte order, artifacts parquet then pmtiles). So the
  order in which a manifest was written down cannot move the id.
- **Unknown fields are refused**. A field that would be hashed but never read
  would make two releases out of one meaning.
- The domain tag means a manifest id can never equal any other sha256 the
  platform computes, such as an artifact digest.

Proven in `datasetReleaseManifest.test.ts`:
- the id does not depend on key order, whitespace, or county/artifact order;
- every one of the fixture's **52 leaves** (an enumerated population with an
  exact floor), nudged by the smallest change that keeps the leaf's class,
  changes the id. 45 of those nudges stay valid, so the hash is what is being
  tested, not the validator;
- the id equals an independent recomputation of the sha256.

`verifyReleaseId(id, storedManifest)` recomputes the id from a stored manifest.
A mismatch means the row was edited after release. Every read of a release
row should call it (INTEGRATION-D2b §3).

## 3. The name: `acreos-parcels vYYYY.MM.N`

`releaseName.ts`:
- minted **once**, at the release's first promotion, and never changed;
- `YYYY.MM` is the **UTC** month of that promotion;
- `N` = 1, 2, 3 … within the month. No gaps, no reuse, no leading zeros. A name
  ever minted is never minted again, even after the pointer rolls away from it;
- **monotone**: a name is never minted for a month earlier than the latest one
  (a backwards clock is refused);
- `auditReleaseNames` checks a whole set of names (parse, reuse, per-month
  contiguity). `nextReleaseName` refuses to extend an invalid set.

The name is **derived from the pointer history** (the name carried by each
`promote` entry). It is not a mutable column on the release, so the release row
can be fully immutable.

## 4. Immutability rules

1. **A release row is never updated or deleted.** Its id is the hash of its
   manifest, so any edit is caught by `verifyReleaseId`, and the proposed
   table also denies UPDATE/DELETE with a trigger (same pattern as
   `purpose_ledger`, migration 0289).
2. **The pointer history is append-only.** Promotion and rollback each add one
   entry. Nothing is edited or removed (trigger-enforced, proposed). The pure
   state machine never mutates its input: it returns a new frozen array whose
   prefix is the input's entries *by reference*.
3. **An object a release names is never overwritten.** **This does not hold
   today**: `buildCounty` writes to
   `statewide/{st}/{county}/{YYYY-MM-DD}/{stem}.parquet|pmtiles`. A second
   build of the same county on the same day PUTs to the **same key**, which
   replaces the bytes an earlier receipt (and any release) vouched for.
   `recordReceipt` keeps both receipts (it dedupes by key *and* sha256), so the
   coverage row would then hold a receipt whose bytes are gone. Proposed fix
   (INTEGRATION-D2b §5): make the key content-addressed (put the digest in it),
   and/or refuse a PUT over an existing key.
4. **Bucket retention**: an artifact named by any release that was ever current
   must not be lifecycle-deleted. If it were, rollback would point at nothing.
   Retention rules are a founder/COO decision (storage is money). Flagged, not
   designed.

## 5. Promotion and rollback (pointer moves, never mutation)

`releasePointer.ts` is a pure state machine over `PointerHistory = readonly PointerEntry[]`:

```
PointerEntry { seq, action: promote|rollback, releaseId, releaseName,
               previousReleaseId, at, actor, reason }
current release = last entry
```

- **promote(h, releaseId, move, catalog)**: the release must exist (be in
  `catalog`) and must **never have been current**. Mints the next name.
  Returning to an old release goes through rollback, which keeps the old name.
- **rollback(h, move, toReleaseId?)**: points back at a release that **was**
  current. With no target, it goes to the release that was current just
  before the current one was *first promoted*. Repeated rollbacks therefore
  walk back one version at a time (A→B→C, rollback → B, rollback → A, rollback
  → refused) instead of toggling between the last two. An explicit target
  covers roll-forward.
- Every move names an `actor` and a `reason`, and cannot predate the entry
  before it.
- `verifyPointerHistory` checks the whole chain: contiguous `seq`,
  `previousReleaseId` equal to the prior entry's release, no no-op moves,
  non-decreasing instants, promote only of never-current releases with exactly
  the name `nextReleaseName` would mint, rollback only to once-current releases
  under their original name. **promote/rollback refuse to extend a history
  that fails it**, so a tampered table is noticed at the next move.

Concurrency (for the DB form): two concurrent moves both compute `seq = n+1`.
The `(dataset, seq)` primary key lets exactly one insert win, and the loser
re-reads and re-decides. The PK is the lock.

## 6. "Every served answer records the release it came from"

### Where answers are served today (from code, `8d949e85`)

All customer-served parcel answers that come from AcreOS's own data read
**`parcel_snapshots` rows with `source = 'owned_pipeline'`**. None of them reads
a bulk artifact:

| Serving path | Reads | Surface |
|---|---|---|
| `server/services/landData/ownedParcelStore.ts` `ownedParcelAtPoint` | owned rows by point | used by every coordinate lookup below |
| `server/services/parcel.ts` `ownedParcelResultAt` | `ownedParcelAtPoint` | `lookupParcelByCoordinates` (TN branch), `server/services/providers/county-gis-provider.ts` (provider registry → `recordLookup`) |
| `server/services/landData/ownedParcelView.ts` `findOwnedParcelRow`, `findOwnedParcelByKey`, `serializeOwnedParcelForCustomer` | owned rows by APN / key | the one customer projection |
| `server/routes-land-data.ts` `GET /api/land-data/parcels/:parcelKey`, `GET /api/land-data/parcel-lookup` | `findOwnedParcelByKey` / `findOwnedParcelRow` | Map door |
| `server/services/publicParcelReport.ts` `buildFacts`, `getPublicLandFacts` | `findOwnedParcelRow` | public `/p` report |
| `server/services/landlockedCheck.ts` `checkLandlocked` | `ownedParcelAtPoint`, `findOwnedParcelRow` | public landlocked checker |
| `server/services/parcelDdReport.ts` `ddReportOffer`, `purchaseDdReport`, `purchasedDdReport` | `findOwnedParcelByKey` | paid DD report (credits) |
| `server/services/publicCountyGuide.ts` (counts) | owned-row aggregates | public county guides |

A grep for `pmtiles` across `server/` and `client/src/` finds only the three
writer modules. **No path serves a bulk artifact (parquet or PMTiles) to a
customer today.** The statewide builds go to the bucket only: the ETL handler's
`upsert` writes nothing. The owned rows come from two different writers, the
on-demand county pipeline (`countyPipeline.ts`) and the TN Comptroller loader.

### What "records its release" means

1. **In the answer**: every serialized owned-parcel answer carries
   `release: { id, name } | null`, plus `releaseBasis` when it is null (for
   example `"loaded by the county pipeline before releases existed"`).
2. **In the lookup log**: `provider_lookup_log.served_release_id` (proposed
   column) is set on every row whose `answeringLayer` is AcreOS's own data.
3. **In anything sold or persisted**: the DD report pins the release id it was
   built from. *Finding*: `purchasedDdReport` re-renders a paid report from the
   **current** row, so a re-delivered report can differ from the one bought.
   Pinning the release fixes that. This is credits-adjacent, so it is a
   proposal only and is not touched here.

**Today no served answer comes from a released artifact, so every stamp would
honestly be `null`.** The integration must stamp `null` with a basis. It must
**never** stamp the current pointer onto a row that was not loaded from it,
because that would fabricate provenance.

## 7. The open question: owned store, bucket artifacts, or both?

**Recommendation: releases are defined over the bucket artifacts. The owned
store becomes a *materialization* of a release: each owned row records the
release it was loaded from, and serving stamps that.**

Reasons, all from the code:

1. **Artifacts are already immutable and content-addressed.** Each has a
   sha256 measured by streaming and a receipt the bucket confirmed by HEAD. A
   release manifest is just a list of them. Owned rows are **updated in
   place**: `saveOwnedParcels` does `UPDATE parcel_snapshots SET …` on an
   existing `parcel_key`. There is nothing stable to hash without first copying
   the rows.
2. **Rollback has to find the old data still there.** The bucket keeps old
   objects (once §4.3 is fixed). `parcel_snapshots` keeps one row per parcel
   key, so rolling the owned store back means *reloading* the older release.
   That is a materialization step and fits the recommended model. Under the
   alternative it would be a mutation of the release itself.
3. **Diffs are cheap over artifacts.** The manifest diff needs no I/O, and the
   parcel diff streams one county's two parquet files.
4. **Versioning the owned store directly costs tables and storage**: a
   `parcel_snapshot_versions` keyed by `(release_id, parcel_key)` copies every
   parcel per release. That would mean a table-count bump and storage growth
   linear in releases, both of which need COO/founder sign-off.

What this implies, stated plainly:
- The two lanes are **disjoint today**, so adopting releases changes nothing
  customers see until a **release loader** exists. That loader would read a
  promoted release's parquet artifacts and write owned rows stamped with
  `rawData.loadedReleaseId`. It is not built here. It is the next step, and it
  must handle owner-name withholding exactly as `toBulkRow` does.
- Owned rows from the county pipeline and the TN Comptroller loader stay
  **pre-release** (stamp `null` + basis) until those writers also emit
  artifacts and go through a release.

Rejected: **"both"**. Two release mechanisms over two copies of the same
parcels give two answers to "which release did this come from".

## 8. The diff report

`releaseDiff.ts`:

- `diffManifests(from, to)` → `ReleaseDiff`: counties added, removed and
  changed, plus a count of unchanged ones. For each changed county: parcel
  count from, to and delta; the per-kind artifact digest and byte changes; the
  list of changed source-ref fields; and `parquetChanged` (the county needs a
  parcel-level diff). Also a mapping-version change and totals. It is a merge
  over canonically ordered counties.
- `diffParcelRows(from, to, stats?)` is an async generator of
  `added | removed | changed` events over two **sorted** streams of
  `{ sourceParcelId, fingerprint }`. It is a sort-merge holding **one row per
  side**. `summarizeParcelDiff` keeps counts plus a bounded sample (default
  20 ids per kind).
  - **Order contract**: strictly ascending in **UTF-8 byte order**, which is
    Postgres `COLLATE "C"` and parquet's unsigned byte order, not JS `<` (UTF-16
    code units; they disagree above U+FFFF, and a test pins it). Unsorted or
    duplicate input throws `ParcelStreamOrderError` the moment it is seen,
    because a merge over unsorted input reports changes that did not happen.
  - **Bounded memory**, proven by instrumentation over 200,000 lazily generated
    rows: at every yielded change the merge has read at most one row past what
    it has settled, on either side. A consumer that stops early stops the reads
    and closes both sources.
  - `parcelFingerprint(row)` = sha256 of canonical JSON, with byte columns
    (WKB geometry) as `{"$bytes": hex}`. `null` is treated as absent, because
    parquet optional-absent and null are the same cell.
  - **Keyed by source parcel id**, as the task specifies. A county renumbering
    therefore shows as remove + add. Carrying identity across renumbering is
    the crosswalk's job (`shared/landData/parcelCrosswalk.ts`), and the diff can
    be re-keyed on `parcelKey` by passing that as `sourceParcelId` once owned
    rows carry release stamps.
- **Gap**: the parquet artifacts are written in **OBJECTID order**, not sorted
  by parcel id. A parcel diff over two artifacts therefore needs a sorted read:
  either (a) the build writes a sorted parquet, which needs an external,
  bounded-memory sort before `StreamingArtifactWriter` (proposal), or (b) the
  diff runs over owned rows `ORDER BY source_id COLLATE "C"` with a cursor
  after a release load. Neither is built here. Option (a) is the one consistent
  with §7.

Lane D2c defines its own `ReleaseDiff` consumer interface. The exported types
are `ReleaseDiff`, `CountyChange`, `CountyRef`, `ArtifactDigestChange`,
`SourceField`, `ParcelChange`, `ParcelRowRef`, `ParcelDiffStats` and
`ParcelDiffSummary`, all from `releaseDiff.ts`, for the integrator to
reconcile.

## 9. Open questions for the COO

1. Approve the two tables plus one column (INTEGRATION-D2b §2), or choose the
   zero-table bucket form (§2b there, which rests on an unverified
   conditional-PUT capability)?
2. Who may promote: founder only, COO, or an automation with a golden-county
   gate like D2d's?
3. Artifact retention: how long are artifacts of once-current releases kept?
   (Storage is money.)
4. Should the paid DD report pin its release (§6.3)? Credits-adjacent, so it is
   not changed here.
5. Confirm A3 (provenance is part of identity).
