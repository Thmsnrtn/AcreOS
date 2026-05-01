# Postgres Operational Audit — AcreOS

**Author:** Nadia Stakich, Postgres DBA (ex-Shopify, ex-Stripe)
**Date:** 2026-05-01
**Lens:** "EXPLAIN plans are love letters. Autovacuum is the only friend you have at 3am. The migration tool you trust is the one whose journal matches `pg_class`."

I read Adriana's audit (`adriana-db.md`) — agree with the data-modeling and transaction layer findings; she covered the schema. My focus is the layer underneath: extensions, pooler, vacuum, bloat, PITR, and the hand-rolled `scripts/migrate.mjs` that has been quietly drifting from `migrations/meta/_journal.json` for months. I also read `server/db.ts`, `fly.toml`, and the migration files Adriana referenced. Static analysis only — recommendations include concrete `psql` commands the founder can run today to confirm.

---

## 1. One-line verdict

The Postgres instance is configured like an app server, not a database — **zero extensions enabled beyond defaults, no pooler, no autovacuum tuning, no bloat baseline, no PITR drill, and a release-command migrator (`scripts/migrate.mjs`) whose 14 statements have silently diverged from the Drizzle journal** which itself is missing 28 of 33 migration files. The cluster works because it has 50 active customers and 200k rows total. At 1M rows it will start hurting; at 10M it will hurt every day. Two weeks of work removes 90% of the future pain.

---

## 2. Extension audit — what to enable today

I grepped every migration and `server/db.ts` for `CREATE EXTENSION`. **Zero hits.** That means the cluster is running on the Fly.io default extension set — likely `plpgsql` only. For an app of AcreOS's complexity this is malpractice. Here is what to enable, in priority order, with the migration to do it:

### P0 (this week)

```sql
-- 0033_postgres_extensions.sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

| Extension | Why AcreOS needs it | Cost |
|---|---|---|
| **pg_stat_statements** | Adriana flagged that the slow-query story is aspirational. This extension *is* the slow-query story — normalizes and aggregates every query the cluster runs. Required to answer "what's slow this week." Also the only honest answer to "is the new migration regressing p95?" | Tiny — ~8KB shared memory per tracked query. Enable in `shared_preload_libraries`. Requires Fly.io postgres restart (one-time). |
| **pg_trgm** | The schema has a half-dozen routes doing `WHERE name ILIKE '%foo%'` (lead search, property search, contact lookup). Without `pg_trgm`, every one of those does a sequential scan. With it: GIN index on `gin_trgm_ops` and the same query goes from 800ms to 4ms at 1M rows. This is the single highest-leverage extension for a CRM. | None — index disk cost only (~30% of column size). |
| **btree_gin** | Lets you build composite GIN indexes mixing scalar columns with `jsonb`. Adriana noted ~40 jsonb columns with no GIN index. With `btree_gin` you can do `(organization_id, metadata)` GIN — both org-scoped AND jsonb-key-aware. | Negligible. |
| **pgcrypto** | `gen_random_uuid()` is currently coming from app code (Node UUID library) generating in JS, then passed to Postgres. With pgcrypto, `DEFAULT gen_random_uuid()` runs in-database and survives migration drift. Also enables `crypt()` for any future native-esign fingerprinting. | Negligible. |

### P1 (next sprint)

```sql
-- 0034_postgres_extensions_p1.sql
CREATE EXTENSION IF NOT EXISTS pg_partman;   -- only if Fly.io ships it; verify first
CREATE EXTENSION IF NOT EXISTS pg_cron;      -- in-DB scheduler for vacuum + retention
CREATE EXTENSION IF NOT EXISTS hypopg;       -- hypothetical-index testing without writes
```

| Extension | Why | Note |
|---|---|---|
| **pg_partman** | Adriana's partition plan for `audit_log`, `system_activity`, `agent_llm_traces`. Hand-rolled `CREATE TABLE … PARTITION OF` works, but `pg_partman` handles new-month partition creation + retention drop. Five lines of config replaces a hand-written cron. | Fly.io managed Postgres ships pg_partman as of 2024. Verify with `SELECT * FROM pg_available_extensions WHERE name = 'pg_partman';` before relying on it. |
| **pg_cron** | The provider_cache TTL cleanup, the `agent_llm_traces` 90-day redaction, the partition rotation, the slow-query snapshot — all currently homeless. `pg_cron` runs them inside the database. Removes a class of "the app instance that owned the cron got recycled" failures. | Fly.io supports it on dedicated Postgres clusters; not on the cheapest shared tier. Confirm tier. |
| **hypopg** | Lets you `SELECT hypopg_create_index('CREATE INDEX …')` and run `EXPLAIN` against the hypothetical index without actually building it. For a 447-table schema this is the difference between "spend an afternoon discussing whether index X helps" and "ten seconds, here's the plan." | Read-only impact. |

### P2 (when it matters)

- **postgis** — for parcel-shape spatial queries (land focus). Currently doing Haversine in JS.
- **pg_repack** — online REINDEX without table locks. Essential at 10M+ rows.
- **timescaledb** — only if agent_llm_traces / outcome_telemetry become truly time-series. pg_partman + BRIN covers 80%.

**Verify on prod:** `SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pg_stat_statements','pg_trgm','pgcrypto','pg_partman','pg_cron','btree_gin','hypopg','postgis','pg_repack');`

---

## 3. Vacuum / autovacuum tuning

The default Postgres autovacuum settings target a 1990s OLTP workload — small tables, low write rate. AcreOS has tables that will violate every default within a year:

- `audit_log` — append-only, high write rate, never updated → autovacuum default settles for "vacuum after 20% of table is dead." Append-only means ZERO dead tuples → autovacuum **never runs** → the visibility map and freeze map fall behind → eventually `autovacuum_freeze_max_age` (200M XIDs) trips and forces an emergency anti-wraparound vacuum that locks the table for hours.
- `notifications`, `inbox_messages` — high churn (read-flag flips, soft deletes) → 20% threshold means vacuum runs every few hours and never catches up; bloat accumulates.
- `payments` — moderate write rate but the optimistic-lock `version` increment causes every update to leave a dead tuple; autovacuum default lag is fine here today, but at 10× scale will lag.

### Per-table autovacuum tuning (migration after extensions)

```sql
-- Append-only: vacuum aggressively, freeze early, avoid emergency wraparound.
ALTER TABLE audit_log SET (
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_freeze_max_age = 100000000
);
ALTER TABLE system_activity SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE agent_llm_traces SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE outcome_telemetry SET (autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE campaign_delivery_events SET (autovacuum_vacuum_insert_scale_factor = 0.05);

-- High-churn: tighter scale factor.
ALTER TABLE notifications SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE inbox_messages SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE provider_cache SET (autovacuum_vacuum_scale_factor = 0.02);
```

`autovacuum_vacuum_insert_scale_factor` (PG13+) is the knob that makes append-only tables actually vacuum. Without it they NEVER autovacuum, you discover this six months in when a plan switches to seq-scan because the visibility map is stale.

### Cluster-wide settings

```
autovacuum_max_workers = 5         # default 3
autovacuum_naptime = 30s           # default 1min
autovacuum_vacuum_cost_limit = 2000  # default 200; SSDs handle far more
maintenance_work_mem = 1GB         # default 64MB; speeds vacuum + reindex
```

**Verification:**
```sql
SELECT relname, n_live_tup, n_dead_tup,
  last_autovacuum, last_autoanalyze,
  (n_dead_tup::float / NULLIF(n_live_tup,0)) AS dead_ratio
FROM pg_stat_user_tables
WHERE n_live_tup > 1000
ORDER BY dead_ratio DESC NULLS LAST LIMIT 30;
```
Anything with `dead_ratio > 0.2` and `last_autovacuum > 24h ago` is a tuning gap.

---

## 4. Connection pooling — echo Adriana

Adriana flagged the missing pgBouncer; I'll concretize the recommendation since she left the deployment shape ambiguous.

**Current state** (from `server/db.ts`):
- App pool: `max: 20`, statement_timeout 30s.
- Replica pool: `max: 5`.
- Direct Postgres connections, no pooler.

**Failure mode at 6 instances:** 6 × 25 = 150 connections, default Fly Postgres caps at 100 → 5xx storm.

**The recommended shape:**

```
[Fly app instances × 2-6]
        │
        │ (~5 conn per instance)
        ▼
[pgBouncer in transaction-pooling mode, port 6432]
        │
        │ (max 30 conn to primary, 10 to replica)
        ▼
[Postgres primary] [Postgres replica]
```

**Deployment:** dedicated Fly app (`acreos-pgbouncer`) in same region, ~$5/mo. Sidecar dies with the machine; Supavisor / PgCat are alternatives if Drizzle prepared statements misbehave.

**Drizzle + transaction pooling caveat:** Drizzle uses the pg client's `prepared` flag. Transaction pooling breaks named prepared statements because consecutive queries may land on different backends. Either set `prepared: false` (~5% slower on hot queries) or run two pgBouncer pools — **session pool** for `scripts/migrate.mjs` (needs affinity for LOCK), **transaction pool** for app traffic.

```ini
[databases]
acreos = host=primary.flycast dbname=acreos pool_mode=transaction
acreos_session = host=primary.flycast dbname=acreos pool_mode=session
[pgbouncer]
listen_port = 6432
max_client_conn = 500
default_pool_size = 30
reserve_pool_size = 5
server_idle_timeout = 600
```

---

## 5. Index bloat strategy

Adriana mentioned bloat in passing. Here's the actual playbook.

**The math of bloat:** every UPDATE in Postgres writes a new row version, leaves the old one. Indexes get a new entry pointing to the new row, the old entry stays until vacuum. For `payments` with optimistic locking, every payment status change writes a new row → every index on payments gains a stale entry. After 18 months of churn, indexes can be 30–40% larger than necessary, queries slow proportionally.

### Bloat baseline (run today)

```sql
-- Approximate index bloat
SELECT
  schemaname, tablename, indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
JOIN pg_index USING (indexrelid)
WHERE pg_relation_size(indexrelid) > 1024 * 1024  -- > 1MB
ORDER BY pg_relation_size(indexrelid) DESC LIMIT 30;

-- Unused indexes (zero scans since last reset)
SELECT schemaname, relname, indexrelname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
  AND indexrelname NOT LIKE '%_uniq%'
ORDER BY pg_relation_size(indexrelid) DESC LIMIT 50;
```

Adriana estimated 10–15% of declared indexes are dead weight. The unused-indexes query gives you the actual list. Drop confidently after confirming via two production samples a week apart (so a once-per-quarter query path doesn't get nuked).

### REINDEX cadence

```sql
-- Monthly, off-peak (Sunday 03:00 UTC), via pg_cron:
REINDEX INDEX CONCURRENTLY notifications_user_id_is_read_idx;
REINDEX INDEX CONCURRENTLY payments_note_id_idx;
REINDEX INDEX CONCURRENTLY inbox_messages_org_received_idx;
-- and any index where pgstattuple shows > 30% bloat
```

`REINDEX CONCURRENTLY` is non-blocking on Postgres 12+ — safe to run on production. Use `pg_cron` to schedule, not the app layer (the app might miss it; the DB won't).

For tables hitting 10M+ rows, consider `pg_repack` (P2 extension above) which rebuilds the table itself, not just indexes — recovers heap bloat too. Until then, `VACUUM (FULL, ANALYZE)` once a quarter on the worst offenders during a maintenance window.

---

## 6. PITR + restore drill

**Current state:** Fly.io managed Postgres provides daily snapshots (default 7-day retention on basic tier) and continuous WAL archiving on dedicated tiers. That's the *capability*. **What I cannot find is evidence anyone has ever performed a restore.** A backup that has not been restored is a hope, not a backup.

**The drill — to run within 30 days, then quarterly:**

1. **Provision a staging cluster** (`fly pg create --name acreos-restore-drill --region iad`).
2. **Restore from yesterday's snapshot:**
   ```bash
   fly pg restore <snapshot-id> --app acreos-restore-drill
   ```
3. **Run the smoke suite** against it (`DATABASE_URL=…restore-drill npm test -- --grep "smoke"`).
4. **Confirm row counts** match production within 24h delta:
   ```sql
   SELECT relname, n_live_tup FROM pg_stat_user_tables
   WHERE n_live_tup > 100 ORDER BY n_live_tup DESC LIMIT 20;
   ```
5. **Document time-to-restore** — should be < 30 minutes for the current data size. Will grow.
6. **Tear down.**

**PITR specifically (not just snapshots):** confirm with Fly support whether your tier has WAL archiving enabled (it's on the `dedicated` plan and up). If yes, you can restore to any point in the last N days, not just snapshot boundaries. Critical for "we deployed bad code at 14:32, restore to 14:31."

If WAL archiving is NOT enabled, your RPO is 24 hours — meaning a 14:32 disaster loses up to 24 hours of customer data. For a CRM holding investor financial records, this is **not acceptable**. Upgrade tier or set up `wal-g` to S3 yourself before customer N+1 signs an MSA that requires a < 1h RPO.

**Backup integrity check** (separate from restore drill, run weekly via pg_cron):
```sql
SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();
```

---

## 7. Drizzle migration drift — the actual problem

I read `scripts/migrate.mjs` carefully. It is honest about what it does:

> "We deliberately avoid drizzle-orm's migrator here because the local _journal.json is out of sync with what's actually been applied to prod (many migration files live outside the journal), and running a migrator against drifted state risks re-applying already-applied migrations."

Translation: **the migration system is broken and the workaround is hand-written idempotent ALTERs in a 100-line shell script that the founder remembers to update.** Counted from `migrations/`: **33 SQL files**. Counted from `migrations/meta/_journal.json`: **5 entries** (0000, 0001, 0002, 0003_robust_namora, 0015_pax_deep_features — and the journal index even skips numerically). That means **28 migration files exist that Drizzle's journal has no record of.**

The `scripts/migrate.mjs` workaround is fine for emergencies but it is technical debt with compound interest:

- Every new column added to `shared/schema.ts` either gets a new `migrations/00XX_*.sql` (which Drizzle's journal won't track) OR gets bolted onto the `STATEMENTS` array in `migrate.mjs` (which has zero ordering, zero rollback, zero history).
- The two paths can disagree. Right now `notes.deleted_at` is added in `migrate.mjs` line 22 — but it's also in the schema. Is it in the migrations? I'd bet not, because the journal is broken.
- Onboarding a new engineer: "to run migrations you run `node scripts/migrate.mjs`, NOT `drizzle-kit push`, and don't trust the journal." That is the smell.

### The fix: rebaseline

This is a one-time, half-day operation. Steps:

1. **Snapshot prod schema** — `pg_dump --schema-only acreos > prod_schema.sql`.
2. **Generate a fresh Drizzle baseline** — `drizzle-kit generate --custom --name baseline_2026_05` from the current `shared/schema.ts`. Compare to `prod_schema.sql`. They should diff in zero ways. If they do, fix the schema file to match prod (whichever direction is right).
3. **Truncate the migrations folder.** Move existing `0000_*.sql`–`0032_*.sql` to `migrations/_archive/`. Keep them on disk for history. Reset `_journal.json` to one entry: the new baseline.
4. **Mark the baseline applied in prod** — `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (<baseline_hash>, now())`. (Or whatever Drizzle's tracking table is.) This tells future `drizzle-kit migrate` "the baseline is already applied, only apply NEW migrations."
5. **Delete `scripts/migrate.mjs` STATEMENTS array.** Replace with: `await migrate(db, { migrationsFolder: './migrations' })`. The Drizzle migrator now takes over.
6. **CI lint** — pre-commit hook that runs `drizzle-kit generate --check` and fails if the schema and migrations diverge. Same hook Adriana asked for, different angle.

After this, future migrations are: edit schema → `drizzle-kit generate` → review SQL → commit → release auto-applies. The "edit migrate.mjs by hand" path is gone.

**Risk:** done wrong, you re-run a migration that's already applied → duplicate column error → release blocks. Mitigation: do step 2 carefully, run on staging twice before prod, and keep `scripts/migrate.mjs` available as a rollback path for one release cycle.

---

## 8. Replication lag monitoring (forward-looking)

Salma's region audit recommends replicas in `lhr` and `syd` once non-US customers arrive. The day a replica goes live, you need lag monitoring or you'll serve stale reads. The query:

```sql
-- On primary
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
  pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;

-- On replica
SELECT now() - pg_last_xact_replay_timestamp() AS lag_seconds;
```

Wire to Prometheus via the `postgres_exporter` — alert on `lag_seconds > 5`. Application-side, the `replicaPool` in `server/db.ts` should be wrapped with a "skip replica if lag > 2s" guard so a degraded replica doesn't serve stale customer data. Drizzle doesn't ship this; ~30 lines of code.

---

## 9. The 1-week Postgres operational sprint

**Day 1 — extensions + slow-query observability**
1. Migration `0033_postgres_extensions.sql` enabling `pg_stat_statements`, `pg_trgm`, `btree_gin`, `pgcrypto`. Restart Fly Postgres for `shared_preload_libraries` to pick up pg_stat_statements. (½ day)
2. Wire the slow-query view to `/api/admin/db/top-queries` (founder-only). Surface top-50 by total_exec_time. (½ day)

**Day 2 — autovacuum tuning + bloat baseline**
3. Migration `0034_autovacuum_tuning.sql` per-table settings from §3. (¼ day)
4. Run the bloat + unused-index queries from §5 against prod. Drop confirmed-unused indexes (after one-week confirmation window). (½ day)
5. Document baseline numbers in a `db-health-baseline-2026-05.md` so future runs can compare. (¼ day)

**Day 3 — pgBouncer**
6. Deploy pgBouncer as Fly sidecar app. Two pools: transaction + session. (1 day)
7. Switch app `DATABASE_URL` to transaction pool. Switch migrate.mjs to session pool. Confirm prepared-statement behavior; flip `prepared: false` if needed. Smoke-test under load.

**Day 4 — Drizzle drift fix**
8. Schema rebaseline per §7. Stage twice. Apply to prod inside a tx where possible. Delete the `STATEMENTS` array from `migrate.mjs`. (1 day)

**Day 5 — PITR drill + cron + replication scaffolding**
9. Run the restore drill from §6. Document time-to-restore. (½ day)
10. Enable `pg_cron`. Migrate the provider_cache TTL cleanup, the agent_llm_traces 90-day redaction, the monthly REINDEX, the daily `query_perf_snapshot` to in-DB cron. (½ day)
11. Add `postgres_exporter` to monitoring stack with replication-lag query already wired (will report 0 until replicas exist). (½ day — overflow into week 2 if needed.)

**Stretch (week 2):**
- Install `pg_partman`, partition `audit_log` + `system_activity` + `agent_llm_traces` per Adriana's plan.
- Add `hypopg` and use it to validate every proposed index from Adriana's audit before adding.
- Encrypted backups via `wal-g` to S3 + GPG, on top of Fly's snapshots — defense in depth for the day Fly has an outage.
- Connection-saturation alert via `pg_stat_activity` count > 80% of `max_connections` → PagerDuty.

---

## Closing note

Adriana's audit is correct on the schema; what I'm adding is the operational substrate beneath it. The priority order matters: enable `pg_stat_statements` FIRST, because every other recommendation in this doc and hers becomes data-driven the moment that view starts collecting. Without it, we are both writing informed opinion. With it, the next audit becomes "here are the seven queries that account for 60% of total_exec_time, fix them in order."

The migrate.mjs drift is the bug that scares me most. Schemas drift slowly until they don't, and the day you need to do an emergency rollback is the day you'll discover the journal lied. Fix that this week.

— Nadia Stakich
