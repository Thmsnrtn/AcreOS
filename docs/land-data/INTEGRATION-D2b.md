# INTEGRATION — D2b (dataset releases)

Proposals for the integrator and the COO. **Nothing here is applied.** The lane
shipped only the pure core (`server/services/landData/releases/**`), its tests
and fixtures, and these two docs. Spec: `docs/land-data/d2b-releases-spec.md`.

Order of application: §1 (no-op) → §2 (needs COO table approval) → §3 → §4 → §5.
§3 and §4 depend on §2. §5 is independent and is the most urgent, because it
is a live integrity gap.

## 1. Shared-file changes required to land the core as-is

**None.** The core imports only `node:crypto`. It reads a build through the
structural type `BuildForRelease` instead of importing `CountyBuildReport`,
because that import drags the build's DB/registry graph (1,717 files) into a
pure module. `tests/unit/datasetReleaseBuildShape.test.ts` pins, at the type
level, that `CountyBuildReport` is assignable to `BuildForRelease`.
**This lane did not type-check that one file**, because doing so loads the
full graph and the shared machine OOM-killed tsc. The integrator's
`npm run check` is its first check. No schema, route, ETL or ratchet file
changes.

**Reachability ratchet impact (expected, please baseline or wire):**
`releaseDiff.ts` and `releasePointer.ts` have no production importer (only
tests), and `releaseManifest.ts` / `releaseName.ts` are imported only by their
siblings. Exports with no production caller, which are the test seams until
§3/§4 wire them:

- `releaseManifest.ts`: `releaseIdFromJson`, `verifyReleaseId`,
  `countyEntryFromBuild`, `summarizeRelease`. Internal-only/sibling-only:
  `validateManifest`, `canonicalManifestBytes`, `fieldMappingDigest`.
  Sibling-used: `DATASET`, `canonicalJson`, `compareUtf8`, `releaseIdOf`,
  `isReleaseId`.
- `releaseName.ts`: `formatReleaseName`, `parseReleaseName`, `auditReleaseNames`
  (internal-only plus tests); `nextReleaseName` (sibling-used).
- `releaseDiff.ts`: `diffManifests`, `diffParcelRows`, `summarizeParcelDiff`,
  `parcelFingerprint`, `ParcelStreamOrderError` (no production caller).
- `releasePointer.ts`: `currentRelease`, `verifyPointerHistory`, `promote`,
  `rollback` (no production caller).

If the ratchet must not rise, §3 below is the minimal wiring. A promote/rollback
founder action and the release-assembly job are the real callers.

## 2. Storage — DDL proposal (needs COO approval: +2 tables, +1 column)

### 2a. Recommended: two tables, both append-only

Migration `NNNN_d2b_dataset_releases.sql` (number assigned by the integrator;
mirror into `scripts/migrate.mjs` as 0289 was):

```sql
-- NNNN — D2b: immutable, content-addressed dataset releases + the release pointer.
--
-- dataset_releases: one row per release. release_id is sha256 over the
-- canonical manifest (server/services/landData/releases/releaseManifest.ts),
-- so the row can never be edited without breaking its own id. It is never
-- updated or deleted: the trigger denies both.
-- dataset_release_pointer: the append-only history of which release is
-- current. Promotion and rollback are both an INSERT. (dataset, seq) is the
-- primary key and the concurrency guard: two concurrent moves both try
-- seq = n+1 and exactly one wins.
CREATE TABLE IF NOT EXISTS "dataset_releases" (
  "release_id" text PRIMARY KEY CHECK ("release_id" ~ '^sha256:[0-9a-f]{64}$'),
  "dataset" text NOT NULL CHECK ("dataset" = 'acreos-parcels'),
  "manifest_format" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "county_count" integer NOT NULL CHECK ("county_count" > 0),
  "parcel_count" bigint NOT NULL CHECK ("parcel_count" >= 0),
  "artifact_bytes" bigint NOT NULL CHECK ("artifact_bytes" > 0),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "dataset_release_pointer" (
  "dataset" text NOT NULL,
  "seq" integer NOT NULL CHECK ("seq" >= 1),
  "action" text NOT NULL CHECK ("action" IN ('promote', 'rollback')),
  "release_id" text NOT NULL REFERENCES "dataset_releases"("release_id"),
  "release_name" text NOT NULL CHECK ("release_name" ~ '^acreos-parcels v[0-9]{4}\.(0[1-9]|1[0-2])\.[1-9][0-9]*$'),
  "previous_release_id" text REFERENCES "dataset_releases"("release_id"),
  "at" timestamp NOT NULL,
  "actor" text NOT NULL CHECK (length(trim("actor")) > 0),
  "reason" text NOT NULL CHECK (length(trim("reason")) > 0),
  PRIMARY KEY ("dataset", "seq")
);
-- A name is minted once; a release is promoted (first-made-current) once.
CREATE UNIQUE INDEX IF NOT EXISTS "dataset_release_pointer_name_once"
  ON "dataset_release_pointer" ("dataset", "release_name") WHERE "action" = 'promote';
CREATE UNIQUE INDEX IF NOT EXISTS "dataset_release_pointer_promote_once"
  ON "dataset_release_pointer" ("dataset", "release_id") WHERE "action" = 'promote';

CREATE OR REPLACE FUNCTION dataset_release_deny_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (UPDATE/DELETE denied)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dataset_releases_no_update ON "dataset_releases";
CREATE TRIGGER dataset_releases_no_update BEFORE UPDATE ON "dataset_releases"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_releases_no_delete ON "dataset_releases";
CREATE TRIGGER dataset_releases_no_delete BEFORE DELETE ON "dataset_releases"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_release_pointer_no_update ON "dataset_release_pointer";
CREATE TRIGGER dataset_release_pointer_no_update BEFORE UPDATE ON "dataset_release_pointer"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_release_pointer_no_delete ON "dataset_release_pointer";
CREATE TRIGGER dataset_release_pointer_no_delete BEFORE DELETE ON "dataset_release_pointer"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();

-- Every served answer records its release (null = pre-release lane, never a guess).
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "served_release_id" text;
```

Unlike `purpose_ledger`, there is deliberately **no DBA bypass GUC**. A release
has no retention pruning, because rolling back requires it to exist.
`TRUNCATE` bypasses row triggers. Note it in the operations runbook, or add a
`BEFORE TRUNCATE` statement trigger if the COO wants it airtight.

`served_release_id` is a plain `text` with no FK, because `provider_lookup_log`
is a high-volume telemetry table and an FK there costs a lookup per insert. It
is validated in code (`isReleaseId`) instead.

**Drizzle definitions** (for `shared/schema/etl.ts`, the ETL/observation home;
`bigint` must be added to that file's `drizzle-orm/pg-core` import):

```ts
import type { ReleaseManifest } from "../../server/services/landData/releases/releaseManifest";
// ↑ if shared/ must not import from server/, move the ReleaseManifest TYPES
//   to shared/landData/releaseManifestTypes.ts and re-export from the server module.

export const datasetReleases = pgTable("dataset_releases", {
  releaseId: text("release_id").primaryKey(),
  dataset: text("dataset").notNull(),
  manifestFormat: text("manifest_format").notNull(),
  manifest: jsonb("manifest").$type<ReleaseManifest>().notNull(),
  countyCount: integer("county_count").notNull(),
  parcelCount: bigint("parcel_count", { mode: "number" }).notNull(),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
}, (t) => [
  check("dataset_releases_id_shape", sql`${t.releaseId} ~ '^sha256:[0-9a-f]{64}$'`),
]);
export type DatasetRelease = typeof datasetReleases.$inferSelect;

export const datasetReleasePointer = pgTable("dataset_release_pointer", {
  dataset: text("dataset").notNull(),
  seq: integer("seq").notNull(),
  action: text("action").$type<"promote" | "rollback">().notNull(),
  releaseId: text("release_id").notNull().references(() => datasetReleases.releaseId),
  releaseName: text("release_name").notNull(),
  previousReleaseId: text("previous_release_id").references(() => datasetReleases.releaseId),
  at: timestamp("at").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
}, (t) => [
  primaryKey({ columns: [t.dataset, t.seq] }),
  uniqueIndex("dataset_release_pointer_name_once").on(t.dataset, t.releaseName).where(sql`action = 'promote'`),
  uniqueIndex("dataset_release_pointer_promote_once").on(t.dataset, t.releaseId).where(sql`action = 'promote'`),
]);
export type DatasetReleasePointerRow = typeof datasetReleasePointer.$inferSelect;
```

And in `shared/schema.ts` `providerLookupLog`, after `confidenceServed`:

```ts
  // D2b: the dataset release an AcreOS-owned answer came from (null = a
  // pre-release lane; never the current pointer guessed onto an older row).
  servedReleaseId: text("served_release_id"),
```

Ratchets this touches: `table-count` (+2, COO approval); `reachability`
tables-no-writer/reader (satisfied once §3 lands); the org-scope tenancy lint
(both tables are **global**, with no `organization_id`, like owned parcels.
Register them as global public-record tables wherever that lint keeps its
global list).

### 2b. Zero-table alternative (if the COO declines §2a)

Store manifests in the bucket at `releases/acreos-parcels/{releaseId}.json`
(the key is the content id, so it is naturally immutable), and the pointer as
one object per entry, `releases/acreos-parcels/pointer/{seq:08d}.json`, written
with a conditional create (`If-None-Match: *`) so `seq` stays unique.
**Unverified**: that the configured S3-compatible store (R2 recommended)
honours conditional PUT. This container cannot reach it, so it was not
checked. Reads then need a LIST of the pointer prefix. Weaker than §2a: there
are no triggers, and the "immutability" is the bucket's.

## 3. Wiring the core (after §2a)

New file `server/services/landData/releases/releaseStore.ts` (lane-owned
directory, so the integrator or a follow-up lane can add it):

- `storeRelease(manifest, createdBy)`: validate, compute `releaseIdOf`, then
  `INSERT … ON CONFLICT (release_id) DO NOTHING` (same content = same release:
  idempotent).
- `loadRelease(id)`: select, then `verifyReleaseId(id, row.manifest)`. A
  mismatch **throws**, because the row was edited.
- `loadPointerHistory(dataset)`: `ORDER BY seq`, mapped to `PointerEntry`.
- `movePointer(dataset, fn)`: load history and catalog → `promote`/`rollback`
  (pure) → `INSERT` the one new entry. On a PK conflict, retry once from a
  fresh read.

Callers that make these reachable:
- **assembly**: a founder/COO action, or an ETL job proposal
  `acreos_parcels_release_assemble` in `server/services/etlHandlers.ts`. It reads
  the latest successful `etl_runs.observation` per `statewideJobName(st)`
  (each is a `CountyBuildReport`) → `countyEntryFromBuild(report, { job,
  etlRunId: run.id, layerUrl: buildSpecFor(st).layerUrl, mapping:
  report.remap?.mappingAfter ?? buildSpecFor(st).mapping })` → `storeRelease`.
  Dry-run observations are refused by `countyEntryFromBuild`. That is
  intended: today **every** wave-1 build is a dry run (dossiers unresolved
  and/or bucket unset), so assembly would honestly produce no release.
- **promotion/rollback**: under the four founder doors, as a child of
  `Controls` (`/founder/autopilot/control`). **Not a new route family**, and
  `requireFounder`.
- **D2g inventory**: `summarizeRelease(manifest, name)` for each release, with
  the name taken from the pointer history's `promote` entry.

## 4. Stamping served answers (after §2a + a release loader)

Add one canonical projection, so no serving path re-implements the rule. It
belongs in `server/services/landData/ownedParcelView.ts`:

```ts
import { isReleaseId } from "./releases/releaseManifest";

/** The release an owned row was loaded from, or an honest null with why. */
export function servedReleaseOf(rawData: unknown): { release: { id: string } | null; releaseBasis: string | null } {
  const raw = (rawData ?? {}) as Record<string, unknown>;
  const id = typeof raw.loadedReleaseId === "string" && isReleaseId(raw.loadedReleaseId) ? raw.loadedReleaseId : null;
  return id
    ? { release: { id }, releaseBasis: null }
    : { release: null, releaseBasis: "loaded before dataset releases (county pipeline or Comptroller loader)" };
}
```

(The name is resolved from the pointer history at render time, or carried as
`rawData.loadedReleaseName` by the loader.)

Exact integration points (file:function → change):

| File : function | Change |
|---|---|
| `server/services/landData/ownedParcelStore.ts` : `ownedParcelAtPoint` | `OwnedParcelHit` gains `servedRelease: ReturnType<typeof servedReleaseOf>`, computed from the `rawData` already selected. |
| `server/services/landData/ownedParcelStore.ts` : `saveOwnedParcels` | When the writer is the release loader, put `loadedReleaseId` (and name) into `rawData`. The existing two writers pass nothing, so their rows stay null and honest. |
| `server/services/landData/ownedParcelView.ts` : `ownedViewOf` / `serializeOwnedParcelForCustomer` | `OwnedParcelView` gains `servedRelease`, and the serialized answer carries `release` + `releaseBasis`. This one change covers `routes-land-data.ts` (both GETs), `publicParcelReport.ts` `buildFacts` / `getPublicLandFacts`, and `landlockedCheck.ts` `checkLandlocked`. |
| `server/services/parcel.ts` : `ownedParcelResultAt` | `ParcelLookupResult` gains an optional `release` (from `hit.servedRelease`). |
| `server/services/providerIntelligence.ts` : `recordLookup` | `LookupRecord.servedReleaseId?: string \| null` → `servedReleaseId` column (validated with `isReleaseId`, null otherwise). |
| `server/services/providers/county-gis-provider.ts` (the `ownedParcelResultAt` branch, ~line 85) | Pass `owned.release?.id ?? null` through to the registry's `recordLookup` call. |
| `server/services/parcelDdReport.ts` : `purchaseDdReport` / `purchasedDdReport` | **Credits-adjacent: COO decision.** Pin the release id in the purchase record so a re-delivery renders the release that was bought, not the current row. Not touched by this lane. |
| `server/services/publicCountyGuide.ts` (counts) | Aggregate counts are not a per-parcel answer. Optionally show "as of release …" once all rows in the county share one. |

**Release loader** (not built; the step that makes any stamp non-null): read a
promoted release's parquet artifacts per county (streamed, `readGeoParquetRows`),
reconcile keys with `reconcileCrosswalk`, then `saveOwnedParcels` with
`loadedReleaseId`. Owner names follow the dossier exactly as `toBulkRow` does.
Rollback of the owned store = load the rolled-back-to release.

## 5. Live integrity gap — same-day rebuild overwrites a receipted object

`server/services/landData/statewideCadastral.ts` : `buildCounty` builds
`prefix = statewide/${st}/${county}/${deps.today}`. Two builds of one county on
one day upload to the **same key**, so the second replaces the bytes the first
receipt (and any release naming it) vouched for. `recordReceipt` keeps both
receipts, because it dedupes on key *and* sha256, which leaves a receipt whose
bytes no longer exist.

Proposal (smallest change): add the digest to the object key:

```ts
// before
const parquet = { ...built.parquet, objectKey: `${prefix}/${stem}.parquet` };
const pmtiles = { ...built.pmtiles, objectKey: `${prefix}/${stem}.pmtiles` };
// after — a key names exactly one byte sequence, forever
const parquet = { ...built.parquet, objectKey: `${prefix}/${stem}.${built.parquet.sha256.slice(0, 16)}.parquet` };
const pmtiles = { ...built.pmtiles, objectKey: `${prefix}/${stem}.${built.pmtiles.sha256.slice(0, 16)}.pmtiles` };
```

Plus `tests/unit/statewideCadastral.test.ts`'s key assertions (owned by D2a, or
by the integrator). Defence in depth: `ObjectStoreClient.putFile` could send
`If-None-Match: *` (unverified against R2, see §2b).

## 6. Parcel-diff input order (needed before artifact-level parcel diffs)

`StreamingArtifactWriter` writes rows in source OBJECTID order. `diffParcelRows`
needs ascending `source_parcel_id` in UTF-8 byte order. Options: (a) a
bounded-memory external sort (spill runs to disk and k-way merge) ahead of the
parquet writer in `buildCounty`, which changes D2a's file and so is a proposal
for that owner; (b) diff owned rows after a release load with
`ORDER BY source_id COLLATE "C"` through a cursor. (a) is recommended (spec §8).
