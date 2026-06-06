# Iyari — Chief of Future — Roadmap Lens

**Date:** 2026-06-06
**Author:** Iyari Nakamura (Chief of Future)
**Lens for this exercise:** the long-arc open-data moat — building a proprietary enriched parcel layer from free sources over time (the "strong oak"). What compounds, what becomes defensible, and the smallest R&D bets to plant now.

> Framing note (my standing discipline): I do not say "build X." I say "if X is true at scale, our architecture needs Y; here's the smallest experiment that tells us whether X is true." Everything below is scoped as a built-to-learn seed, not a built-to-ship mandate. Maren owns the next-quarter roadmap; Iris owns the production bar. My job is to make sure the *first customers' usage starts watering a tree* instead of evaporating.

---

## The one sentence that matters

**Right now, every parcel lookup is a cold recompute that we throw away.** We have a genuinely excellent free-data fusion engine — but it has no memory. The strategic loss isn't the missing Regrid subscription. It's that 10,000 lookups by our first customers will leave behind *nothing we own*. The oak never grows because we never plant the acorn.

Fix that, and the free tier stops being "the cheap version of paid data" and starts being **a thing paid providers cannot sell: a longitudinal, customer-validated, county-deep observation history that gets better the more it's used.** That is the moat. It is cheap to start. It must start now, while volume is small, because longitudinal data you didn't capture in 2026 cannot be bought in 2028.

---

## What already exists (so we don't reinvent it)

The foundation is more mature than the "we can't afford data" framing implies. Credit where due:

- **Provider registry** (`server/services/providers/provider-registry.ts`) — tiered fallback, circuit breaking, `provider_cache`. County GIS is correctly demoted *ahead* of Regrid at priority 5 (`county-gis-provider.ts`).
- **Free-source-first router** (`server/services/data-cache/free-source-router.ts`) — FEMA NFHL, USFWS NWI, Census, USDA NASS adapters, cross-customer `cached_lookups` so customer A's paid lookup is free for customer B.
- **The fusion engine** (`server/services/parcelIntelligenceFusion.ts`) — already fuses FEMA + NWI + EPA ECHO + OSM + USGS 3DEP + USDA soils + NLCD + Census into a Land Intelligence Score with deal-killer flags. This is the crown jewel and it is *good*.
- **Autonomous county-GIS discovery** (`server/services/arcgis-discovery.ts` + `countyEndpointDiscovery.ts`) — already scheduled in `runScheduledJobs.ts:4304`, crawls ArcGIS Online, validates, persists to `county_gis_endpoints`. The coverage map literally grows itself.

So this is **not** a greenfield ask. It's a "make the existing river deposit silt instead of running to the sea" ask.

### The gaps that block compounding

1. **`parcel_snapshots` is a cache, not a history.** It has `expiresAt` / `fetchedAt` and is upserted on `(source, sourceId)` — new data *overwrites* old. There is no append-only observation log. We are destroying the exact time-series (assessed value, owner, tax status over time) that is the entire point of owning land data.
2. **The LIS report is never persisted.** `routes-data-intelligence.ts:254` computes `generateLandIntelligenceReport()` live and returns it to the client. Every report is a cold recompute against ~8 external APIs. No memoization, no audit trail, no training corpus, no "this parcel scored 82 in March and 71 now."
3. **No coverage ledger.** We can't answer "what fraction of our customers' counties have a working free GIS endpoint" — so we can't tell a customer "your county is fully covered" vs "we're flying blind here," and we can't prioritize discovery against *real demand*.
4. **No provenance on fused fields.** The LIS blends 8 sources but doesn't stamp each field with `{source, fetchedAt, confidence}`. Without provenance we can never (a) defend a number to a customer, (b) selectively refresh stale fields, or (c) prove which fields would actually improve under paid data.

---

## Top work items (most important first)

### 1. The Parcel Observation Log — append-only, the acorn (FOUNDATION)
- **Goal served:** data / foundation
- **Effort:** M · **Phase:** 1 · **Depends on:** nothing (additive table)
- **Why it matters to first customers:** Invisibly at first — but the day a customer asks "has this parcel's assessed value changed since I made my offer?" or "did the owner change?", we either have the answer or we don't. Land investors live and die on owner-change and tax-status deltas. Owning the history means we answer questions Regrid charges per-call for, and we answer them *for free, instantly, from our own store*.
- **What it is:** A new `parcel_observations` table — append-only, never updated. Every time *any* path (lookup, ETL, fusion, customer edit) sees a fact about a parcel, write an immutable row: `{apn, state, county, field, value, source, confidence, observedAt, organizationId|null}`. `parcel_snapshots` stays as the fast "current best view" cache; observations become the system of record that the cache is *derived from*.
- **First step:** Add the table to `shared/schema.ts` next to `parcelSnapshots` (line ~6004). Write one `recordObservation()` helper in a new `server/services/data-cache/observation-log.ts`. Wire it as a fire-and-forget call inside the existing write path in `etlHandlers.ts` (regrid + county GIS upserts) and inside `parcelIntelligenceFusion.ts` where each source resolves. Do NOT block the response on it.
- **The bet being tested:** *If* longitudinal parcel facts are worth owning, the cost of capturing them is one async insert per fact today, and impossible to backfill later. The asymmetry makes this the highest-conviction seed on the list.

### 2. Persist the Land Intelligence Report + field-level provenance (DATA)
- **Goal served:** data / happier-customers
- **Effort:** M · **Phase:** 1 · **Depends on:** #1 (shares the provenance concept)
- **Why it matters to first customers:** Two things customers feel immediately. (a) Speed — a re-opened parcel report renders from our store in <100ms instead of a 5-second 8-API recompute. (b) Trust — every number carries "from USDA SSURGO, fetched Apr 2026" instead of an unattributed score. Land investors are skeptical by trade; provenance converts skepticism into confidence.
- **What it is:** A `land_intelligence_reports` table storing the computed LIS + its inputs + per-field `{source, fetchedAt, confidence}`. Serve from store with a `staleAfter` policy; recompute only stale fields, not the whole report. This also quietly becomes our **eval corpus** (item #6).
- **First step:** In `routes-data-intelligence.ts:254`, wrap `generateLandIntelligenceReport` with a store-read/store-write. Add a `provenance` field to the report type in `parcelIntelligenceFusion.ts` and stamp it as each adapter resolves.
- **The bet:** *If* customers re-view parcels (they do — they revisit deals across the pipeline), persistence pays for itself in latency + API-call reduction within weeks, and hands us a labeled corpus for free.

### 3. County Coverage Ledger — demand-weighted (DATA / FOUNDATION)
- **Goal served:** data / rock-solid
- **Effort:** S · **Phase:** 1 · **Depends on:** existing `county_gis_endpoints`, `discovered_endpoints`
- **Why it matters to first customers:** Honesty about coverage *is* a feature. "Your county (Cochise, AZ) has full free parcel coverage — 0 paid lookups needed" is a premium-feeling message. The inverse — silently returning thin data with no warning — is how trust dies on day one.
- **What it is:** A materialized view / small table joining `county_gis_endpoints` (have-it) against the counties our customers actually touch (want-it, from leads/properties/lookups). Output: a coverage % per county and a *demand-ranked discovery queue*. Feed that ranking into the already-scheduled `runCountyEndpointDiscovery` so it crawls the counties our customers are in, not alphabetically.
- **First step:** Write a read query that left-joins distinct `(state, county)` from `properties`/`leads` against `county_gis_endpoints`. Surface it on the founder data surface first; later, a "coverage" chip on the customer Map door.
- **The bet:** *If* discovery is demand-weighted, our free coverage tracks real customer need with zero new data spend — the crawler becomes a self-aiming moat-builder.

### 4. The "Free feels Premium" parcel card — confidence + freshness UX (FLAWLESS-UX)
- **Goal served:** flawless-ux / happier-customers
- **Effort:** S · **Phase:** 2 · **Depends on:** #2 (provenance)
- **Why it matters to first customers:** This is where the moat becomes *visible*. A parcel card that shows "Flood: Zone X · FEMA NFHL · fresh" / "Soil: Class II prime farmland · USDA SSURGO" with a per-field freshness dot makes free public data feel like a Bloomberg terminal for dirt. Customers don't care that it's free; they care that it's *legible and trustworthy*. This is the single cheapest way to make the free tier feel paid.
- **What it is:** A presentation layer over #2's provenance, behind the **Map** door (per the five-doors rule — Map, as a section, not a new door). Skeletons matching content shape, `EmptyState` when a county isn't covered with a CTA to "request coverage" (which feeds #3's queue).
- **First step:** Prototype the card in isolation with mock provenance data. Krieger owns the touch/pointer parity bar; I prototype the information design.
- **The bet:** *If* perceived data quality drives conversion more than raw data quality, this beats buying Regrid for first-customer retention — at ~1% of the cost.

### 5. Owner-change & tax-status delta detector (HAPPIER-CUSTOMERS)
- **Goal served:** happier-customers / data
- **Effort:** M · **Phase:** 2 · **Depends on:** #1 (needs the observation log)
- **Why it matters to first customers:** This is the killer app of owning history. A scheduled diff over `parcel_observations` that fires "Owner changed on a parcel in your pipeline" or "tax-delinquent status appeared" turns our passive data store into a *proactive lead engine*. This is precisely what land investors pay PropStream/PropGrid for — and we'd derive it from free county GIS we already crawl.
- **What it is:** A scheduled job (slots into `runScheduledJobs.ts` alongside the ETL orchestrator) that compares the latest two observations per `(apn, field)` for tracked fields and emits events. Reuse the existing workflow trigger bus (`WORKFLOW_TRIGGER_EVENTS` in schema) — add `parcel.owner_changed`, `parcel.tax_status_changed`.
- **First step:** Once #1 has a few weeks of observations, write the diff query as a read-only report first; only wire it to notifications after we've eyeballed false-positive rate.
- **The bet:** *If* free county GIS refreshes often enough to catch owner/tax changes within a useful window, we have a free substitute for the most expensive paid signal in the industry. The observation log is the only way to find out — another reason #1 is urgent.

### 6. Paid-data eval harness — "would Regrid actually help us?" (DATA / FOUNDATION)
- **Goal served:** data / foundation
- **Effort:** S · **Phase:** 2 · **Depends on:** #2 (the persisted corpus is the ground truth)
- **Why it matters to first customers:** Indirectly but decisively — it stops us from spending the founder's money on data that doesn't move outcomes. When MRR finally justifies a paid trial, we run Regrid/Zamplo against our persisted free reports and measure *which fields actually changed a deal decision*. We upgrade surgically (e.g., buy parcel boundaries but keep free flood/soil), not wholesale.
- **What it is:** A harness that takes N persisted free reports, calls a paid provider for the same parcels during a trial window, and produces a field-by-field divergence + "decision-flip" report. There's an existing eval pattern to mirror (`server/services/aiEvalHarness.ts`).
- **First step:** Define the divergence metric and the "decision-flip" definition now (no paid calls needed). Have it ready so the moment Lena greenlights a trial, we get a data-driven upgrade decision in 48h.
- **The bet:** *If* free data already covers 80% of decision-relevant fields, the phased-upgrade path is "buy the 20% that matters," saving thousands/year vs a blanket subscription.

### 7. Parcel boundary geometry from open sources (DATA) — watch, prototype small
- **Goal served:** data
- **Effort:** L · **Phase:** 3 · **Depends on:** #3 (coverage ledger tells us where the gaps are)
- **Why it matters to first customers:** Boundary polygons are the one thing free county GIS *sometimes* withholds and Regrid sells. But many county ArcGIS feature services *do* expose geometry, and our discovery crawler already validates endpoints. The L-effort bet is harvesting + normalizing polygons opportunistically into `parcel_snapshots.boundary` (field already exists) for counties that expose them.
- **First step:** This is a *watch + spike*, not a build. Spike: for our top-10 demand counties (from #3), check how many discovered endpoints already return geometry. If >50%, promote to Maren's roadmap. If <20%, this is where a *targeted* paid boundary purchase makes sense later — and #6 proves it.
- **The bet:** *If* enough counties expose geometry freely, we get the marquee paid feature for free in our actual coverage area. The spike costs two days and tells us whether to build or buy.

---

## The open-data theme, through my lens

The cross-cutting "best-in-class data on free sources" goal is, from the Chief-of-Future seat, **the most defensible thing AcreOS can build, and it is being half-built.** We are excellent at *consuming* free data and terrible at *retaining* it.

The strategic reframe I want Tom to internalize:

- **Paid providers sell access. We should sell memory.** Regrid/Zamplo/PropGrid have more breadth than us today and always will at the raw-coverage level. We will never win "who has more parcels." We *can* win "who has the deepest, most current, customer-validated history *in the counties our customers actually work*." That is a narrow, deep, compounding moat — the strong oak, not the wide-but-shallow lawn.
- **The crawler is already an autonomous moat-builder** (`countyEndpointDiscovery`). Demand-weight it (#3) and it aims itself. This is the highest-leverage thing we own and almost no competitor has it pointed at *the customer's* counties specifically.
- **Customer usage must deposit silt.** Items #1 and #2 are the entire thesis: the act of a customer using the free tier should *permanently improve the asset*. Every lookup an observation; every report a corpus row; every county touched a discovery target. Today, usage evaporates. That is the one thing I would change before the first customer signs.
- **Phased upgrade discipline:** Phase 0–1 = free-only + start retaining (#1, #2, #3). Phase 2 = make it feel premium + proactive (#4, #5) + build the eval harness (#6). Phase 3 = *surgical* paid upgrades proven by #6 (boundaries via #7, maybe AVM). Never a blanket subscription. The eval harness ensures every paid dollar is earned.

The deepest point: **longitudinal data is the only data you cannot buy retroactively.** Whatever we fail to capture in 2026, no provider can sell us in 2028. That makes the observation log (#1) the single most time-sensitive item in this whole document, despite being invisible to customers on day one.

---

## Quick wins (S effort, high signal-to-noise)

- **County Coverage Ledger read query (#3)** — one left-join, surfaced on the founder data surface. Instantly answers "are our customers in covered counties?" and demand-aims the existing crawler. ~Half a day.
- **Provenance stamping in the fusion engine (part of #2)** — add `{source, fetchedAt}` as each adapter resolves in `parcelIntelligenceFusion.ts`. Pure-additive, unlocks the premium parcel card and the eval harness later.
- **Define the eval-harness metrics now (#6, design only)** — zero code, zero paid calls. Write down "decision-flip" and the field divergence metric so we're ready the day Lena greenlights a trial.
- **Add `parcel.owner_changed` / `parcel.tax_status_changed` to `WORKFLOW_TRIGGER_EVENTS`** — schema-only, reserves the event names so #5 can light up later without a migration scramble.

---

## Biggest risk if my area is ignored

**We onboard our first customers, they generate thousands of valuable parcel observations, and we keep none of them.** Eighteen months later we want to raise prices or pitch a "data" tier and discover we have no proprietary asset — just a thin wrapper over the same free APIs anyone can call, with zero history, zero corpus, and zero defensibility. At that point the obvious move looks like "subscribe to Regrid," which is exactly the monthly cost the whole strategy was meant to avoid — and even then we'd be buying *breadth* when the durable moat was always *depth + memory* we could have captured for the price of one async insert per lookup.

The fix is cheap and the window is now. An append-only observation log (#1) and a persisted report store (#2) are S–M efforts that turn customer usage into a compounding owned asset. Skip them, and we spend the next two years renting what we could have grown. The oak is cheap to plant and impossible to plant late.
