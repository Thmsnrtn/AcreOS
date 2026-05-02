# Octavia Askew — Data Warehouse Architecture, AcreOS

**Lens:** 50, ex-Snowflake principal architect, eight years before that at Teradata. I get called when a SaaS company's Postgres-as-warehouse pattern starts melting on Mondays — when the founder's WBR query times out, when the CFO's deferred-revenue report blocks an OLTP write, when the BI vendor's nightly extract takes a replica out for an hour. Marisol is asking for List/Booked/Recognized/Committed ARR off a single source of truth. Hassiba's spec puts five new ledger tables on the same Postgres that's serving live customer requests. Maxim's WBR snapshot is a weekly aggregation read pattern that wants to scan 18 months of `subscription_events` and `revenue_recognition` while a webhook is trying to insert into them. **They have all written a warehouse without naming it one.** My job is to tell Thomas when to stop pretending Postgres is the warehouse, what to move it to, and what it costs.

---

## 1. One-line verdict

**AcreOS does not need a warehouse today and should not build one for ~9–12 months.** Postgres + a read replica handles the load. **The trigger to move is not org count — it's the day the WBR query blocks a customer write, the day Hassiba's recognition worker takes longer than its cron interval, or the day the founder asks "what was MRR on March 14, 2024" and Postgres takes 40 seconds to answer.** When that day comes — and it will — the right answer for AcreOS is **DuckDB on object storage today, BigQuery if scale forces a managed warehouse, Snowflake only if you take Series-B and hire a data team**. Redshift is wrong for AcreOS. ClickHouse is over-engineering. Walk-through below.

---

## 2. The trigger conditions — when, not if

Three independent signals. **Move when any two fire in the same month.**

| Signal | Threshold | How to measure |
|---|---|---|
| **WBR / dashboard contention** | Any reporting query holds a row-lock or buffer-pool slot for >2s while a customer-facing write is queued behind it. P95 reporting query latency >5s. | `pg_stat_activity` sampling + Hassiba's recognition worker runtime |
| **Ledger-table size** | `subscription_events` + `revenue_recognition` + `mrr_snapshots` cross 10M rows combined; or `usage_records` (Maxim's COGS rollup) crosses 50M rows | `pg_class.reltuples` weekly snapshot |
| **Recognition / reporting worker runtime** | Hassiba's nightly worker takes >15 min, or any WBR snapshot query exceeds 30s | Worker telemetry + slow-query log already wired in `server/db.ts` |

Org-count tipping points (rough — depends on usage shape, not org count alone):

- **0–500 paid orgs** — Postgres primary only. No replica needed for analytics. Today.
- **500–2,000 orgs** — Postgres primary + read replica. `dbReadOnly` route already exists in `server/db.ts`. Move all reporting reads off primary. **AcreOS is here once paid count crosses ~150–200, conservatively.**
- **2,000–10,000 orgs** — Postgres primary + replica + **DuckDB-on-S3 nightly extract** for analytics. dbt-core builds dimensional models on the extract. Operational reporting (NRR, ARR, WBR) reads from DuckDB, not Postgres. This is the zone AcreOS will live in for years.
- **10,000+ orgs OR multi-product** — Managed warehouse (BigQuery first, Snowflake if a data team exists). Streaming CDC. Workload isolation by team.

The land-investor SaaS shape — single-digit-thousand orgs each generating tens of thousands of leads, parcels, AI calls — fits comfortably in the DuckDB tier for the foreseeable future. **There is no plausible 2026–2027 scenario where AcreOS needs Snowflake.**

---

## 3. The five candidates — verdict per

### 3.1 Snowflake — *wrong for AcreOS until Series B*

The platform I built career equity on, and the wrong answer here. Snowflake's pricing model assumes a data team running it: warehouses sized per workload, roles separated by team, query federation, materialized views per dashboard. At AcreOS's scale a single XS warehouse runs ~$60/day if anyone forgets to suspend it, ~$24/month if disciplined. Acceptable. But the **operational tax** — Snowpipe setup, RBAC scaffolding, query-tag discipline, credit-burn alerts — needs at least 0.5 FTE that AcreOS does not have. **Reconsider after Series B with a hired data engineer.** Don't pay the Snowflake tax to get DuckDB-equivalent functionality.

### 3.2 Redshift — *wrong, full stop*

Old-school MPP. Concurrency limits (50-default WLM slots) are a footgun for the bursty WBR pattern. Redshift Serverless pricing is opaque and cold-start latency is real. If you go AWS-managed, **Athena+Iceberg over the same S3 parquet DuckDB reads** is cheaper and simpler. Skip Redshift.

### 3.3 BigQuery — *the right managed answer if you outgrow DuckDB*

If AcreOS hits the 10k-org tier and the founder still doesn't have a data team, BigQuery is the right move. Why:

- Pay-per-query (~$5/TB scanned) maps cleanly to AcreOS's bursty Monday-morning WBR load. No always-on warehouse cost.
- Storage at $0.02/GB/mo active, $0.01/GB/mo long-term — for AcreOS's first few TB this is rounding error.
- Streaming inserts are first-class. Hassiba's `subscription_events` writes can stream directly into BQ via Datastream-from-Postgres CDC. No nightly batch lag.
- dbt-bigquery is mature, free, and the ecosystem of pre-built dbt packages (dbt_utils, dbt_metrics, dbt_codegen) is bigger than Snowflake's by volume.
- The query language is closer to standard SQL than Snowflake's; transition friction is low.

**Estimated AcreOS BQ bill at 5,000-org scale:** $80–$200/month. At 50,000-org scale: $1.5k–$3k/month. Cheaper than the engineer-hour to maintain a self-hosted alternative once you cross that threshold.

### 3.4 DuckDB — *the right answer for the next 12–18 months*

DuckDB is the answer Thomas should hear loudest. It is:

- **Embedded** — runs in a Node process, in a worker, or in a Lambda. No cluster to operate.
- **Column-store, vectorized** — the WBR-shape workload (scan 18 months of `subscription_events`, group by week) is 50–200× faster than Postgres for the same data.
- **Reads parquet on S3 directly** — `SELECT * FROM 's3://acreos-warehouse/subscription_events/*.parquet'` works out of the box with httpfs extension.
- **Postgres extension is excellent** — `ATTACH 'postgres://…' AS acreos_pg (TYPE postgres)`; queries Postgres tables transparently. Means you can prototype without an ETL.
- **Free.** Zero license, zero hosting if you embed it in your existing Fly.io worker.

**The DuckDB pattern for AcreOS:**

```
Postgres OLTP (live)
   │
   │ logical replication / wal2json or nightly pg_dump
   ▼
S3 parquet "warehouse" (acreos-warehouse bucket)
   │ partitioned: organization_id_hash / event_date
   ▼
DuckDB process (in a worker on Fly.io, or in CI for nightly snapshots)
   │
   ├─► dbt models (staging → marts → metrics)
   └─► reporting API (the mrr_snapshots, NRR, COGS, WBR queries)
```

Total infra cost at AcreOS scale: **~$5–$30/month** (S3 storage + occasional egress). The DuckDB process itself runs on infrastructure AcreOS already pays for.

The catch: DuckDB is single-process. Multiple concurrent BI users hitting it directly will conflict. Mitigation: each query is a fresh process, OR you put MotherDuck (the managed multi-tenant DuckDB) in front for $25/month. For AcreOS's "founder + maybe one analyst" reader pattern, single-process is fine for a long time.

### 3.5 ClickHouse — *over-engineered*

ClickHouse is for billion-event/day clickstream / ad-tech / observability workloads. AcreOS is none of those. The operational cost (Keeper, replication, ALTER TABLE pain) is not worth it when DuckDB handles the same shape an order of magnitude smaller. **Don't.**

---

## 4. The recommended path — three phases

### 4.1 Phase 1 — "no warehouse, but well-disciplined Postgres" (now → 9 months)

What Marisol and Hassiba already specified IS the warehouse foundation, just running on Postgres. Discipline:

1. **Every reporting query reads from `dbReadOnly`.** It exists; enforce via lint rule that flags `db.select(...).from(mrr_snapshots)` outside of writes.
2. **`mrr_snapshots`, `revenue_recognition`, `subscription_events`, `wbr_snapshots` are append-only.** Hassiba mandated this; build it with a check constraint and a pre-write trigger that rejects UPDATEs on these tables.
3. **Materialized views for the WBR queries.** `v_arr_breakdown`, `v_revenue_concentration`, `v_nrr_components` — refreshed concurrently by Hassiba's nightly worker. Reads stay millisecond-fast even as the ledger grows.
4. **Partition the heavy ledger tables.** `subscription_events` and `revenue_recognition` partitioned by `effective_at` month / `period_start` month. Postgres declarative partitioning is mature; this alone buys 18+ months of headroom.
5. **Slow-query budget.** Existing slow-query monitor in `server/db.ts` should alert when *any* reporting query crosses 2s. That's the warehouse trigger #1 above.

### 4.2 Phase 2 — "DuckDB on parquet" (9–18 months, kicked off when triggers fire)

One-week build:

| Day | Task | Output |
|---|---|---|
| 1 | Set up `acreos-warehouse` S3 bucket. Partition layout: `s3://acreos-warehouse/<table>/dt=YYYY-MM-DD/part-NNNN.parquet` | Storage layer |
| 2 | Nightly Fly machine: `pg_dump` the immutable ledgers (subscription_events, revenue_recognition, usage_records, audit_log) to parquet via DuckDB's COPY. Idempotent on date partition. | ETL job |
| 3 | dbt-core repo + profiles.yml pointing at DuckDB-S3. Three layers: `staging/` (raw mirror) → `marts/` (dim_org, fct_subscription_event, fct_revenue_recognition, fct_usage) → `metrics/` (mrr_snapshot, nrr_components, cogs_per_org, wbr_snapshot). | Transform layer |
| 4 | Migrate the WBR snapshot worker, NRR computation, and COGS rollup to read from DuckDB instead of Postgres replica. Reporting API serves from a thin DuckDB-backed cache. | Reporting cutover |
| 5 | dbt tests on the marts (uniqueness, not_null, accepted_values, ledger reconciliation `Σ(subscription_events.mrr_delta) == latest mrr_snapshot.mrr_cents`). CI runs them on every PR. | Data quality |
| 6 | Backfill from Postgres history (one-shot `pg_dump → parquet → dbt build` over the full archive). | Catch-up |
| 7 | Decommission the report-side replica usage; primary keeps serving OLTP, replica becomes a hot-spare only. Cost savings: one Fly Postgres replica. | Operational simplification |

**Cost delta vs Phase 1:** ~+$15/mo S3, ~$0 compute (runs on existing Fly schedule), **−$50–$200/mo** by retiring the analytics replica. **Net savings.**

### 4.3 Phase 3 — "managed warehouse" (only if Series B funds a data team)

Triggered by: ≥10k paying orgs, OR a hired data engineer, OR a BI tool needing concurrent reader workload. Migrate dbt from `dbt-duckdb` to `dbt-bigquery`; flow becomes Postgres → Datastream CDC → BigQuery → dbt → BI. **dbt models do not change** — that's why Phase 2 is dbt-core. Migration is a profile swap. Don't move a day before triggers fire.

---

## 5. Dimensional model — the marts the team needs

Eight marts cover everything Marisol, Hassiba, and Maxim asked for. Star schema, conformed `dim_org` and `dim_date` across all facts.

### 5.1 Dimensions

| Mart | Grain | Notes |
|---|---|---|
| `dim_org` | one row per organization, SCD Type 2 on tier/interval/seat_count | Drives every retention and revenue cut |
| `dim_date` | one row per day, with fiscal-period attributes | Standard. Build once, never touch again. |
| `dim_user` | one row per user, SCD Type 2 on role | For the founder-bottleneck and support metrics |
| `dim_tier` | one row per tier × interval × effective period | Sourced from `shared/billing/tier-pricing.ts` (Marisol's #1) |

### 5.2 Facts

| Mart | Grain | Source | Used by |
|---|---|---|---|
| `fct_subscription_event` | one row per ledger event | Hassiba's `subscription_events` | NRR/ARR decomposition, WBR Block 1 |
| `fct_revenue_recognition` | one row per (org, period, deferred_revenue_id) | Hassiba's `revenue_recognition` | Recognized ARR, deferred-revenue waterfall |
| `fct_usage` | one row per usage record (AI call, SMS, postcard, provider lookup) | `usage_records` | COGS-per-customer, Maxim's WBR Block 3 |
| `fct_support_event` | one row per ticket open/touch/resolve/breach | `support_tickets`, `support_metrics` | WBR Block 4 reliability |
| `fct_founder_action` | one row per founder-only-path action | `auditLog` filtered by actor=founder | Maxim's bottleneck metric |

### 5.3 Metric layer

dbt's `metrics:` block (or MetricFlow) defines NRR, GRR, ARR variants, gross margin, CAC payback, runway, NPS — *once*, in code, in version control. Every consumer (founder home, board deck export, Hex notebook) calls `select * from {{ metric('nrr_90d') }}`. **Single source of metrics truth. Marisol's #1 generalized.**

---

## 6. Batch vs streaming — get this decision right

**AcreOS should run batch-first, stream the two specific things that need it, and never confuse the two.**

| Workload | Batch or stream? | Why |
|---|---|---|
| WBR snapshot | Daily batch | Once a day at 7am Monday. Even nightly is overkill on weekdays. |
| MRR snapshot | Daily batch | Hassiba already specified daily. |
| NRR / GRR | Daily batch | 90-day window; 24h of lag is invisible. |
| COGS rollup | Daily batch (top-of-day for prior day) | Founder reads it Monday; 24h lag is fine. |
| Customer-concentration alert | Near-real-time (5-min refresh) | When an org crosses 25%, Thomas needs to know that hour, not next morning. |
| Fraud / abuse signals | Near-real-time (1-min) | If usage_records show a $4k-overnight provider-lookup spike, batch-tomorrow is too late. |
| Operational dashboards (active org count, sign-ups today) | Live from Postgres replica | Don't pipe trivia through the warehouse. |

**Rule:** anything that informs a Monday founder review is batch. Anything that triggers an alert tonight is stream. Two streams (concentration, abuse). Everything else is a 24h-fresh nightly batch. **Resist any vendor pitch that claims you need real-time analytics; the operational complexity 10×s for an SMB-SaaS with a Monday WBR cadence.**

When Phase 3 happens: Datastream CDC from Postgres → BigQuery streaming inserts gives you sub-minute freshness essentially for free. Until then, stick to batch.

---

## 7. dbt setup — the minimum viable rig

Five rules that will keep dbt sane for the next three years:

1. **dbt-core, not dbt-cloud.** AcreOS doesn't need the orchestrator UI. GitHub Actions or a Fly cron runs `dbt build` nightly. Save the $100/seat/month.
2. **Three layers, no exceptions.** `staging/` is 1:1 with raw source tables (rename + cast only). `marts/` is the dimensional model. `metrics/` is the canonical metric definitions. No business logic in staging; no raw column names in marts.
3. **Tests on every mart.** `not_null`, `unique`, `relationships`, `accepted_values`. Plus custom tests for ledger consistency: "subscription_events sum matches mrr_snapshots latest." dbt fails the build on test failure; **failed builds page Thomas, not just the channel**, because a silent test failure in the metric layer is a wrong number on the WBR.
4. **Documentation auto-generated.** `dbt docs generate` → host on S3 + CloudFront. Hassiba's accounting policies link in. Auditor reads the docs site.
5. **Source freshness checks.** dbt's `freshness:` block on every source table. If `subscription_events` hasn't gotten a row in 6h during business hours, the WBR pipeline alerts before the founder opens it Monday morning.

Repository layout: `analytics/{dbt_project.yml, profiles.yml, models/{staging,marts/{core,finance,product,governance},metrics}, tests, macros, snapshots, seeds}`. Tier-pricing constants imported via macro from `shared/billing/tier-pricing.ts`.

---

## 8. Governance — the non-glamorous half

A warehouse without governance is a liability the day a customer asks "what happens to my data when I delete my account?"

| Concern | Phase 1 (now) | Phase 2 (DuckDB) | Phase 3 (BigQuery) |
|---|---|---|---|
| **PII inventory** | Tagged columns in `shared/schema.ts` (annotation comment) | dbt source `meta:` tag per column | BigQuery policy tags + DLP scans |
| **GDPR delete propagation** | Cascades in Postgres handle it | Nightly re-extract picks it up; **breakage point — see below** | CDC stream picks it up within minutes |
| **Access control** | DB roles in Postgres | Per-bucket IAM on S3; founder reads, ETL writes | BQ project IAM; dataset-level for finance vs product |
| **Audit log of warehouse access** | `pg_stat_statements` | CloudTrail on S3 bucket | BQ audit logs to a separate project |
| **Secrets** | DATABASE_URL in env | S3 access via IAM role on Fly machine; no static keys | Workload Identity Federation |
| **Lineage** | n/a | `dbt docs` exposed lineage graph | Same + Dataplex auto-lineage |
| **Cost attribution** | n/a | n/a | BQ query labels per dbt model; weekly cost report |

**The GDPR-delete subtle issue:** when a customer requests deletion, the OLTP cascade in Postgres removes their rows. The S3 parquet partitions still contain that data until next re-extract. AcreOS's DPA will need to commit to a 24-hour deletion SLA at the warehouse layer; that means a daily "deletion replay" job that reads the audit-log of GDPR deletes and rewrites the affected parquet partitions with the rows excluded. This is a 1-day build but **it must ship the same week the warehouse does or AcreOS is out of GDPR compliance.** Easy to forget.

PII separation: the `metrics/` mart should never contain raw email, phone, address, SSN, or financial-account numbers. Aggregates only. The `marts/core/dim_org` keeps a hashed org identifier as the join key. If a Hex notebook ever needs PII, it reads from a separate `pii/` mart that requires elevated IAM. **Founder is the only role with `pii/` read by default**; analyst hires get `metrics/` + `marts/` but never `pii/` until reviewed.

---

## 9. The numbers — what this actually costs

| Phase | Infra cost | Engineering cost | When |
|---|---|---|---|
| Phase 1 (Postgres + replica + materialized views) | +$50–$200/mo replica (already in budget) | 1 week to enforce discipline + add the views Marisol/Hassiba specified | Now — overlaps with finance sprint |
| Phase 2 (DuckDB + parquet + dbt-core) | +$15–$30/mo S3 storage; **−$50–$200/mo** if replica retires | 1 week build + 1 week shadowing | When two of three triggers in §2 fire |
| Phase 3 (BigQuery + Datastream CDC) | $200–$500/mo at 5k orgs; $1.5–3k at 50k | 2–3 weeks migration; data-engineer hire | Only if Series B funds the team |

The capital efficiency story for the board: **AcreOS will operate without a managed warehouse through ~10k paying orgs**, on infrastructure you already pay for, with the same dbt project that ports cleanly to BigQuery the day you decide to scale up. Most peers waste $30k/year on Snowflake before they have 500 customers. Don't.

---

## 10. The audit — what's wrong today

Three concrete present-tense problems that Thomas should fix before Phase 1 closes:

1. **`server/db.ts` has `dbReadOnly` but only some services use it.** A grep across `server/services/` shows the analytics-shaped queries still hit `db` in many places. Lint rule: any query reading from `mrr_snapshots`, `revenue_recognition`, `subscription_events`, `usage_records`, `audit_log` *must* go through `dbReadOnly`. Prevents Marisol's CFO close from holding up a checkout webhook.
2. **No partitioning on the future ledger tables.** Hassiba's spec writes append-only tables that will hit 10M rows within a year. Add `PARTITION BY RANGE (effective_at)` to `subscription_events` and `PARTITION BY RANGE (period_start)` to `revenue_recognition` at creation time, with monthly partitions. Cheaper to do at table creation than to retrofit.
3. **`shared/schema.ts` is 15,387 lines.** That is too large for dbt to source-introspect cleanly when Phase 2 lands. Time to break it apart by domain (`schema/billing.ts`, `schema/leads.ts`, `schema/parcels.ts`, etc.) before the warehouse depends on it. This is a 1-day refactor today, a 1-week one in eighteen months.

---

## Bottom line

The team got the spec right and missed naming the system. **Marisol's source-of-truth pricing module + Hassiba's three append-only ledgers + Maxim's snapshot table is a Kimball star schema in disguise running on Postgres.** Treat it that way: enforce read replica, partition the ledgers, materialize the dashboard views — and you have bought 9–12 months of warehouse-free runway at zero incremental cost.

When the runway ends, build DuckDB-on-parquet in a week, pay $30/month, and run the same dbt project for two more years. Only consider a managed warehouse — and that warehouse is BigQuery, not Snowflake — when AcreOS has both the org count and the data-team headcount. Don't pay vendor tax to solve a problem you don't have.

The boring infrastructure decision is the right one. AcreOS does not need a warehouse; it needs a disciplined Postgres followed eventually by an embedded one. Plan the path; don't take the first step until the data forces it.

— Octavia
