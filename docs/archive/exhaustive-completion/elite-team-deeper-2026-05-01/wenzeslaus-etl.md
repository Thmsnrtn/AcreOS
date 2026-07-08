# AcreOS ETL/ELT Audit — Wenzeslaus Kowalski

**Reviewer:** Wenzeslaus Kowalski, 47, ex-Fivetran + ex-Airbyte ETL engineer
**Date:** 2026-05-01
**Scope:** Wave 3 — data ingestion, idempotency, schema evolution, late-arriving data, deletes propagation, freshness SLAs, pipeline orchestration
**Verdict:** *Functional ad-hoc ELT. Production-fragile. No orchestrator, no watermarks, no DLQ, partial idempotency, zero freshness SLAs surfaced, deletes are silently ignored.*

---

## 1. The 30-second mental model

```
External APIs ──► provider-registry (cache 24h) ──► consumer routes (synchronous)
                                  │
                                  └► provider_cache (Postgres KV)

County data ──► countyAssessorIngest (BullMQ cron 23:00 UTC) ──► transaction_training
                                                              ──► county_markets
                                                              ──► leads (high-motivation)

Internal deals ──► dataIngestJob (BullMQ cron ~22:00 UTC) ──► transaction_training (sha256 dedup)

Retention ──► dataRetention (cron 03:00 UTC) ──► hard DELETE on 7 ops tables
```

There is no analytics warehouse. There is no Airflow / Prefect / Dagster. Postgres is both OLTP and the analytics store. BullMQ + a couple of `setInterval` loops + cron strings inside `Queue.add({ repeat })` is the entire orchestration layer.

That's defensible at this stage — but the team is calling things "pipelines" that an ETL engineer would call "scheduled scripts," and the gap shows up in the failure modes.

---

## 2. What is wired vs ad-hoc

### Wired (real plumbing)

- **`server/services/providers/provider-registry.ts`** — proper registry pattern: tier filtering, cost-aware ordering, performance-score routing (10-min TTL in-memory cache), circuit breaker (3 fails / 5 min window, auto half-open), `provider_cache` table with deterministic cache key + 24h TTL + `onConflictDoUpdate`. Telemetry to `providerIntelligence.recordLookup` is fire-and-forget. **This is the strongest piece of pipeline code in the repo.**
- **`server/jobs/dataIngestJob.ts`** — sha256 transaction hash for dedup, validation gate (`MIN_PRICE`, `MAX_ACRES`, price/acre sanity), three-tier quality grade, 7-day rolling lookback, BullMQ repeatable cron.
- **`server/jobs/countyAssessorIngest.ts`** — BullMQ cron at 11 PM UTC, hard-coded county priority list (~50 counties/run), 2s rate-limit pause, ATTOM → PropStream fallback chain, `ON CONFLICT DO NOTHING` on `transaction_training`.
- **`server/services/jobQueue.ts`** — BullMQ if `REDIS_URL` set, in-memory fallback otherwise (with a loud warning). DB sync to `background_jobs` for observability.
- **`server/services/delinquentListScraper.ts`** — Socrata-based scrape registry with field-mapping per county.

### Ad-hoc (works today, breaks tomorrow)

- **County API contracts** — `parseCountyApiResponse` accepts `parcel_id || apn`, `taxes_due || delinquent_amount`, `years_delinquent` cast to int with no validation. One county changing a field name silently produces zeros.
- **`fetchTaxDelinquentList`** — falls through to `return []` for any county without a custom env var. The "queue a browser scrape task" comment is aspirational; nothing is queued.
- **Comparable-sales upsert** — uses `db.execute(sql\`...\`)` raw SQL with `ON CONFLICT (transaction_hash) DO NOTHING` instead of the Drizzle-typed insert path. No backfill mechanism for late-arriving sales.
- **Retention job** — string-interpolated `DELETE FROM ${rule.table}` with `cutoff.toISOString()`. Works because `rule.table` is hard-coded, but the pattern is one PR away from a SQL injection issue.
- **Cron strings live next to the job code**, not in a manifest. There is no single source of truth for "what runs when."

---

## 3. Idempotency on ingestion

| Pipeline | Idempotency primitive | Verdict |
|---|---|---|
| `dataIngestJob` | `buildTransactionHash(apn, county, state, price, closedDate)` + `ON CONFLICT DO NOTHING` | **Solid.** Re-running the job is safe. |
| `countyAssessorIngest` comps | sha256 over `(apn, county, state, salePrice, saleDate)` | **Solid.** Same pattern. |
| `provider_cache` | deterministic cache key per `(provider, category, input)` + `onConflictDoUpdate` | **Solid.** Cache-key normalization lower-cases and trims. |
| `countyMarkets` upsert | `(state, county)` composite target | **Solid for the latest-snapshot model — but destroys history.** No `as_of_date` column means you cannot reconstruct what the market looked like 30 days ago. For an ML feature store this is a real problem. |
| `delinquent → leads` flagging | `logger.info("HIGH MOTIVATION: ...")` only — **the lead is never actually written.** | **Broken.** The job logs intent and returns counts; no lead row is created, no skip-trace queued. The comment promises "Trigger skip-tracing queue for top-scoring records" but the code path doesn't exist. |

**Recommendation:** add a `transaction_hash` UNIQUE constraint at the schema level (currently relied on by a raw SQL `ON CONFLICT (transaction_hash)` — verify the index actually exists), and replace the county-markets snapshot with an SCD-Type-2 table (`county_market_snapshots` with `valid_from`/`valid_to`).

---

## 4. Schema evolution

- Migrations are Drizzle-Kit (`drizzle-kit push|generate|migrate`). No Atlas, no Bytebase, no shadow-DB CI check.
- `shared/schema.ts` is **9000+ lines, single file**. That is a maintainability hazard — two engineers cannot edit it concurrently without merge conflicts.
- No backward-compatibility test suite. A `DROP COLUMN` would crash any ingestion job mid-flight; the BullMQ worker would mark jobs failed and BullMQ's default retry would hammer the broken column.
- ATTOM/PropStream response shapes are typed as `any` and field-extracted with `parseFloat(p?.lot?.lotsize2 || "0")`. When ATTOM ships a v2 schema, AcreOS won't notice — it will silently ingest zeros.

**Recommendation:** zod-validate every external payload at the ingestion boundary. Today only `insertTransactionTrainingSchema` exists for **internal** writes; the **external** boundary is untyped.

---

## 5. Late-arriving data

This is the audit's biggest gap.

- **No watermarks.** `dataIngestJob` uses a fixed 7-day lookback (`LOOKBACK_DAYS = 7`). A deal that closes today but is *recorded* in the deals table 10 days from now will be missed forever.
- **No `as_of` columns** on `county_markets`, `transaction_training`, or the provider cache. A sale that backfills with a `saleDate` of 6 months ago is treated identically to one that closed yesterday.
- **No reconciliation pass.** ETL 101: nightly delta + weekly full-refresh against a known-good source. AcreOS has the delta only.
- **ATTOM date handling**: `new Date(comp.saleDate)` with no timezone normalization. ATTOM returns localized dates; sales near a month boundary will misbucket.

**Recommendation:** add a `last_seen_at` and `source_recorded_at` column to every ingested table; switch to a watermark stored in `background_jobs.metadata` (`last_high_water = max(source_recorded_at)`); add a weekly Sunday job that re-fetches the last 90 days against a wider window.

---

## 6. Deletes propagation

**Deletes from upstream sources are not propagated at all.** I checked.

- If ATTOM corrects a sale price (rare but it happens), the cache holds the old value for up to 24h, and `transaction_training` keeps the old hashed row forever — the new price produces a *different* hash and inserts a second row.
- If a county removes a parcel from the delinquent list (owner paid), the next run simply doesn't re-flag it. There is no `is_active` toggle, no tombstone, no `closed_at`. Skip-trace will keep targeting paid-up owners.
- The only real DELETE in the system is `dataRetention.ts`, which is age-based purge, not source-driven propagation.
- `provider_cache` expiry is the only "delete-equivalent" — and 24h is the floor; the data-staleness ceiling is whatever next ingest happens to find.

**Recommendation:** implement soft-delete + tombstone semantics on every `transaction_training` and `delinquent_records` row. On every ingest, mark `seen_in_run = batch_id`; rows not seen for N consecutive runs get `is_active = false` (do not hard-delete — ML training needs the historical signal).

---

## 7. Observability — data freshness SLAs

There are none.

- `background_jobs` records start/finish/result, but there is no "last successful ingest per source" view, no Grafana dashboard reference, no alert rule for "ATTOM hasn't returned data in 48h."
- `providerIntelligence.recordLookup` is fire-and-forget — telemetry that fails silently fails twice.
- Circuit breaker is in-memory only. A pod restart resets the failure count. In a multi-instance Fly.io deploy (which the project memory confirms is the infra), each pod has its own breaker — provider quota exhaustion will be 3x the threshold before any pod opens its breaker.
- `autonomousHealthMonitor.ts` exists but reads `job_health_logs`, not source-data freshness.
- No `SELECT max(created_at) FROM transaction_training WHERE state = 'TX'` style SLA query anywhere in the codebase.

**Recommendation:** publish two metrics per source: `data_freshness_seconds` (now − max(source_recorded_at)) and `ingest_success_ratio_24h`. Alert when freshness > 2× the cron interval. Move the circuit breaker state to Redis so it's pod-shared.

---

## 8. Pipeline orchestration

- **No Airflow / Prefect / Dagster.** Not a flaw at this stage — but the team should know what they're not buying.
- Orchestration today = BullMQ `repeat: { cron }` strings sprinkled across ~20 job files + `setInterval` loops in `server/index.ts` (the `trackInterval` helper at line 104 is a nice touch — it tracks intervals for SIGTERM cleanup).
- **No DAG.** `countyAssessorIngest` writes to `transaction_training`. So does `dataIngestJob`. Neither knows about the other. If both run and contend on the same `transaction_hash`, the second loses silently (`DO NOTHING`) — fine, but there's no lineage record saying which job populated which row.
- **No DLQ.** BullMQ `removeOnFail: 3` means after 3 retries the job is gone. No poison-message archive, no replay capability.
- **No backfill tooling.** If county_assessor_ingest is broken for 5 days, recovering means manually running the job 5 times and hoping the lookback windows overlap.

**Recommendation (cheapest first):**
1. Add a `pipeline_runs` table with `(job_name, run_id, started_at, finished_at, status, watermark_before, watermark_after, rows_in, rows_out, rows_rejected)`. This *is* a lineage graph in tabular form.
2. Move every cron string into `server/jobs/schedule.ts` — single manifest.
3. Add a generic `replay(job_name, from_date, to_date)` admin endpoint.
4. Only consider Dagster when (a) DAG fan-out exceeds ~10 jobs with real dependencies or (b) ML retraining gates on data quality. Today neither is true.

---

## 9. Top-5 concrete defects

1. **`countyAssessorIngest` line 656**: high-motivation lead is logged but never written to `leads`. The promise in the docstring (`8. Trigger skip-tracing queue`) has no implementation. **This is the biggest revenue gap in the pipeline.**
2. **`fetchTaxDelinquentList`** returns `[]` for any county without `TAX_DELINQUENT_API_${fips}` env var. Of the ~50 counties in `TOP_LAND_COUNTIES`, I'd estimate <5 have keys configured — meaning 90% of the cron's "tax delinquent" output is empty.
3. **No `transaction_hash` index visible in `shared/schema.ts:9405`** — the raw-SQL `ON CONFLICT (transaction_hash)` will throw if the unique constraint doesn't exist. Verify with `\d transaction_training` on prod.
4. **Circuit breaker is per-pod, in-memory** — multi-instance deploys will exceed provider rate limits by 3× before tripping.
5. **Retention job uses `sql.raw` with string interpolation** — currently safe (table names are hard-coded) but one config-driven retention rule away from SQLi.

---

## 10. What I'd build first (ETL engineer's prioritization)

| Priority | Item | Effort | Payoff |
|---|---|---|---|
| P0 | Wire the high-motivation lead → `leads` insert that the job promises | 1 day | Unblocks the entire seller-motivation feedback loop |
| P0 | Add unique constraint check + zod validation at every external API boundary | 2 days | Stops silent zero-ingestion |
| P1 | `pipeline_runs` table + watermark-based incremental loads | 3 days | Late-arriving data + replay capability |
| P1 | Move circuit-breaker state to Redis | half-day | Multi-pod correctness |
| P2 | Soft-delete + tombstone semantics on ingested rows | 2 days | Deletes propagation |
| P2 | Single `schedule.ts` manifest + admin replay endpoint | 1 day | Operational sanity |
| P3 | SCD-Type-2 on `county_markets` | 2 days | Time-travel queries for ML |
| P3 | `data_freshness_seconds` metric per source + alert | 1 day | First real SLA |

Total: ~12 engineer-days to take this from "ad-hoc scripts" to "ETL with the boring stuff working." That's the right next investment — *not* an orchestrator.

---

## 11. Bottom line

The **provider registry** is a real piece of engineering. The **transaction-hash dedup** is the right idea. Everything else is a 2024-quality MVP that hasn't been hardened against the failure modes a Fivetran/Airbyte engineer sees every week: vendor schema drift, late-arriving rows, source deletes, multi-pod state divergence, missing watermarks, and "we logged it but didn't write it" bugs. The system will keep working until ATTOM ships a breaking change or a county silences its API — at which point it will fail silently, which is the worst kind of failure.

Fix the lead-write gap (#9.1) this sprint. Plan the watermark + `pipeline_runs` work for next sprint. Skip Dagster for at least 6 months.

— Wenzeslaus
