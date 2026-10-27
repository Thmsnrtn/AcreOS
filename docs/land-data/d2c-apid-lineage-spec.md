# D2c — APID, APN validity windows, parcel lineage, inheritance

Status: spec + pure core (lane D2c, 2026-10-24). Code: `shared/landData/apid.ts`,
`shared/landData/lineage.ts`. Golden: `shared/landData/golden/lineage-golden.json`
(SYNTHETIC). Tests: `tests/unit/apid.test.ts`, `tests/unit/lineage.test.ts`,
`tests/unit/lineageGolden.test.ts`. Table proposals: `INTEGRATION-D2c.md`.

The D2 design docs were not in the repo when this was written, so every design
choice below is stated as an **assumption** (A-n) the COO can overturn.

## 1. Terms

- **APN / source id** — the county's own parcel id in one release. County-scoped,
  and a *label*: counties renumber, split, merge, and sometimes hand a retired
  number to different land later.
- **Release** — one complete snapshot of one county's parcels from one source
  (`{ releaseId, ordinal }`; ordinals strictly increase per county).
- **APID** — the AcreOS parcel id. It names a piece of *land as AcreOS tracks it*
  across releases.
- **parcel_key** — the existing crosswalk key (`shared/landData/parcelCrosswalk.ts`,
  `STATE-FIPS-firstSeenSourceId`), used by the on-demand county pipeline.

## 2. What exists today, and the defect it has

`reconcileCrosswalk` carries a key forward on same-id-and-same-shape
(`same_id`), same-shape-different-id (`renumbered`), and mints otherwise
(`new`). Its header says "the previous key is retired, never reused". **That is
not true of the code as wired.** The mint is `newParcelKey(state, fips, sourceId)`
— a deterministic function of the source id — so when a parcel keeps its id but
changes shape (a split's remainder, a boundary change), the "new" key is
byte-identical to the one just retired. Reproduced on this branch with the
existing test's own inputs (prev `A` area 1000 → next `A` area 500):

```
{"assigned":[{"sourceId":"A","parcelKey":"TN-47041-A","how":"new"}],"retired":["TN-47041-A"]}
```

The same holds when a county reuses a retired APN on different land: the old
key returns. The existing test (`landDataPipeline.test.ts` "a split … gets a
new key and retires the old one") asserts `how === "new"` and the retired list,
but never that the new key differs from the retired one — a gate that pins the
label, not the property. Proposed test fix is in INTEGRATION-D2c.md §3.

The crosswalk also has no lineage (a split is just "new" + "retired", with no
parent link), no validity windows (aliases have no dates), and its
"geometry matches" test is centroid ≤ 5 m and area within 2 % — it cannot tell
a split from a merge, or detect a condo stack.

## 3. APID

**Format** (A-1): `APID-{ST}-{FIPS5}-{seq}`, seq zero-padded to ≥ 7 digits, e.g.
`APID-FL-12089-0000042`. The `APID-` prefix makes it impossible to confuse with a
parcel_key (`FL-12089-…`) or an APN. Human-readable and county-scoped so support
and logs can read it; the table's row PK can still be uuid (Package 4) with
`apid` a unique text column.

**Minting rule**: from a per-county **monotonic counter** (`ledger.nextSeq`, a
DB sequence or `county_apid_counter` row in production). **Never derived from
the APN or the geometry.** Consequences, each tested:

- an APID is minted exactly once (`ledgerViolations`: sequence unique and
  `< nextSeq`);
- a retired or held APID is never assigned again — identity is carried only from
  an APN's *open* window, and an ended APID has none (`apid.test.ts` "never
  reused", including a county reusing a retired APN in the same place: new APID);
- re-ingesting an unchanged release mints nothing.

Alternative considered: random uuid APIDs. Also never reused (probabilistically),
but unreadable, and they make the golden/tests non-deterministic. Rejected for
the public id; fine for the row PK.

**Carry rule**: an APID moves from a previous record to a next record only when
lineage says the land is the same: `same`, `renumber`, or the record of a condo
stack that keeps the parent's id on the parent's footprint. Everything else mints.

**Statuses**: `active` (names current land, exactly one open APN window),
`retired` (ended by retired/split/merge/condo), `held` (ended by an `ambiguous`
event — awaiting review; NOT retired, so a reviewer can later resolve it into a
link rather than having a decision baked in).

## 4. APN validity windows

Each (APN → APID) pairing has a half-open window over release ordinals
`[validFrom, validTo)`; `validTo = null` while current. Invariants (checked by
`ledgerViolations`, falsified in tests by hand-broken ledgers):

1. For one APN, windows never overlap; at most one is open.
2. For one APID, windows never overlap; an active APID has exactly one open.
3. No empty or inverted window (`validTo > validFrom`).
4. Retired/held APIDs have no open window.

Within one release all closes are applied before any opens, so an APN that moves
between events in the same release (e.g. a split's remainder keeping the
parent's number: closes on the parent APID at ordinal n, opens on the child APID
at n) never overlaps itself. Point-in-time lookup: `apidForApnAt(ledger, apn, ordinal)`.

## 5. Lineage detection

Input (`LineageInput`): two snapshots of one county, records
`{ sourceId, geometry: Polygon | MultiPolygon | null }`. D2b's release diff is
adapted to this by the integrator (INTEGRATION-D2c.md §2).

### 5.1 Geometry

Both snapshots are projected with **one** local equirectangular projection
centred on the input's bounding box. That projection is affine, so **area ratios
are exactly the lng/lat area ratios** — the only quantity the classifier reads —
which is what makes the golden hand-computable. Absolute m² are within the usual
parcel-scale < 1 % error. Intersections: `intersect` from `@turf/turf` 7.3.5
(polyclip-ts — a planar clipper; already a dependency, nothing added), run on the
projected coordinates; areas are planar shoelace sums with holes subtracted
(turf's own `area` is geodesic and is deliberately not used). A uniform 250 m
bbox grid keeps a county release near-linear. A pair the clipper throws on is
`unmeasurable` and makes its group `ambiguous(geometry_unmeasurable)`, never
silently disjoint.

### 5.2 Fractions and thresholds (A-2)

For a previous parcel P and next parcel N with intersection I:
`fP = I / area(P)`, `fN = I / area(N)`.

| threshold | value | meaning |
|---|---|---|
| `covers` | 0.95 | a fraction ≥ this is "all of it" (re-digitizing moves a few % of a small parcel) |
| `negligible` | 0.02 | a pair with BOTH fractions below this is a shared-edge sliver, not a relationship |
| `sameFootprint` | 0.98 | two records of ONE release with both mutual fractions ≥ this are one footprint (condo stack) |

Pair (edge) kinds: ignored if `fP < neg ∧ fN < neg`; `equal` if `fP ≥ covers ∧ fN ≥ covers`;
`next_within_previous` if `fN ≥ covers`; `previous_within_next` if `fP ≥ covers`;
otherwise `partial`. **The band between `negligible` and `covers` is the ambiguous
band**: any partial edge makes its group ambiguous.

### 5.3 Units and groups

1. Records whose id lacks usable geometry on **either** side go to the **id-only**
   path (A-3): same id both sides → `same`, previous only → `retired`, next only →
   `new`, all labelled `basis: "id_only"`. Renumbering cannot be detected without
   geometry and is not guessed. (Unusable = null, < 3 points, non-finite
   coordinates, zero area; unclosed rings are closed.)
2. Within each release, records on one footprint are unioned into a **unit**
   (a condo stack when it has ≥ 2 ids).
3. Edges between previous and next units → connected components. Each component
   is classified once; every source id of both releases lands in exactly one
   event (tested as a partition).

### 5.4 Classification of a component (|P| previous units, |N| next units)

| shape | rule | event |
|---|---|---|
| 1 : 0 | — | `retired` |
| 0 : 1 | — | `new` |
| 1 : 1, `equal`, single ids | ids equal / differ | `same` / `renumber` (coverage = min(fP, fN)) |
| 1 : 1, `equal`, single → stack | — | `condo`; `continuingId` = the stack record that keeps the parent's id, if any |
| 1 : 1, `equal`, stack → single | — | `merge` flagged `condo_stack`, `condo_dissolution` |
| 1 : 1, `equal`, stack → stack | pair by id only; common ids `same`; leftovers on ONE side only → `retired` / `new`; leftovers on both sides or nothing in common | per-id events / `ambiguous(condo_units_unpairable)` |
| 1 : 1, not `equal` | — | `ambiguous(boundary_change \| partial_overlap)` |
| 1 : k≥2 | every edge has `fN ≥ covers`; `covers ≤ Σ fP ≤ 2 − covers` | `split` (coverage = Σ fP); else `ambiguous(split_coverage_short \| overlapping_parts \| partial_overlap \| many_to_many)` |
| k≥2 : 1 | every edge has `fP ≥ covers`; `covers ≤ Σ fN ≤ 2 − covers` | `merge` (coverage = Σ fN); else `ambiguous(merge_coverage_short \| …)` |
| anything else | — | `ambiguous(many_to_many)` |

Flag `apn_reused_for_different_land` marks `retired`/`new` events whose id exists
in both releases but whose land does not overlap — the county reused the number.

A split's remainder that keeps the parent's APN is still a split (A-4): the APN
now names different, smaller land, so the remainder gets a new APID with the
parent as ancestor. Carrying the APID there would make "APID = this land" false.

Refusal: a release that lists one source id twice is refused
(`duplicate_source_id`) — the classifier does not pick one.

### 5.5 Ambiguous is an outcome, not a fallback

An ambiguous event carries every measured pair (ids, m², both fractions), the
reason code, and the full id sets. In the ledger: previous APIDs become `held`,
next records get **provisional** APIDs with `candidateParents` (shown to a
reviewer, never as lineage). Nothing is inherited. Review resolution (A-5, not
built): a reviewer turns candidates into a real `split/merge/renumber` link, or
confirms the discontinuity (held → retired). Because held APIDs are not retired,
no resolution requires reusing an ended APID.

## 6. Inheritance

`INHERITANCE_RULES` / `inheritanceFor(event)`:

| event | identity | history |
|---|---|---|
| same, renumber | carried (keeps the APID) | own — it *is* the parcel's history |
| split, merge, condo | minted; parents recorded | ancestral — parents' history is linked and shown **as the parents'** |
| condo record keeping the parent id | carried | own |
| new | minted | none |
| ambiguous | provisional | none (candidates only) |
| retired | — | — |

**Field values are never inherited** (A-6): owner, situs, assessed/market value,
sale, legal description come only from the record's own release. Copying a
parent's assessed value or last sale onto a child would present a number the
source never stated about that parcel — fabrication. Derived facts (acres, flood,
slope, frontage) are always recomputed from the child's own shape. What a child
gains is a *link*: "this parcel was split from APID-… in release R; that parcel's
sale history: …", attributed to the parent.

## 7. Extend parcelCrosswalk.ts, or sit beside it? — **Beside it, then replace its mint**

Recommendation: keep APID/lineage as separate modules (done) and do **not** grow
`parcelCrosswalk.ts` into them. Reasons:

1. **Different inputs.** The crosswalk works on centroid + area summaries of one
   page of an on-demand ArcGIS crawl (`countyPipeline.processCountyPage`, a bbox
   neighbourhood, not a whole release). Lineage needs whole-release snapshots and
   real polygons — a page boundary cuts splits and merges in half, so a partial
   window would misclassify them. They answer different questions at different
   granularity.
2. **Different semantics.** The crosswalk's "no geometric match → new" is exactly
   the guess the lineage spec forbids; changing that inside the crosswalk would
   silently change the on-demand pipeline's behaviour for every stored
   `parcel_snapshots` row.
3. **Keys already stored.** `parcel_key` values are persisted on
   `parcel_snapshots`; reformatting them is a data migration, not a refactor.

But the crosswalk's reuse defect (§2) should be fixed now, independently: its
`mint` must not be a pure function of the source id. Minimal proposal in
INTEGRATION-D2c.md §3 (mint a retired-safe key, plus the test that pins "the new
key ≠ any retired key"). Longer term (A-7), once bulk releases (D2a/D2b) cover a
county, the APID ledger is the identity of record for that county and
`parcel_key` becomes an alias column pointing at an APID.

## 8. Golden lineage case

`shared/landData/golden/lineage-golden.json` — `"synthetic": true`, every id
`SYNTHETIC-…`, 22 cases of hand-drawn rectangles (units of 0.0001°) covering every
event kind, both condo directions, multipolygon children/parents, the id-only
path, the shared-edge sliver, an APN reused for different land, and the band on
both sides of `covers` (split coverage 0.96 → split, 0.94 → ambiguous). No real
county lineage golden exists: that needs two verified releases of one county with
an assessor-confirmed split/merge/renumber, which is not on hand, so none is
invented.

## 9. Assumptions for the COO

- A-1 APID format/sequence (§3).
- A-2 thresholds 0.95 / 0.02 / 0.98 — not calibrated on real releases; calibrate
  on the first two real releases of a county (count of ambiguous events per 1,000
  parcels is the measurement).
- A-3 geometry-less records are decided by id only and labelled so.
- A-4 split remainder keeping its APN gets a new APID.
- A-5 ambiguous → held + provisional; review workflow not built.
- A-6 field values never inherited.
- A-7 crosswalk keys become aliases of APIDs once a county has bulk releases.
