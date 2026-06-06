# Open-Data Architecture — Lens (Iris / Andrei / Iyari hat)

**Author:** Iris (CTO), wearing the Open-Data Architect hat for Tom's specific ask.
**Date:** 2026-06-06
**Scope:** the best-in-class FREE/open land-data sourcing strategy for the US land-investor use case, how it plugs into the existing provider registry + `provider_cache`, a phased rollout, and the trigger-based path to paid Regrid/Zamplo/PropGrid later.

---

## TL;DR for the founder

We are in a better position than the ask assumes. **The free-data layer already largely exists** and is good. The mature surface is `server/services/data-source-broker.ts` (1,906 lines) — it already hits ~30 live free government endpoints (FEMA NFHL flood, USFWS NWI wetlands, USDA SSURGO soils via SDA, USGS 3DEP elevation via EPQS, Census TIGERweb + ACS, BLM PLSS cadastral + surface management, USDA NASS CropScape + CDL, MRLC NLCD land cover, FEMA NRI risk, EPA FRS/TRI, NOAA storms/climate, USGS NWIS water, FCC broadband). Parcel boundaries come from county ArcGIS endpoints (`county_gis_endpoints`, ~34 counties seeded in `server/services/parcel.ts:869`).

**The real problem is not "we have no free data." It is three things:**

1. **Two parallel data spines that don't share a brain.** The new `provider-registry` (`server/services/providers/`) has the good bones Tom describes — tier filtering, credit deduction, circuit breaking, `provider_cache`. But it is **barely consumed**: outside its own module, the only caller is `routes-admin.ts`. Meanwhile the older `DataSourceBroker` is called 26 times across services (`dueDiligenceEngine`, `dealFeedEngine`, `dataIntelligenceEngine`, `acquisitionRadar`, `zoningService`, `propertyReportPdf`, etc.). The registry's `open-data-provider` is a thin bridge that only re-exposes **3 of the broker's ~28 categories** (`environmental`, `demographics`, `parcel_data`). So the architecture Tom wants is real but half-wired.

2. **Parcel coverage is the binary gap.** ~34 counties seeded. A land investor working a county we haven't seeded gets nothing on the one field that matters most (the boundary + owner). This is the difference between "premium free tier" and "broken."

3. **No freshness/provenance honesty.** Free county data is authoritative but stale (tax-year lag) and uneven. We currently stamp a flat `confidence: 80`. First customers will trust a number; we owe them "as-of date + source name + this is an estimate" on every field.

My strong recommendation: **do not buy paid data to fix this.** Fix the wiring and the coverage. The free stack, properly consolidated and presented, is genuinely premium for land — soils/flood/wetlands/topo/PLSS is data the cheap competitors *don't* surface well. That is our wedge, not our weakness.

---

## My take on the open-data theme (the opinionated part)

**Free government data for land is not the "budget tier" — for land specifically it is the *better* tier.** The paid aggregators (Regrid/ATTOM) are optimized for *structures* (homes, square footage, beds/baths, comps). Land investors care about **dirt characteristics**: flood zone, wetlands %, soil capability class + percolation, slope/buildability, road frontage/access, PLSS legal, zoning, mineral/surface estate, ag value. Almost all of that is free and federal, and most paid products either don't have it or charge extra. So the strategy is not "make the free tier feel premium despite being free" — it's "lean into the dirt data the paid guys are weak on, and only rent the parcel-fabric + skip-trace from paid providers when MRR justifies it."

The one thing free can't give us at national scale is a **complete, normalized parcel fabric** (every parcel boundary + owner in every county in one schema). That is precisely what Regrid sells, and precisely the right thing to defer until customers are paying. Everything else, we own for $0.

**The discipline this demands:** every free endpoint is someone else's uptime. The registry's circuit breaker (`CB_FAILURE_THRESHOLD = 3` in 5 min) and `provider_cache` are exactly the right primitives. The rule is: **never let a customer-facing surface depend synchronously on a single free endpoint being up.** Cache aggressively, degrade gracefully, show provenance, and pre-warm the hot path with ETL where we can.

---

## Top work items (priority order)

### 1. Unify the two data spines: make the broker a registry provider, not a parallel system
- **Why it matters to first customers:** today, whether a customer gets credit-metering, circuit-breaking, and `provider_cache` depends on *which code path* served their request. That's a reliability and billing-correctness lottery. One spine = consistent behavior, one place to reason about cost and failure.
- **Goal served:** rock-solid system; near-zero overhead (one cache, one breaker).
- **Effort:** L
- **Phase:** 0→1
- **Dependencies:** none blocking; touches `data-source-broker.ts`, `open-data-provider.ts`, `provider-registry.ts`.
- **First step:** expand `open-data-provider.ts` to map **all** broker `LookupCategory` values into registry `DataCategory` (add `environmental` sub-kinds: `flood`, `wetlands`, `soil`, `elevation`, `land_cover`, `cropland`, `natural_hazards`, `plss`, `water_resources`). Then flip the 26 direct `dataSourceBroker.lookup(...)` callers to go through `providerRegistry.lookup(...)` / `enrichAll(...)`. Do it behind a feature flag, one consumer at a time, starting with the property report. Long-term, the broker becomes the *fetch implementation* the free provider delegates to — keep its 30 endpoint integrations, retire its parallel cache/health logic in favor of the registry's.

### 2. Close the parcel-coverage gap with auto-discovery + a contribution path
- **Why it matters:** the boundary + owner is the field a land investor lives on. A blank parcel card on day one kills trust. ~34 seeded counties is a demo, not coverage.
- **Goal served:** customer happiness; premium free feel.
- **Effort:** M (discovery harness exists), L (national)
- **Phase:** 0→2
- **Dependencies:** `arcgis-discovery.ts` (already searches ArcGIS Online for parcel/assessor services), `county_gis_endpoints`.
- **First step:** wire `arcgis-discovery.ts` into a scheduled job (`runScheduledJobs.ts`) that, on a parcel-lookup *miss* for an unseeded county, kicks off a background discovery + validation pass and auto-inserts a verified `county_gis_endpoints` row (set `isVerified` only after a real test query returns the mapped fields). Add a lightweight "this county isn't covered yet — request it" CTA behind the Map door so demand routes coverage priority. Stretch: ingest state GIS clearinghouse statewide parcel layers (TX/FL/NC/MN/MT publish statewide) to cover dozens of counties per endpoint.

### 3. Provenance + freshness on every field ("as-of" honesty)
- **Why it matters:** free data is uneven and stale. A customer who sees `Flood: Zone X` with no source and no date, then gets burned, never trusts us again. A customer who sees `Flood: Zone X · FEMA NFHL · as of 2024-08` *trusts the whole product more* — including the free parts.
- **Goal served:** customer happiness + trust; turns "free" into "transparent," which reads as premium.
- **Effort:** S–M
- **Phase:** 0
- **Dependencies:** `LookupResult` already carries `provider`, `confidence`, `fetchedAt`, `cached`.
- **First step:** thread `sourceName`, `sourceUrl`, `asOfDate` (from the upstream layer's metadata where available) into `LookupResult.data` and render a small "source + date" affordance on each datum behind the Map and Deals doors (customer-facing = Pax persona only). Stop hardcoding `confidence: 80`; derive it from data age + source authority.

### 4. Pre-warm the hot path with targeted ETL, don't fetch synchronously
- **Why it matters:** p95 on the daily loop must stay <300ms (my bar). A synchronous USDA SDA soils call or FEMA polygon query can take seconds and occasionally times out. Customers should never feel that.
- **Goal served:** rock-solid; performance budget.
- **Effort:** M
- **Phase:** 1
- **Dependencies:** existing ETL orchestrator (`etlHandlers.ts`, `femaEtlHandler`, `etl_jobs` table), `parcel_snapshots` cache.
- **First step:** when a customer saves/imports a parcel, enqueue a background "enrich-all-free-categories" job that populates `parcel_snapshots` + `provider_cache` so the next view is a cache hit. Customer-facing reads serve cache-first; live fetch is the fallback, not the default. Extend `parcel_snapshots` to hold the full free-enrichment bundle (it already has `rawData jsonb`).

### 5. A single typed "Land Profile" model the free sources feed into
- **Why it matters:** right now each source returns its own shape. The customer-facing card and the AI (Pax) both need one coherent object: boundary, acreage, owner, legal/PLSS, zoning, flood, wetlands%, soil class + perc, slope/buildable%, road access, land cover, ag value, hazards. That normalized object is the product.
- **Goal served:** customer happiness; unblocks Pax answering land questions accurately.
- **Effort:** M
- **Phase:** 1
- **Dependencies:** items 1 + 3.
- **First step:** define `LandProfile` in `shared/` with per-field `{ value, sourceName, asOfDate, confidence }`; have the unified free provider populate it; render it as the canonical parcel card. Pax reads `LandProfile`, never raw provider blobs.

### 6. Resilience hardening on free endpoints (cache TTL by volatility, stale-while-revalidate)
- **Why it matters:** the default `provider_cache` TTL is a flat 24h (`DEFAULT_CACHE_TTL_MS`). Soils and PLSS effectively never change; flood maps change rarely; tax/owner changes annually. A flat TTL either re-hammers stable endpoints or serves stale tax data. And when an endpoint is down, we should serve stale cache rather than nothing.
- **Goal served:** rock-solid; near-zero overhead.
- **Effort:** S
- **Phase:** 0→1
- **First step:** make cache TTL per-category (soils/PLSS: 1yr; flood/wetlands/land-cover: 90d; parcel/owner/tax: 30d; demographics: 90d). Add stale-while-revalidate: on circuit-open, return expired cache flagged `stale: true` with its `asOfDate` instead of returning `null`.

---

## Concrete free / open sources (the named list, best-for-land first)

> Licensing note that governs all of this: **US federal works are public domain (17 U.S.C. §105) — freely redistributable.** County/state open data is overwhelmingly public-record but terms vary by jurisdiction (some require attribution, a few restrict bulk redistribution). **OpenStreetMap is ODbL** — share-alike + attribution, which means OSM-*derived* data carries obligations; use OSM for context/geocoding, keep it out of redistributed datasets unless we honor ODbL. Track per-source license in the `data_sources` table and surface attribution in the UI.

(See the structured summary for the per-source table: SSURGO soils, FEMA NFHL flood, USFWS NWI wetlands, USGS 3DEP elevation/slope, county assessor/GIS ArcGIS, state GIS clearinghouses, Census TIGER + ACS, BLM PLSS cadastral, USDA NASS CropScape/CDL, MRLC NLCD, FEMA NRI, EPA FRS/TRI, NOAA, OSM/Nominatim, Census Geocoder.)

---

## How it plugs into the registry + `provider_cache` (keeping overhead near-zero)

- **One free provider, many categories.** The free stack stays a single registry provider (`tierRequired: "free"`, `costPerLookupCents → 0`), registered across all land categories at low priority numbers so it's *always tried first*. The registry already sorts free→paid before priority (`provider-registry.ts:358`), so paid providers only ever fire on a free miss. That is exactly the cost-control posture we want pre-revenue.
- **`provider_cache` is the overhead sink.** Every successful free lookup is written fire-and-forget (`writeCache`) and read first (`readCache`). With per-category TTL (item 6), a county we've touched once costs ~$0 and ~0ms to serve again. This is what makes free *feel* premium — it's fast on repeat.
- **Circuit breaker protects us from flaky federal endpoints.** Already implemented (3 failures / 5 min). Pair it with stale-while-revalidate (item 6) so a FEMA outage degrades to "as-of date" data, not a blank card.
- **Credit deduction stays untouched.** Free = 0 cents, never decrements. The moment we register a paid provider, the *same* metering and circuit logic applies — no new billing code when we upgrade.

---

## Phased rollout

| Phase | Add | Trigger |
|---|---|---|
| 0 (now) | Unify spines (start), provenance/as-of on every field, per-category cache TTL + stale-while-revalidate, expand `open-data-provider` to all categories | Pre-first-customer; zero $ cost |
| 1 ($200 MRR / first paying customers) | Background enrich-all ETL into `parcel_snapshots`, normalized `LandProfile`, finish spine unification | First customers using daily loop; need <300ms + Pax accuracy |
| 2 ($1k MRR) | National parcel coverage via auto-discovery + state clearinghouse statewide layers; coverage-request CTA | Customers hitting unseeded counties; coverage = churn risk |
| 3 ($5k MRR) | Layer paid providers (Regrid first) as fallback-only behind free; satellite/imagery; advanced comps | Free misses concentrated in specific counties/categories that paid fixes; MRR covers the fee |

---

## Path to paid (Regrid / Zamplo / PropGrid) — trigger-based

We already have `regrid-provider.ts`, `attom-provider.ts`, `batchdata-provider.ts` implemented and registered as fallback tiers — they fire only on a free miss and only when their API key is set. So the *code* path to paid is done. The decision is purely economic:

- **Trigger to turn on Regrid (the parcel-fabric gap-filler):** when ≥X% of parcel lookups in a rolling 30 days return a free *miss* AND those misses cluster in counties customers actually work AND MRR ≥ ~$1k (so a ~$X00/mo Regrid plan is <Y% of revenue). Regrid is the right first paid spend because it fixes the one thing free can't: complete normalized parcel fabric.
- **Trigger for skip-trace / owner contact (BatchData/PropGrid-class):** when customers are doing outbound and the free owner-of-record (county) isn't enough to reach sellers. This is pay-per-lookup, so gate it behind the credit system that already exists — customers spend credits, we pass cost through. No fixed monthly risk.
- **Zamplo-class valuation/comps:** lowest priority — land comps are thin everywhere; our free ag-value + sales-history-from-county is comparable. Defer until a customer explicitly asks and will pay.
- **Instrument the trigger now (Phase 0):** the registry already has `providerIntelligence` telemetry recording per-provider success/miss. Add a "free-miss by county/category" rollup so the buy decision is data-driven, not vibes. We should be able to say "Regrid would have filled 38% of misses in the 12 counties our customers actually worked last month" before we spend a dollar.

---

## Quick wins (days, not weeks)

1. **Per-category cache TTL + stale-while-revalidate** (item 6) — small change, big resilience + cost win.
2. **Provenance/as-of on the parcel card** (item 3, render side) — instantly makes free feel trustworthy/premium.
3. **Expand `open-data-provider` category map** — unlocks ~25 already-built free endpoints through the registry's caching/breaker for free.
4. **Free-miss-by-county telemetry rollup** — makes the eventual Regrid decision data-driven and costs nothing now.
5. **"Request this county" CTA on parcel miss** — turns a dead-end into a coverage signal.

---

## Biggest risk if we ignore this area

**The half-wired two-spine architecture silently bills, caches, and fails differently depending on code path — and the parcel-coverage gap turns the product's core surface blank for any customer outside ~34 counties.** First customers won't file a bug; they'll quietly conclude "the data isn't there" and churn. The free stack is genuinely good; the risk is entirely in *consolidation, coverage, and honesty*, not in the data itself. If we don't fix the wiring before paying customers arrive, we'll also be tempted to "solve" a perceived data gap by buying Regrid early — spending scarce founder capital to paper over an architecture problem we can fix for $0.

---

*File: `/Users/user/AcreOS/AcreOS/docs/internal/roadmap/_lenses/open-data-architecture.md`*
