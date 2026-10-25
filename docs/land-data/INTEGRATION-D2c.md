# INTEGRATION — lane D2c (APID + lineage)

> **Status 2026-10-25 — §2 and §4 APPLIED** (tables approved by Tom via Muse's
> pre-merge fix list). Migration `0291_d2c_parcel_apid_lineage.sql` creates
> exactly the THREE tables §4's DDL defines — `parcel_apids`,
> `parcel_apn_windows`, `parcel_lineage_events` (§4's heading says "two"; its
> DDL has three; no third was invented and none was dropped). Deviations: no
> `btree_gist` EXCLUDE (extension not guaranteed in production) — partial
> unique indexes allow one open window per APN and per APID, and the writer
> checks `ledgerViolations()` before every commit; `parcel_apids` gains
> `parents` / `candidate_parents`; `parcel_lineage_events` is append-only by
> trigger. The one store is `server/services/landData/apidStore.ts`;
> `releases/releaseLineage.ts` applies the current release county by county
> (job `acreos_parcels_lineage_apply`, seeded inactive). It REFUSES any county
> without a FIPS reference — only TN has one in the repo
> (`tnCountyBoundaries.json`) — and skips when the current pointer entry is a
> rollback. Proven on a database built from the repo
> (`apidStore.realdb.test.ts`). **NOT applied: §3** (crosswalk proposal).
>
> The original proposal text follows unchanged.

Everything here is a PROPOSAL for the integrator. D2c added no table, no
migration, and edited no shared file. New tables need COO approval (table-count
ratchet is down-only).

## 1. What D2c shipped (pure, no callers yet)

| module | exports | production caller today |
|---|---|---|
| `shared/landData/lineage.ts` | `classifyLineage`, `inheritanceFor`, `INHERITANCE_RULES`, `LINEAGE_THRESHOLDS`, `normalizeSourceId`, types | `apid.ts` (`classifyLineage`, `inheritanceFor`, `normalizeSourceId`, `LINEAGE_THRESHOLDS`) |
| `shared/landData/apid.ts` | `applyRelease`, `emptyLedger`, `ledgerViolations`, `apidForApnAt`, `formatApid`, `parseApid`, types | none — the integrator wires it (§2) |

The reachability ratchet scans `server/services|jobs`, so these `shared/`
exports do not trip it; they are still "built but unwired" until §2 lands, and
should be called that in the PR. Test seams: the `thresholds` parameter of
`classifyLineage` / `applyRelease` (production callers omit it), and
`ledgerViolations` (meant to run before persisting, also a test oracle).

## 2. Adapter from D2b's release diff

D2b (`server/services/landData/releases/releaseDiff.ts`) was not visible to this
lane. `LineageInput` is deliberately minimal so any diff can feed it:

```ts
import type { LineageInput } from "@shared/landData/lineage";
import type { BulkParcelRecord } from "@shared/landData/bulkParcelRecord";

// One county, two FULL releases (not pages — a page boundary cuts a split in half).
function toLineageInput(prev: BulkParcelRecord[], next: BulkParcelRecord[]): LineageInput {
  const side = (rs: BulkParcelRecord[]) =>
    rs.map((r) => ({
      sourceId: r.identity.sourceParcelId,
      // BulkParcelRecord.geometry.coordinates is `unknown`; validate shape before passing,
      // or pass null (→ id_only). lineage.ts tolerates bad rings by treating them as no geometry.
      geometry: r.geometry && (r.geometry.type === "Polygon" || r.geometry.type === "MultiPolygon")
        ? (r.geometry as LineageInput["previous"][number]["geometry"])
        : null,
    }));
  return { previous: side(prev), next: side(next) };
}
```

Memory note for the 1 GB worker: `classifyLineage` holds both releases' shapes
in memory. A full statewide release will not fit; run it per county (the ledger
is per county anyway). If D2b's diff already partitions into unchanged /
changed, only feed records whose id or geometry hash changed PLUS every
previous/next record whose bbox intersects a changed one (otherwise a changed
child's untouched sibling would read as missing). Unchanged records can be
carried as `same` without geometry work — but then `previous` passed to
`applyRelease` must still be the full open-APN set, or it refuses with
`previous_snapshot_mismatch`.

## 3. Proposed fix to `shared/landData/parcelCrosswalk.ts` (integrator-owned; not edited)

Defect (reproduced, see spec §2): `newParcelKey(state, fips, sourceId)` is a pure
function of the id, so `reconcileCrosswalk` re-mints the exact key it retires
whenever a parcel keeps its id but changes shape. Minimal, local fix:

```diff
@@ export function reconcileCrosswalk(
   const used = new Set<string>();
+  // A minted key must never equal a key this reconcile retires (or any key
+  // already in play). newParcelKey is a pure function of the source id, so a
+  // split remainder that keeps its id would otherwise get its parent's key back.
+  const taken = new Set(previous.map((p) => p.parcelKey));
+  const mintFresh = (sourceId: string): string => {
+    const base = mint(sourceId);
+    let key = base;
+    for (let n = 2; taken.has(key); n++) key = `${base}~${n}`;
+    taken.add(key);
+    return key;
+  };
@@
-      result.assigned.push({ sourceId: rec.sourceId, parcelKey: mint(rec.sourceId), how: "new" });
+      result.assigned.push({ sourceId: rec.sourceId, parcelKey: mintFresh(rec.sourceId), how: "new" });
```

And strengthen the test that pinned the label instead of the property
(`tests/unit/landDataPipeline.test.ts`, "a split (shape changed) gets a new key
and retires the old one"):

```diff
     expect(r.assigned[0].how).toBe("new");
     expect(r.retired).toEqual(["TN-47041-A"]);
+    expect(r.assigned[0].parcelKey).not.toBe("TN-47041-A"); // never reused
```

Falsify: revert the crosswalk hunk → the added assertion goes red (today's code
returns `TN-47041-A` for both, measured).

Limits of this fix: it only sees `previous` (the page's neighbourhood). A county
reusing an APN on land in a different page still re-derives the retired key.
Full protection needs the APID ledger (or a `parcel_key` existence check in
`saveOwnedParcels`). Recommended as the follow-up, not part of this wave.

### Related findings (read-only; not D2c's files)

- `countyPipeline.processCountyPage` never consumes `xw.retired` or `xw.aliases`
  (only `xw.assigned`). Retired parcels stay as live owned rows forever. Built
  but unwired.
- `ownedParcelView.ts` finds an owned parcel by `apn = $1 OR sourceIdHistory ∋ $1`
  with `limit(1)` and no ORDER BY. After a renumber followed by the county
  reusing the old number, two rows match and an arbitrary one is returned —
  exactly what APN validity windows prevent (`apidForApnAt` is point-in-time).

## 4. DDL proposals (need COO approval — two new tables)

Row PKs are uuid per Package 4; `apid` is the public text id.

```sql
-- One row per APID ever minted. Never deleted, never re-assigned.
CREATE TABLE parcel_apids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apid          text NOT NULL UNIQUE,                 -- APID-FL-12089-0000042
  state         char(2) NOT NULL,
  county_fips   char(5) NOT NULL,
  seq           bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('active','retired','held')),
  provisional   boolean NOT NULL DEFAULT false,
  minted_in_release text NOT NULL,
  ended_in_release  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state, county_fips, seq),
  CHECK ((status = 'active') = (ended_in_release IS NULL))
);

-- APN validity windows. Half-open [valid_from, valid_to) over release ordinals.
CREATE TABLE parcel_apn_windows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apid_id       uuid NOT NULL REFERENCES parcel_apids(id),
  state         char(2) NOT NULL,
  county_fips   char(5) NOT NULL,
  apn           text NOT NULL,                        -- normalizeSourceId() form
  valid_from    integer NOT NULL,
  valid_to      integer,                              -- NULL = current
  valid_from_release text NOT NULL,
  valid_to_release   text,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
-- Invariants 1 and 2 enforced by the database, not only by ledgerViolations():
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE parcel_apn_windows ADD CONSTRAINT apn_windows_no_overlap
  EXCLUDE USING gist (state WITH =, county_fips WITH =, apn WITH =,
                      int4range(valid_from, coalesce(valid_to, 2147483647)) WITH &&);
ALTER TABLE parcel_apn_windows ADD CONSTRAINT apid_windows_no_overlap
  EXCLUDE USING gist (apid_id WITH =,
                      int4range(valid_from, coalesce(valid_to, 2147483647)) WITH &&);
```

`btree_gist` is an extension — if it is not available on the production
Postgres, fall back to two partial unique indexes (`… WHERE valid_to IS NULL` on
(state, county_fips, apn) and on (apid_id)) plus `ledgerViolations()` before
commit; that enforces "one open window" but not historical non-overlap.

Lineage events — proposed as ONE table, append-only:

```sql
CREATE TABLE parcel_lineage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state         char(2) NOT NULL,
  county_fips   char(5) NOT NULL,
  release_id    text NOT NULL,
  release_ordinal integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('same','renumber','split','merge','condo','retired','new','ambiguous')),
  basis         text NOT NULL CHECK (basis IN ('geometry','id_only')),
  reason        text,                                 -- ambiguous only
  previous_apids text[] NOT NULL,
  next_apids     text[] NOT NULL,
  previous_apns  text[] NOT NULL,
  next_apns      text[] NOT NULL,
  evidence      jsonb NOT NULL,                       -- overlaps[], coverage, flags, continuingId
  resolved_at   timestamptz,                          -- ambiguous review (not built)
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'ambiguous') = (reason IS NOT NULL))
);
```

To save a table (ratchet), `same` events need not be stored (they are the
default and are most rows); store only non-`same` events. Parent links live in
`previous_apids` of split/merge/condo rows, so no separate edge table is
needed. If only ONE new table is approved: `parcel_apids` + windows as JSONB is
NOT recommended (loses the exclusion constraints); prefer `parcel_apn_windows`
+ `parcel_lineage_events`, deriving APID status from them.

Drizzle definitions follow mechanically from the DDL; not written because
`shared/schema/**` is integrator-owned and the shape may change on approval.

## 5. Dependencies

None added. `@turf/turf` 7.3.5 (already in package.json) is used for `intersect`
only. Note `shared/landData/lineage.ts` imports `@turf/turf` — the whole
package — into a `shared/` module; if a client bundle ever imports `lineage.ts`,
prefer `@turf/intersect` + `@turf/helpers` as direct dependencies (proposal
only; package.json is integrator-owned). Today nothing in client/ imports it.
