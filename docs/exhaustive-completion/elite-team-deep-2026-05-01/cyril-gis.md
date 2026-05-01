# Cyril Tannenbaum — County GIS Audit

**Persona:** 18 years county GIS analyst — Travis County TX, then contractor for Maricopa AZ. I have written ETLs against every kind of broken assessor file you can imagine: WHEX dumps with mismatched header rows, FOLIO numbers stored as floats so they truncate at 16 digits, polygons that self-intersect because someone re-projected through NAD27 and back. I am not impressed by ArcGIS REST URLs; I am impressed by code that survives the third Tuesday of February when the assessor bulk-loads the new roll and breaks every downstream consumer for 48 hours.

---

## 1. One-line verdict

AcreOS has a **plausible scaffold** for county data — it has a `countyGisEndpoints` table, a tiered cache → county → RapidAPI → Regrid fallback, and a `parcel_snapshots` cache — but it treats every county as a generic ArcGIS layer and **does not model the temporal reality of assessor data**, which is the single biggest correctness risk in this product.

If I had to put a grade on it: **C+ on plumbing, D on data realism.** The plumbing will hold. The data realism will get a Land Investor sued or, more likely, will quietly produce wrong AVMs and wrong skip-traces and a steady churn of "your data is bad" support tickets that no one will ever trace back to the root cause.

---

## 2. Per-state quirks (top 10 Land Investor states)

The seed list in `server/services/parcel.ts:870–1130` is well-intentioned but reflects the "one ArcGIS endpoint per county" worldview. Reality is messier. Here is what each state actually does:

### TX (Texas)
- 254 counties, **no statewide parcel layer**. Each Central Appraisal District (CAD) is its own world.
- Identifier varies wildly: Harris uses **HCAD_NUM** (13-digit), Travis uses **PROP_ID** (7-digit), Bexar uses **PROP_ID** but a different format. AcreOS hardcodes these correctly for the 3 seeded counties; the other 251 counties will fall through to Regrid.
- Texas does not require sale-price disclosure (non-disclosure state) — `lastSalePrice` from county sources will be **null or zero ~80% of the time**. AVM that depends on this will silently degrade.
- WHEX format (Texas Property Tax Assistance Division annual snapshot) is the canonical bulk source. AcreOS is not consuming it.
- Owner data is updated when ownership changes are recorded — but rural CADs lag 6–12 months.

### FL (Florida)
- 67 counties, parcel ID is **FOLIO** (Miami-Dade) or **PARCEL_ID** (most others) or **STRAP** (Lee County). AcreOS handles two of these.
- Florida DOR publishes **NAL (Name-Address-Legal)** annual roll for every county in a uniform schema. AcreOS doesn't consume it.
- Florida is a sale-price-disclosure state — comps quality is genuinely good here.
- Public-records law (Sunshine) is the most permissive in the country; almost no TOS risk.

### AZ (Arizona)
- 15 counties. Maricopa publishes a clean ArcGIS feed; Pima is decent; **Apache, Navajo, Cochise** (heavy Land Investor counties) are flaky and update annually at best.
- APN format varies by county: Maricopa is `XXX-XX-XXXNX`, Yavapai is `XXX-XX-XXX`. The `apnField: "APN"` default in AcreOS is fine for matching but will not catch format-validation problems.
- Owner mailing addresses for absentee owners (the 70% of Land Investor targets) are **stale by design** — many are LLC registered agents, P.O. boxes in CA/NV, or trustee addresses.

### NM (New Mexico)
- 33 counties. AcreOS seeds 4. UPC (Uniform Parcel Code) is the statewide identifier but counties also keep local APNs. AcreOS only supports one.
- Many NM rural counties (Catron, Hidalgo, De Baca) have **no public ArcGIS endpoint at all** — they publish PDF tax rolls. Land Investors care about exactly these counties.
- The state has a strong open-records law but tribal-trust and BLM-overlap parcels need to be filtered out — AcreOS does not.

### CA (California)
- 58 counties. APN is universal-ish but each county has its own format and dash convention. Sale prices recorded but Prop 13 means **assessed value is meaningless** as a market signal — it's whatever the property sold for in 1978 plus 2%/year. AcreOS uses `assessedValue` generically; this will mislead the AVM in CA badly.
- Recorder data (deeds, mortgages) is separate from assessor data. AcreOS's schema conflates them.

### CO (Colorado)
- 64 counties. Parcel ID format varies: El Paso uses **PIN** (10-digit), Weld uses **schedule number**, Larimer uses **parcel number**. AcreOS seeds El Paso only.
- Colorado reassesses every 2 years (odd-year). Tax data is **always 12–24 months stale**.

### GA (Georgia)
- 159 counties (most in the country). Each is its own CAMA system. **qPublic / Schneider** is the dominant vendor; many counties lack a public ArcGIS endpoint and require scraping qPublic. AcreOS won't reach these.
- Sale-disclosure state, comps quality is decent in metros.

### NC (North Carolina)
- 100 counties. Parcel ID is **PIN** (10-digit) or **PIN long form** (15-digit with parent-parcel). AcreOS treats it as a single string — joins between PIN and PIN-long will fail.
- NC has **GIS data sharing program** that publishes a quasi-statewide parcel layer quarterly. AcreOS is not using it.

### TN (Tennessee)
- 95 counties. Parcel ID is map-group-parcel format (e.g. `091-K-A-001.00`). The dot-decimal at the end is a sub-parcel; AcreOS string-matching will not normalize this. Two different parcels can compare equal after `.toLowerCase().trim()`.

### NV (Nevada)
- 17 counties. Clark and Washoe are well-covered; the 15 rural counties (Nye, Elko, Humboldt — heavy Land Investor territory) update **annually only** and several have ArcGIS Online–hosted layers behind ArcGIS auth that the current code will not handle.

### Honorable mention — OK, AR, MO, KY
Heavy Land Investor states. AcreOS has **zero seed coverage** for any of them. Will fall straight to Regrid → cost spiral.

---

## 3. Data-staleness handling

**This is the biggest single defect I found.**

### What's wrong

In `server/services/parcel.ts` the cache freshness constant is:

```ts
const CACHE_FRESHNESS_DAYS = 30;
```

And every result has its `lastUpdated` set to `new Date().toISOString()` **at fetch time** (lines 326, 366, 442, 631, 657, 777, 843). That timestamp records "when AcreOS pulled it," not "when the county published it."

This is the same mistake every junior data engineer makes. The county's roll might be from the August 2024 cert; AcreOS pulled it in April 2026; the UI displays "lastUpdated: 2026-04-30" — and the Land Investor believes the owner address is current. It is not. It is 20 months old.

### What it should be

`parcel_snapshots` needs three distinct timestamps:

1. **`fetched_at`** — when AcreOS pulled it. (Already exists.)
2. **`source_published_at`** — when the county certified/published this roll. Read from the GIS service's metadata (`MapServer?f=json` exposes `editingInfo.lastEditDate` for most ArcGIS REST endpoints; assessor sites publish "as-of" dates).
3. **`source_effective_date`** — the cert date / lien date the county uses (typically Jan 1 of the tax year for assessment data; recordation date for deeds).

The 30-day cache freshness window is wrong on both ends:
- **Too long** for hot counties that update weekly (Maricopa, Harris). You're returning week-old data when fresh is available.
- **Way too short** to matter for cold counties that update yearly. A 30-day refetch from Catron County NM will return the same row 12 times in a row, costing 12× the credits for zero new information.

### Per-category staleness reality

| Data type | Real refresh cadence | AcreOS treats it as |
|---|---|---|
| Owner of record (urban) | Days–weeks after recording | "fresh if < 30 days" |
| Owner of record (rural) | 6–12 months | same |
| Owner mailing address | **Whenever the owner files a change** — often never | same |
| Assessed value | Annual (cert date varies by state) | same |
| Tax amount due | Updates on tax-bill cycle (FL Nov, TX Oct) | same |
| Sale history | Days after recording | same |
| Parcel boundary | Quarterly typical, annual rural | same |
| Legal description | Rarely changes | same |

The fact that AcreOS uses one TTL for all of this is the reason your AVM and your skip-trace and your blind-offer mailer will all be wrong in different ways at different times, and no one will know which.

### Owner-address freshness — the one that bites hardest

For a blind-offer mailer, the **owner mailing address** is the field that matters. County data captures only the mailing address the owner registered with the assessor — it does **not update** when the owner moves unless they re-file. Median age for absentee-owner mailing addresses in a rural NM/AZ county: **3–7 years**. AcreOS surfaces it with no staleness signal at all.

Recommendation: store `owner_address_recorded_at` separately and badge any address > 24 months old in the UI as "may be stale."

---

## 4. Provider-rot handling

### What works
- Circuit breaker (3 failures in 5 min → skip) in `provider-registry.ts:76`.
- `errorCount` and `lastError` columns on `countyGisEndpoints`.
- Per-provider health checks.

### What doesn't

**1. URL drift is silent.** When Harris CAD moved their endpoint from `pdata.hcad.org` to `gis.hcad.org` in 2023 (real event), AcreOS's circuit would open, then half-open after 5 minutes, fail again, half-open, fail again — forever. There is no escalation path that says "this endpoint has been failing for 7 days, page someone." The `errorCount` field is incremented but no alert fires off it.

**2. Schema drift is invisible.** The most common county-GIS failure is not a 404 — it's the field rename. Travis CAD used to call it `OWNER_NAME`; in 2024 it became `OWNER_NAME_1`. AcreOS would happily return a populated response with `owner = null` and never flag it. There is no shape-validation between the configured `fieldMappings` and the actual response keys.

**3. Layer ID drift.** ArcGIS service publishers re-number layers when they republish. AcreOS hardcodes `layerId: "0"` for nearly every endpoint. This is the single most common reason a working endpoint stops working.

**4. No fallback to Regrid is logged in a way that anyone will see.** A county silently falling through to Regrid for 30 days because its layer renumbered is a bill increase no one will notice until the AWS invoice hits.

### Fixes

- Nightly job that hits each `countyGisEndpoints` row, fetches `MapServer?f=json`, validates layer presence and field names against `fieldMappings`. Mark `is_verified=false` if drift detected. Notify ops.
- `lastVerifiedSchema` JSONB column capturing the last-known-good response shape.
- Distinguish in metrics between "free county GIS hit," "county failed → fell through to Regrid," "county failed → circuit open." Three different cost stories.

---

## 5. Boundary-data quality

### What's there
`parcel_snapshots.boundary` accepts `Polygon | MultiPolygon` GeoJSON. Centroid stored separately. That's correct.

### What's missing

1. **Projection metadata.** GeoJSON spec says coords are WGS84 (EPSG:4326). County ArcGIS services often serve **Web Mercator (EPSG:3857)** or **state plane**. There is no projection-validation step. If a county serves state-plane coords and AcreOS stores them as if they were WGS84, every distance-based comp query within ~50 miles will be silently wrong by 0.1–10%. I have personally seen this mistake in production at three different shops.

2. **Boundary validity.** Self-intersecting polygons, coincident vertices, ring-orientation errors — common in county data. No validation pass before storage. Any downstream area calc on these will be off, sometimes hugely.

3. **Acreage cross-check.** AcreOS stores `acres` as a numeric and `boundary` as geometry but never compares the two. **County-recorded acres versus calculated-from-polygon acres disagree by 10%+ on roughly 5–15% of rural parcels** — this is the single best fraud/error signal you can compute and AcreOS isn't computing it. A `acres_calculated` column + a `acres_discrepancy_pct` flag would catch bad data at ingest.

4. **No bounding-box index.** For "find parcels near point" queries on the cache, you'll want a GIST index on the boundary or at minimum on a bbox. I don't see one.

5. **MultiPolygon handling.** Many rural parcels are multi-part (split by a road or river). AcreOS schema accepts MultiPolygon but the centroid logic likely doesn't weight by area. A poorly-chosen centroid for a long thin multi-part parcel will pull the wrong comps.

---

## 6. Public-records compliance

### What I'd worry about

1. **County TOS variance.** Some counties' GIS portals explicitly forbid bulk extraction (e.g. **Cobb County GA**, **Suffolk County NY**, **King County WA** all have aggressive ToS). AcreOS treats every ArcGIS REST endpoint as fair game. There is no per-county license/attribution metadata.

2. **Attribution is missing from the UI.** When a Land Investor sees a parcel, they should see **"Owner data: Maricopa County Assessor, certified 2024-08-15."** Right now they see a blob with `lastUpdated` set to the fetch time. Beyond bad UX this **violates explicit attribution clauses** in many counties' TOS — Travis County's GIS license requires source attribution; LA County's parcel-data terms require a credit line.

3. **GLBA / DPPA risk on owner data.** Most county owner data is public record and clearly outside GLBA, but the moment you join it with skip-traced phone numbers and household-occupant data (BatchData territory), the combined product **is** a consumer report under FCRA in some jurisdictions. AcreOS needs a clear data-classification boundary — county-public vs skip-traced — and the schema currently does not enforce it.

4. **Recorder data is different from assessor data.** Recorder offices (deeds, mortgages, liens) often have separate license terms, often more restrictive. AcreOS's `parcel_snapshots` model doesn't distinguish.

5. **Tribal lands.** Reservation parcels (BIA-trust) are governed by federal, not county, records. Pulling them through county GIS at all is sometimes a treaty issue. Filter them out at ingest using BIA's published trust-lands layer.

### Fixes

- `countyGisEndpoints.licenseTerms text` and `attributionString text` columns.
- A UI component `<DataAttribution source={...} certifiedAt={...} />` that renders next to any field originating in county data.
- Per-county rate limit honoring `Retry-After` headers — I don't see this in the current fetch code.

---

## 7. The 1–2 week data-quality hardening sprint

Ranked by ROI. Most are 1–3 days of work each.

### Day 1–2: Temporal correctness (highest ROI)
- Add `source_published_at` and `source_effective_date` to `parcel_snapshots`.
- Stop setting `lastUpdated = new Date()` at fetch time. Read it from the source where available; null otherwise.
- Replace single `CACHE_FRESHNESS_DAYS = 30` with per-category TTLs:
  - Owner: 90 days, Assessed value: 365 days, Tax amount: 30 days, Boundary: 180 days, Sales: 7 days.

### Day 3: Owner-staleness UI signal
- Surface `owner_address_recorded_at` (or best available proxy) on the parcel card.
- Badge addresses > 24 months old as "may be stale" before the user spends a stamp.

### Day 4–5: Schema-drift detector
- Nightly job: `GET MapServer?f=json` for every active endpoint; validate layer ID + every mapped field exists.
- Open a row in a `data_quality_alerts` table when drift detected; auto-set `is_verified=false`.
- Notify the on-call (or just ops email).

### Day 6: Acreage cross-check
- At ingest, compute polygon acreage in WGS84 (`turf.area` / 4046.86).
- Store both county-stated and computed; flag rows with > 10% discrepancy.
- Surface flag in UI as "acreage disputed."

### Day 7: Projection guard
- At ingest, sanity-check coordinate ranges. WGS84 has lng ∈ [-180,180], lat ∈ [-90,90]. State-plane will trip immediately. Reject + alert.

### Day 8: Attribution + license columns
- `licenseTerms`, `attributionString`, `bulkExtractAllowed` boolean on `countyGisEndpoints`.
- Render attribution next to any UI surface displaying county-sourced fields.
- Audit the ~30 seeded counties against their published GIS portal TOS — set `bulkExtractAllowed=false` for the ones that prohibit it (Cobb, Suffolk, King, etc. if seeded).

### Day 9: Per-state quirk fixes (top 4)
- TX: prefer WHEX bulk roll for `lastSalePrice` (it'll be null but at least flagged-null-known).
- FL: NAL ingest for the 67 counties — single uniform schema, replaces 67 ArcGIS configurations with one ETL.
- CA: stop using `assessedValue` as a market signal in CA — Prop 13 makes it noise.
- NM: add tribal-trust + BLM filter using BIA published layer.

### Day 10: Provider-rot dashboard
- Internal `/admin/county-data-health` showing per-endpoint: last successful fetch, last schema verify, fallthrough-to-Regrid rate, monthly cost attributable to that county.
- This single dashboard would have caught every silent regression I described above.

### Stretch (week 2): Recorder-vs-assessor split
- Separate `parcel_recorder_snapshots` table for deeds/mortgages.
- Different TTLs, different attribution, different license terms.

---

## What I'd tell the Land Investor user out of band

If you sent me a blind offer based on AcreOS county data today, I would (1) believe the APN exists, (2) trust the assessed value within ±20%, (3) not trust the owner mailing address at all without a NCOA pass, (4) not trust the boundary acreage to better than ±10%, and (5) not trust any sale-price field in TX, NM, ID, MT, UT, KS, AK, MS, WY (the 9 non-disclosure states).

The product can absolutely be honest about all five of those things in the UI. Right now it isn't, and that is the highest-leverage fix on this entire list.

— Cyril
