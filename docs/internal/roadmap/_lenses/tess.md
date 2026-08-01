# Tess — SRE lens on the first-customer roadmap

**Author:** Tess Whitaker (Site Reliability Engineer)
**Date:** 2026-06-06
**Phase context:** Phase 0 active, pre-first-customer, near-zero overhead, founder self-funding.

> My role formally activates at Phase 3 ($5k MRR). But reliability debt compounds, and the cheapest time to build the detective controls + degradation paths is *before* a customer is depending on them. This lens is written as "what would I, the future on-call, be furious that nobody did?" — scoped to what costs ~$0 now and pays off the moment customer #1 logs in. I am not asking to spin up PagerDuty at Phase 0. I am asking that we not ship a data product whose data-fetch paths have zero synthetic monitoring.

---

## The single most important finding

The platform's core value prop is **land/parcel data**. That data flows through `server/services/providers/` (registry → `open-data-provider`, `county-gis-provider`, etc.) with circuit breakers, `provider_cache`, and `providerIntelligence` telemetry. That part is genuinely well-built.

**But the periodic health loop does not watch any of it.** `server/services/healthCheck.ts::checkAll()` checks Database, Redis, Stripe, OpenAI, Twilio, Email, Lob — and stops. The free data sources that *are the product* (FEMA NFHL, Census TIGER, USGS, USDA SSURGO, county GIS/assessor) are invisible to monitoring. There is a perfectly good `providerRegistry.healthCheckAll()` (provider-registry.ts:285) and a real `openDataProvider.healthCheck()` that pings FEMA NFHL — **and nothing calls them on a schedule.** Grep confirms zero cron wiring.

Translation: if FEMA's GIS endpoint goes down or a county portal rate-limits us at 9am, the first signal we get is a customer staring at an empty map. That is the exact "Twitter found out first" failure mode my charter bans. Fixing it is a few hours of work against substrate that already exists.

---

## Top work items (priority order)

### 1. Wire free-data-provider health into the periodic loop + a status snapshot
- **Why it matters to first customers:** the map/parcel/flood/soils data is the reason they pay. We must detect a degraded source before they hit it, and we must be able to answer "is it us or is it the county?" in seconds, not by spelunking logs.
- **Goal:** rock-solid (+ data).
- **Effort:** S.
- **Phase:** 0.
- **Dependencies:** none — all the pieces exist.
- **First step:** In `server/services/healthCheck.ts`, add a `checkDataProviders()` that calls `providerRegistry.healthCheckAll()` and folds each provider's `ProviderHealthStatus` into the `ServiceHealth[]` array, with the *free* providers marked critical-for-product (degraded, not unavailable, so the app doesn't 503 on a county outage). Make sure `providers-init.ts` registration runs before the first `checkAll()`. Expose the result through the existing `/api/health` payload. Total: one new method + one line in `checkAll()`.

### 2. Per-source synthetic probes with golden test coordinates
- **Why it matters to first customers:** a 200 OK from FEMA's root MapServer (what `openDataProvider.healthCheck()` does today) does not prove a *flood-zone lookup at a real lat/lng* still works — schemas drift, layers get renumbered, query params change. We want to catch "the endpoint answers but the answer is now garbage."
- **Goal:** rock-solid (+ data).
- **Effort:** M.
- **Phase:** 0→1.
- **Dependencies:** item 1.
- **First step:** Define 3–5 "golden parcels" (a known APN in 2–3 counties we'll demo in) and a tiny probe in a new `server/jobs/dataSourceProbe.ts` registered in `runScheduledJobs.ts` (use the existing `withJobLock` + `job_runs` pattern, e.g. every 30 min). For each source assert the lookup returns the *expected shape and a plausible value* (flood zone in {A,AE,X,...}, a soil series string, an elevation in range). Write pass/fail to `providerLookupLog` (already exists) so it shows up in `providerIntelligence` and `/founder/providers`. This is our canary; it turns "the county changed their API" from a customer ticket into a founder alert.

### 3. Graceful degradation + honest data-freshness signaling on the customer map
- **Why it matters to first customers:** when a free source is down or rate-limited, the *right* product behavior is "show cached data, labeled as-of timestamp, with a quiet 'source temporarily unavailable' note" — not a spinner-of-death or a blank layer. Trust is built by being honest about staleness, not by hiding it. `maps.tsx` already references freshness fields; let's make them load-bearing.
- **Goal:** rock-solid + flawless-ux + data.
- **Effort:** M.
- **Phase:** 1.
- **Dependencies:** items 1–2 (so the UI has a real signal to render).
- **First step:** Plumb the registry's `cached` + `fetchedAt` (already on `LookupResult`) through to the API responses the map consumes, and render an "as of <date>, refreshing…" badge per data layer using the existing `EmptyState`/`QueryErrorState` patterns from CLAUDE.md. When the circuit breaker is open for a source, the layer renders last-good-cached + a non-alarming degraded indicator. Never a hard error on a *secondary* data layer.

### 4. Free-source rate-limit budgeting + backoff (don't get ourselves banned)
- **Why it matters to first customers:** free county/federal GIS endpoints have unpublished rate limits and *will* IP-ban or 429 an over-eager client. With Fly egress NAT, one aggressive backfill can poison the source for *every* customer. The circuit breaker (3 failures / 5 min) reacts to failure; it does not *prevent* us from hammering a source. We need a token-bucket per host plus jittered backoff, especially on the ETL/ingest jobs (`countyAssessorIngest.ts`, `etlHandlers.ts` — `dataIngestJob.ts` was deleted 2026-08-01 as an unscheduled module orphan).
- **Goal:** rock-solid + data.
- **Effort:** M.
- **Phase:** 1.
- **Dependencies:** none, but coordinate with whoever owns the ETL cadence.
- **First step:** A small per-host limiter (in-memory token bucket keyed by source hostname) wrapped around the fetch in `open-data-provider`/`county-gis-provider` and the ETL handlers. Respect `Retry-After` on 429. Add `User-Agent: AcreOS/<sha> (contact)` so source admins can reach us instead of silently banning us — this is table stakes etiquette with public-data providers and directly protects uptime.

### 5. Prove the backup is restorable (a DR drill, not a backup)
- **Why it matters to first customers:** `server/jobs/dbBackup.ts` does a `pg_dump`→S3. A backup nobody has *restored* is a hope, not a recovery plan. Customer #1's deals, ledger (`financial_ledger`), and signed docs live in Postgres. Losing them is existential; a 6-hour fumbling restore at 2am is nearly as bad.
- **Goal:** rock-solid + happier-customers (trust).
- **Effort:** S (the drill) / M (documenting + automating verification).
- **Phase:** 0.
- **Dependencies:** the backup job must be confirmed running with real S3/B2 creds (it logs-to-console in dev).
- **First step:** Once, manually: pull the latest dump, `pg_restore` into a throwaway local/staging DB, run `npm run check` + a smoke query against key tables. Time it. Write the result + exact commands to `docs/reliability/dr-runbook-postgres-restore.md` with a measured RTO. Add a monthly cron that does a *restore-into-temp-and-row-count-assert* against the latest backup so a silently-corrupt backup surfaces before we need it. Confirm the S3 lifecycle/retention is actually configured (the code comment says "configure in console").

### 6. The pre-revenue on-call story (free, lightweight)
- **Why it matters to first customers:** at Phase 0 the "on-call" is the founder. That's fine — *if* the right signals reach him. Right now alerts go to `system_alerts` + logs; nobody is watching at 11pm. We need detection-before-customer-report on a $0 budget.
- **Goal:** rock-solid.
- **Effort:** S.
- **Phase:** 0.
- **Dependencies:** items 1–2 provide the signals to alert on.
- **First step:** Point an external uptime pinger (UptimeRobot / Better Stack free tier, 5-min interval) at `/api/health/cached` and `/api/healthz`, alerting to the founder's phone. Add one self-hosted synthetic from the worker process: a job that hits the public app URL + a golden data lookup and pages (push notification) on failure — closes the gap where the app health-checks *itself* (always green from inside) but is unreachable from the outside. One alerting channel, one escalation target (Tom), documented in a half-page runbook. No PagerDuty spend until Phase 3.

### 7. Capacity sanity: cold-start + worker headroom for the demo window
- **Why it matters to first customers:** `fly.toml` runs the app group at `min_machines_running = 0` with `auto_stop_machines = 'suspend'`. Great for cost; bad for a first customer or live demo who hits a cold suspend-resume and waits. The worker (where the scheduled data jobs + probes run) is `min_machines_running = 1` / 2gb — good. The risk is the *first impression* latency and a single worker being a single point of failure for all ingest.
- **Goal:** rock-solid + flawless-ux.
- **Effort:** S.
- **Phase:** 0→1.
- **Dependencies:** Lena's cost envelope (this is a real, if small, run-rate decision).
- **First step:** Measure cold-resume latency on the app group. If it's >1–2s to first byte, set `min_machines_running = 1` for the *demo/launch window* only (revert after), or rely on the external pinger from item 6 to keep one machine warm during business hours. Document the worker as a known SPOF in the capacity note — at Phase 0 that's an accepted risk, but it must be *named*, not discovered.

---

## The open-data theme through my lens

The strategy of leaning on free county/federal GIS until MRR justifies Regrid/Zamplo/PropGrid is the right call. From a reliability seat, free data has a specific risk profile that's *different* from paid:

- **No SLA, no support, no notice.** A paid provider has an account rep and a status page. FEMA/county portals can change a layer ID, throttle, or go down for maintenance with zero warning. So the **monitoring burden is higher for free data, not lower.** That's exactly why items 1, 2, and 4 are the backbone of this lens.
- **Rate-limit fragility is shared.** Because Fly egress is NAT'd, our worst-behaved job sets the reliability floor for every customer against a given source. Per-host budgeting (item 4) is non-negotiable before we have more than a handful of orgs.
- **Cache is our SLA.** The `provider_cache` table is the single biggest reliability asset for the free tier — a cached answer is a guaranteed-fast, source-outage-immune answer. My recommendation: **make the free tier feel premium by leaning *into* the cache.** Pre-warm cache for demo/target counties via a low-rate background ETL (already partly in `etlHandlers`/`countyAssessorIngest`), serve cached-first with honest as-of labels (item 3), and refresh in the background. A customer who never sees a slow or empty map doesn't know or care that the data came from a free source.
- **My low-cost recommendation:** treat the free-data tier as a *latency + freshness SLO*, not an availability gamble. Concretely: SLO = "95% of map data layers render in <1.5s from cache; no layer is ever blank — degraded sources fall back to last-good-cached with an as-of badge." That's achievable today for ~$0 with the existing cache + the probes/degradation in items 1–4. The phased upgrade to paid data then becomes a *quality/coverage* upgrade (better APN match rate, owner data), not a *reliability* rescue — which keeps the Regrid spend a Phase-2+ MRR-justified decision, not a fire we're forced to buy our way out of.

---

## Quick wins (each ≤ a few hours, do this week)

- **Wire `providerRegistry.healthCheckAll()` into `checkAll()`** so free data sources show up in `/api/health`. (item 1 — the highest-leverage hour in this whole doc.)
- **External uptime pinger** on `/api/health/cached` → founder's phone. (item 6.)
- **Add a contactable `User-Agent`** to all outbound free-data fetches so source admins reach out instead of silently banning. (subset of item 4.)
- **Do the restore once, by hand, and write down the RTO.** Even un-automated, knowing the backup restores and how long it takes removes the scariest unknown. (subset of item 5.)
- **Confirm `dbBackup` is actually uploading to S3/B2 in prod** (not the dev console-log path) and that retention is configured. (precondition for item 5.)
- **Name the single-worker SPOF** in a one-paragraph capacity note. Cheap to write, expensive to forget.

---

## Biggest risk if my area is ignored

**A core data source degrades or starts rate-limiting us, nobody notices, and the first customer's map is silently broken or stale — and we find out from them.** For a pre-revenue data product, that's not a blip; it's the credibility hit that loses customer #1, who we will never get a second first impression with. The cruel irony is that the substrate to prevent this (circuit breakers, `provider_cache`, `healthCheckAll()`, `providerIntelligence`, `job_runs`, dead-letter queue) is *already built and largely unused for the free-data paths*. The risk isn't that reliability is hard or expensive here — it's that we'd ship with the alarms installed and the batteries left out.

Secondary risk: an un-rehearsed backup that turns out not to restore, the day we actually need it. That one is existential, not just embarrassing.
