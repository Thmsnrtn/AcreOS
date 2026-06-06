# Iris — CTO lens: first-customer readiness, the data backbone, reliability

_Author: Iris Yamamoto (CTO). Date: 2026-06-06. Phase 0 active, pre-first-customer, zero-capital._

## The honest state of the system (verified, not assumed)

We are in better shape than a pre-launch company has any right to be on the data layer — and that's exactly the problem. We built **two** orchestrators and a discovery service, then under-fed all three. From a focused read of the repo:

- **Provider registry** (`server/services/providers/provider-registry.ts`) is genuinely good: tier ordering (free → starter → pro → enterprise), cost-aware sort, performance-score reordering within a tier/cost bracket, circuit breaking (3 failures / 5 min), and `provider_cache`-backed caching with a 24h TTL. Wired at boot via `server/index.ts:73 → initializeProviders()` (`server/providers-init.ts`). Five providers registered: `county-gis` (free, prio 5), `open-data` (free, prio 10), `regrid` (starter, 30), `batchdata` (starter, 40), `attom` (pro, 50). The Regrid demotion is real and mechanical — county GIS runs first because it's free-tier, not because of a flag. This is the right architecture for the phased free→paid path Tom wants.
- **But the registry has only 2 callers** (`grep -rln providerRegistry server` → 2 files) while **`data-source-broker.ts` (1,906 lines) has 12 callers**. The broker is where SSURGO soils, FEMA flood, USFWS wetlands, USGS/3DEP elevation, Census TIGER actually live. So the "backbone" Tom thinks routes everything actually routes a thin slice; the real free-data muscle is in a parallel, separately-cached system. Two cache layers, two health models, two circuit-breaker stories. **This duplication is the single biggest architectural risk to a clean free-data story.**
- **County GIS coverage is ~20 counties**, hand-seeded in `seedCountyGisEndpoints()` (`server/services/parcel.ts:869`) — heavy on TX/NM/AZ/FL/CA/GA/NC/TN border-and-Sunbelt land counties. Good instinct (that's where land deals are), but a customer who buys a tax-delinquent parcel in, say, rural Missouri or Arkansas falls straight through to paid Regrid — which we can't afford to subsidize. We already have `arcgis-discovery.ts` that can *find* public parcel services on ArcGIS Online by keyword + state. We built the engine to auto-grow coverage and never turned the crank.
- **Fetch discipline is inconsistent.** `AbortSignal.timeout` is used in ~10 services including `parcel.ts`, but `parcel.ts:712`, `:812`, and `:1676` call bare `fetch(url)` with no timeout. On Fly with `auto_stop_machines='suspend'` and `min_machines_running=0`, a single hung upstream (county servers are flaky) on a cold machine can pin a request and burn the 5s health-check grace. There is no shared, rate-limit-friendly, retrying fetch helper for the free geospatial endpoints — each service rolls its own.
- **Deploy posture is correctly frugal** (`fly.toml`): app suspends after idle, worker stays warm at 1 machine, release_command runs `scripts/migrate.mjs` (6,265 lines, the Drizzle-bypass idempotent patcher). Health check hits `/api/health/cached` (good — no upstream fan-out on the probe path; live fan-out is opt-in at `/api/health/live`, `server/routes.ts:578`). This is sound. The cold-start tradeoff is the right call at $0 capital, but it means **the first request a new customer ever makes may be a 1–2s cold wake** — a bad first impression we can soften.

## Top work items (priority order)

### 1. Unify the data path: registry is the one front door, broker becomes a provider
- **Why it matters to first customers:** today a parcel lookup and a flood/soil lookup take different code paths with different caches and different failure behavior. A customer pulling up a parcel sees crisp parcel data but inconsistent environmental data, because the environmental path doesn't get the registry's circuit breaker or perf-scored fallback. One front door = one predictable latency/cache/failure story across every data field on the Map and Deal screens.
- **Goal:** rock-solid + data.
- **Effort:** L. **Phase:** 1 (design in 0).
- **Dependencies:** none blocking; touches `open-data-provider.ts`, `data-source-broker.ts`, registry.
- **First step:** Don't rewrite the broker. Wrap it. `open-data-provider.ts` already delegates `environmental`/`demographics`/`parcel_data` to `dataSourceBroker.lookup(...)`. Extend that adapter to cover **all** broker categories (soils/SSURGO, wetlands, elevation, TIGER) and migrate the 12 broker callers to go through `providerRegistry.lookup()` one at a time. End state: broker is an internal implementation detail behind exactly one provider; `provider_cache` is the only cache; circuit breaking is uniform. Track a `grep -rln dataSourceBroker server` count down from 12 to 1.

### 2. Auto-grow county GIS coverage — turn the discovery crank
- **Why it matters to first customers:** the free tier only feels premium if the parcel actually resolves. 20 counties is a demo, not a product. The difference between "AcreOS knew my parcel" and "AcreOS shrugged" is whether `lookupFromCountyGIS` finds an endpoint for that county.
- **Goal:** data + happier-customers.
- **Effort:** M. **Phase:** 1.
- **Dependencies:** `arcgis-discovery.ts` (exists), `county_gis_endpoints` table (`shared/schema.ts:5947`), the field-mapping shape in `queryArcGISEndpoint` (`parcel.ts:259`).
- **First step:** Build a worker job (slots into the existing scheduled-jobs catalogue on the worker VM) that, on a county miss, enqueues that (state, county) for discovery: run `arcgis-discovery` search, probe the candidate's `/query` endpoint for an APN-shaped field, auto-populate `apnField`/`ownerField`/`fieldMappings`, write the row as `isActive=false` pending a confidence check, and flip active once it returns a real feature for a known APN. Demand-driven coverage growth costs $0 and compounds — every customer miss makes the next customer's lookup hit.

### 3. One hardened fetch helper for all free geospatial upstreams
- **Why it matters:** county/state GIS servers and federal endpoints are individually unreliable. Without a shared timeout + bounded-retry + per-host concurrency limiter, one bad upstream degrades the whole request, and on a cold Fly machine that can cascade into a failed health check. A shared helper also gives us one place to add polite rate limiting so we don't get a free source to IP-block us (and we never key OUR rate limiting purely by IP per the carrier-NAT rule).
- **Goal:** rock-solid.
- **Effort:** S. **Phase:** 0.
- **Dependencies:** none.
- **First step:** `server/services/providers/fetchGeo.ts` — `fetchGeo(url, { timeoutMs=8000, retries=2, host })` with `AbortSignal.timeout`, exponential backoff with jitter, a per-host in-flight semaphore, and a single `If-Modified-Since`/ETag-aware cache touch point. Replace the bare `fetch(` calls at `parcel.ts:712/812/1676` first, then sweep the broker. This is the lowest-effort, highest-reliability-yield item on the list.

### 4. Persistent provider health + cache-warming on the warm worker
- **Why it matters:** circuit-breaker state and perf scores live in-memory in the registry instance. On the suspend/wake app machine they reset on every cold start — so the first customer after idle re-discovers every dead upstream the hard way. The worker VM is always warm (`min_machines_running=1`); it should own continuous health probing and pre-warm `provider_cache` for the parcels a customer is actively looking at.
- **Goal:** rock-solid + flawless-ux.
- **Effort:** M. **Phase:** 1.
- **Dependencies:** `dataQualityMonitor.ts` (already enumerates 18 sources with probe URLs), `runScheduledJobs.ts`, the worker process group in `fly.toml`.
- **First step:** Persist circuit state to a small `provider_health` table written by a worker probe loop (reuse `dataQualityMonitor.DATA_SOURCES`); have the registry read last-known-bad on boot so a cold app machine inherits the warm worker's knowledge instead of re-failing.

### 5. Cache TTLs that respect data velocity (and don't silently go stale)
- **Why it matters:** the registry caches everything for a flat 24h (`DEFAULT_CACHE_TTL_MS`). Parcel boundaries and FEMA flood zones change on the order of years; ownership changes on sales; valuations move monthly. A flat TTL either over-caches owner data (customer sees a stale owner and distrusts us) or under-caches boundaries (we re-hit flaky county servers for data that hasn't moved). For seller-finance land investors, *trusting the owner field* is load-bearing.
- **Goal:** data + happier-customers.
- **Effort:** S. **Phase:** 1.
- **Dependencies:** registry cache layer.
- **First step:** Per-category TTL map in `provider-registry.ts`: boundaries/flood/soils/elevation → 30–90d; owner_info/valuation → 24–72h; stamp `fetchedAt` into the UI so customers see "as of" provenance. Add a freshness badge to the Map/Deal data panels (UX win for free).

### 6. Data provenance + confidence surfaced to the customer
- **Why it matters:** the free tier feels premium when the customer understands *where* a number came from and *how sure* we are. Every `LookupResult` already carries `provider`, `confidence`, `cached`, `fetchedAt` (`types.ts:19`). We throw that metadata away at the UI boundary. Showing "County Assessor • 80% • as of May 2026" next to a value is the single cheapest credibility upgrade we can ship, and it sets honest expectations vs. a paid Regrid field later.
- **Goal:** flawless-ux + data.
- **Effort:** S. **Phase:** 1.
- **Dependencies:** item 1 (uniform metadata) makes this clean; can ship partially before.
- **First step:** Thread `confidence`/`provider`/`fetchedAt` through the parcel/enrichment API responses into a small `<DataProvenance>` chip behind the Map and Deals doors.

### 7. Restore-from-backup + migrate dry-run drill before first customer
- **Why it matters:** the moment we have one paying customer's deals and borrower records, "we'll figure out backups later" becomes a constitution-level liability (can't delete customer data without Tom's biometric + 30-day cooling — that cuts both ways: we must be able to *recover* it). `migrate.mjs` is 6,265 lines of hand-mirrored ALTERs run as Fly `release_command`; one bad patch on a real customer DB with no rehearsed restore is the nightmare scenario.
- **Goal:** rock-solid + foundation.
- **Effort:** M. **Phase:** 0 (do it before customer #1).
- **Dependencies:** Fly Postgres backups, `scripts/migrate.mjs`, the existing `migrate-mirror-check.yml` CI guard.
- **First step:** Rehearse a full Postgres restore into a throwaway Fly app from the latest snapshot; document the runbook; add a `--dry-run`/`--check` mode to `migrate.mjs` that the deploy pipeline runs against a snapshot before touching prod. This is unglamorous and non-negotiable.

## The open-data theme, from the architecture lens

Tom's instinct is correct and the codebase already half-agrees with him: we have FEMA, SSURGO, NWI wetlands, USGS/3DEP elevation, Census TIGER, county ArcGIS, and ArcGIS-Online discovery. The job is **not** to add sources — it's to make the ones we have feel like a single premium product instead of a museum of half-wired integrations.

My architectural stance on free→paid:

1. **The registry's tier ladder is exactly the right abstraction for the upgrade path.** When MRR justifies Regrid/Zamplo/PropGrid, we don't rewrite anything — we set `tierRequired` and a real `costPerLookupCents`, and the cost-aware sort keeps free providers first for free orgs while paid orgs transparently get the better source as fallback. Protect this. Do not let anyone build a feature that calls Regrid directly outside the registry; that's the seam that lets us flip data vendors with a one-line priority change.
2. **Caching is the entire economic story.** Free sources are rate-limited and flaky; the only way they "feel premium" is aggressive, velocity-aware, persistently-warmed caching (items 3–5). A well-cached county-GIS answer is indistinguishable from a paid one at the UI — same shape, same provenance chip, same sub-second response on the second view. That's where the premium feel is won.
3. **Demand-driven coverage growth (item 2) is the killer free-data move.** Paid vendors charge for national coverage you mostly don't use. We can grow coverage exactly along the contour of where our customers actually hunt land, at $0, by turning the discovery crank on every miss. By the time we can afford Regrid, we'll know precisely which counties we still can't cover for free — and only pay for those.
4. **Normalize once, at ingest.** County ArcGIS schemas are wildly inconsistent (`fieldMappings` proves it). The `parcel_snapshots`/`ParcelLookupResult` normalized shape is the contract; every source must conform to it before it reaches a customer surface, so swapping a free source for a paid one later never leaks vendor-specific field names into the UI.

Low-cost recommendation: ship items 1 + 3 first (unify the path, harden the fetch). They're the foundation that makes every other free-data improvement cheap and safe, and item 3 is an S that buys the most reliability per hour.

## Quick wins (days, not weeks)

- Replace the 3 bare `fetch(` calls (`parcel.ts:712/812/1676`) with the new `fetchGeo` helper. Immediate cold-start-safety win.
- Per-category cache TTLs in the registry (small map, big trust payoff).
- Surface `confidence`/`provider`/`fetchedAt` as a provenance chip on the Map/Deal data panels — metadata already exists, we just drop it.
- Add a `/api/health/providers` summary (the registry already has `healthCheckAll()` and `getAvailableProviders()`) so we can see free-source health at a glance before a customer hits a dead one.
- Run the Fly Postgres restore drill once and write the runbook. One afternoon; converts an unbounded risk into a known procedure.

## Biggest risk if my area is ignored

**The two-orchestrator split metastasizes.** Right now it's an annoyance (registry: 2 callers, broker: 12). If we ship the first customer on top of it and keep adding features, every new data-backed surface picks one path arbitrarily, and we end up with two caches that disagree, two failure models, and a free→paid upgrade that has to be done twice. The whole point of the provider registry — flip data vendors with a priority change when MRR allows — quietly dies, and we get locked into whatever ad-hoc path each feature happened to choose. Unifying now (item 1) is an L; unifying after 30 features is a rewrite. We fix the seam before the first customer cements it.
