# Bjorn Hagstrom — Fly.io Infra Audit

**Persona:** Bjorn Hagstrom · 4 years Fly.io deploy infra
**Wave:** 2 / Elite Deep
**Date:** 2026-05-01
**Scope:** `fly.toml`, `Dockerfile`, `scripts/migrate.mjs`, `.github/workflows/deploy.yml`, Postgres + secrets posture

---

## 1. One-line verdict

> **AcreOS is a "single-region single-cluster startup deploy" wearing a production hat — the bones are honest, but iad-only + zero restore drills + a hand-rolled migrator means one bad day in Ashburn is a full outage with manual recovery.**

---

## 2. fly.toml audit

```toml
app = 'acreos'
primary_region = 'iad'
[deploy]
  release_command = "node scripts/migrate.mjs"
[http_service]
  internal_port = 5000
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 2
  [http_service.concurrency]
    type = 'requests'
    soft_limit = 200
    hard_limit = 250
[checks.health]
  port = 5000; type='http'; interval='30s'; timeout='5s'
  grace_period = '15s'; path = '/api/health/cached'
[[vm]] memory='4gb'; cpu_kind='performance'; cpus=2
```

### What's right
- `auto_stop_machines = 'off'` + `min_machines_running = 2` — correct call. SaaS apps with cold-start cost (Clerk init, healthcheck warmup, JIT compile of route bundle) should never let Fly stop machines.
- `force_https` is implicit on http_service — good.
- Release command pattern (one-shot VM before traffic shift) is exactly what Fly expects.
- Healthcheck hits `/api/health/cached`, not the uncached `/api/health` — sane. The cached endpoint reads from `healthCheckService.getLastResults()` and only falls back to live check on cold boot.
- `grace_period = 15s` matches the Dockerfile `HEALTHCHECK --start-period=15s` — consistent.

### What's broken / sloppy

**B1. Single health check is doing two jobs.** Fly distinguishes between **liveness** (is the process alive — restart if not) and **readiness** (should this machine receive traffic). AcreOS has one `[checks]` block. That means a transient DB blip → machine restart → cascade. You want:
```toml
[[http_service.checks]]   # readiness — pulls from rotation only
  path = '/api/health/cached'
  interval = '10s'; timeout = '2s'; grace_period = '5s'
[checks.liveness]          # process-only, no DB dep
  path = '/api/health/live'
  interval = '30s'; timeout = '5s'; grace_period = '30s'
```
There is no `/api/health/live` route today. Need to add a process-only ping endpoint that returns 200 without touching DB/Redis/external providers.

**B2. `grace_period = 15s` is too short.** Container boot includes Vite SSR import, Drizzle pool init, Clerk publishable-key fetch, Sentry init. Real cold-start on `performance-2x` is 8–22s in iad. Fly will start failing checks before the app finishes warming. Set to `30s` minimum.

**B3. No `[deploy] strategy` declared.** Default is `canary` for apps with multiple machines, which is fine — but during a release with 2 warm machines, Fly will rolling-deploy one at a time, meaning ~50% capacity during deploy. With concurrency `soft_limit=200`, a single machine handling 400 RPS will get hot. Either:
- Add a third machine just for deploys (`flyctl scale count 3`)
- Set `strategy = 'bluegreen'` (requires 2x machine cost during deploy window)

**B4. `soft_limit=200`, `hard_limit=250`.** This is `type='requests'` not `type='connections'`. For a Node.js single-threaded event loop, 200 in-flight HTTP requests per machine is **aggressive**. Anything that does sync work (Puppeteer, large JSON parses, `fs.readFileSync` on bundle reads) will queue. Recommend `soft_limit=100, hard_limit=150` until p95 latency is profiled under real load.

**B5. No `[metrics]` block.** Fly auto-emits machine metrics, but app-level Prometheus scraping requires `[metrics] port=9091; path='/metrics'`. AcreOS has a Prom-style `/api/metrics` somewhere (saw monitoring/ dir) but Fly isn't configured to scrape it.

---

## 3. Migration discipline

The hand-rolled `scripts/migrate.mjs` (Dmitri called this out, correctly):

```js
const STATEMENTS = [
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS ...',
  'CREATE TABLE IF NOT EXISTS "agent_llm_traces" (...)',
  'INSERT INTO "platform_feature_flags" ... ON CONFLICT DO NOTHING',
];
```

### Verdict: **functional but fragile**

**What's right:**
- Every statement is `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — re-runs are no-ops. Good.
- Pool size capped at 2 connections — won't exhaust DB during release VM run.
- `process.exit(exitCode)` returns non-zero on failure — Fly will abort the deploy. Good.

**What's wrong:**

1. **No transaction.** Each statement runs in its own implicit txn. If statement 7 of 22 fails, statements 1–6 are committed and 8–22 are skipped. Deploy aborts mid-migration → next deploy reapplies 1–6 (idempotent so OK) but state is now half-applied. Wrap the loop in `BEGIN; ... COMMIT;` with `ROLLBACK` on any failure. Idempotent statements + transaction = safe.

2. **`exitCode = 1` but loop continues.** The `try/catch` inside the for-loop logs and continues. So if statement 5 fails, statements 6–22 still run, then exit 1 at the end. This is the worst of both worlds — partial application AND failed deploy. Either fail-fast (`break` on first error) or run in a transaction.

3. **No migration log table.** drizzle-kit tracks applied migrations in `__drizzle_migrations`. This script tracks nothing. There is no audit trail of "which release applied which schema patch." Add a `schema_patches` table and `INSERT ... ON CONFLICT DO NOTHING` after each successful statement.

4. **Drift back to drizzle-kit eventually.** The comment says "_journal.json is out of sync." That means somebody, sometime, applied SQL outside of drizzle. This is a tech-debt loan accruing interest every release. The right fix: one engineer spends a day reconciling `_journal.json` with prod schema, then the team commits to drizzle-kit-only migrations going forward. `migrate.mjs` becomes empty / removed.

5. **The release VM has no app code reachable from the runtime.** That's fine for SQL, but if you ever need a data-migration that calls AcreOS code (e.g., re-encrypt a column with `FIELD_ENCRYPTION_KEY`), you can't do it here. Build a separate `npm run migrate:data` that runs as a one-shot machine, not in release VM.

---

## 4. Autoscale + sizing

**Current:** 2x `performance-2x` (2 CPU, 4GB), iad only, `auto_start_machines = true`, `min = 2`, `auto_stop = off`.

### Sizing

`performance-2x` at $58/mo each = **$116/mo for compute alone**. Is it justified?

- **Memory:** `NODE_OPTIONS="--max-old-space-size=3584"` (3.5GB). With 4GB total, you have 512MB for Chromium, system, and overhead. Puppeteer launches Chromium (~250MB resident per instance). One concurrent screenshot job + a memory leak = OOM kill. Either bump to 8GB (`performance-4x`, +$58/mo) or move Puppeteer to a separate worker app.
- **CPU:** 2 dedicated cores is overkill for a Node app at <100 RPS. Could probably run on `shared-cpu-2x` (2 vCPU, 2GB, $4/mo each) with the caveat that shared CPU can be throttled by neighbors. For prod-quality SLA, keep performance-* but downsize to `performance-1x` (1 CPU, 2GB) and double machine count to 4 — better failure isolation.

### Autoscale

There is **no autoscale block** in fly.toml. With `min_machines_running = 2` and `auto_start_machines = true`, machines that Fly *previously stopped* can be auto-restarted on traffic, but with `auto_stop = off`, machines never stop, so this is a no-op. **AcreOS does not autoscale.**

To actually autoscale on concurrency:
```toml
[http_service]
  min_machines_running = 2
  max_machines_running = 6   # ← missing today
  auto_stop_machines = 'suspend'  # not 'off' — keeps RAM image, fast restart
```
Fly's autoscale is concurrency-driven (the `soft_limit` you already set). It doesn't scale on raw CPU% — that's a known limitation. If you need CPU-based scaling, you write a sidecar that calls `fly scale count` on a metric threshold. For AcreOS at current traffic, **concurrency-based scaling is fine**.

---

## 5. Secrets + log rotation

### Secrets posture

`fly-secrets.example` documents 30+ keys: `DATABASE_URL`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `CLERK_SECRET_KEY`, `AI_INTEGRATIONS_OPENROUTER_API_KEY`, etc.

**Issues:**

1. **No rotation calendar.** `FIELD_ENCRYPTION_KEY` is **AES-256, single value**. There is no `FIELD_ENCRYPTION_KEY_PREVIOUS` for envelope rotation. If this key leaks, every encrypted PII column needs to be re-encrypted in a single coordinated deploy. Add a `keyId`-prefixed scheme.
2. **`SESSION_SECRET` rotation = mass logout.** Fine, but should be documented in the runbook (it isn't, per Beata's audit).
3. **Stripe webhook signing secret** rotates every time you regenerate the webhook in Stripe dashboard — easy to forget on Fly side. Should have a `npm run check:secrets` that pings each provider with the current secret.
4. **`flyctl secrets set` triggers a redeploy.** Bulk rotation = single blast deploy. Use `flyctl secrets set --stage` for staged rotation, then `flyctl deploy` once at the end.
5. **No secrets vault audit log.** Fly does not log who set what when. For SOC2 path (Anouk's persona), pipe `flyctl secrets list --json` weekly to an audit log.

### Log aggregation

**Current:** Fly retains app logs ~24h then they vanish. Sentry captures errors only. Structured logs from `server/utils/logger.ts` go to stdout → Fly logs → /dev/null after a day.

**Missing:**
- **Log shipper.** Need `[log_shippers]` or a Vector/Fluentbit sidecar shipping to Logtail, Datadog, or BetterStack. At AcreOS volume, BetterStack (formerly Logtail) at $25/mo is the cheapest sane option.
- **Correlation ID ingestion.** `correlationIdMiddleware` exists (saw it in routes.ts:443). Verify the shipper indexes on it so request traces are queryable.
- **Audit log persistence.** Compliance-relevant events (auth, secrets read, billing) should write to a DB table, not just logs. Don't rely on log aggregation for audit.

---

## 6. Backup + DR

### Backups

Fly Postgres takes daily snapshots, retained 5 days on the standard tier. **AcreOS has done zero restore drills.** This is the most important gap in this audit.

A backup you haven't restored from is not a backup; it's a hope.

**Minimum viable restore drill (run quarterly):**
1. `flyctl postgres backup list -a acreos-db`
2. `flyctl postgres backup restore <id> --target acreos-db-restoretest`
3. Smoke: connect, count rows in `users`, `parcels`, `agent_llm_traces`, verify last `created_at` is within ~24h.
4. Tear down test cluster.
5. Document time-to-restore. (Realistic: 12–40 min for a multi-GB DB.)

### PITR (point-in-time recovery)

Fly Postgres standard does **not** include WAL archiving by default. Daily snapshots only. RPO = 24 hours. For a system with billing and user data, that's a lot. Either:
- Upgrade to Fly Postgres with WAL archiving (newer offering, may require migration to managed-postgres);
- Run logical replication to a backup DB (Supabase, Neon) on a 5-min lag.

### Region failover

`primary_region = 'iad'` and **only iad**. `flyctl regions list -a acreos` would show a single region. iad outage (and AWS us-east-1 outages happen yearly) = AcreOS down for as long as Fly takes to recover Ashburn.

**For real DR:**
- Add a passive replica region (`ord` or `dfw`).
- Fly Postgres requires explicit replica config: `flyctl postgres create --region ord --fork-from <primary>`.
- App machines in passive region need read-only mode until Postgres failover completes.
- This is a 2–3 day project, not a checkbox.

---

## 7. CI deploy speed

Dmitri said merge-to-live is 12–18 min. From the workflow:

1. **`test` job** — `npm ci` (~70s with cache), `npm run check` (~45s), `npx vitest run` (~3-5min, `continue-on-error: true` so doesn't block). **Total: ~5–7 min.**
2. **`deploy` job (sequential, `needs: test`)** — `npm ci` again (~70s, **redundant, no artifact reuse**), `npm run build` (~2–3 min), Sentry upload (~30s, may fail-soft), `flyctl deploy --remote-only --wait-timeout 300` (~3–6 min for image build remote + release VM + rolling restart), post-deploy curl (~10s).

### Bottlenecks

1. **`npm ci` runs twice.** Cache the `node_modules` and the build output between jobs (`actions/upload-artifact` + `download-artifact`). **Save: ~70s.**
2. **Remote builder is slow.** `--remote-only` ships the full source to Fly's builder. Image is rebuilt from scratch every deploy because Fly's remote builder Docker layer cache is per-builder-machine and gets evicted often. Either:
   - Use a self-hosted GitHub runner with persistent Docker layer cache;
   - Or `--local-only` and push to Fly's registry from CI (faster if your CI machine has Docker BuildKit cache).
3. **Vitest runs but `continue-on-error: true`.** This means tests are decorative. They consume 3–5 min and never block. Either fix the test fixtures (Dmitri's territory) or `if: false`-skip until they're worth running.
4. **No deploy-skip for docs-only changes.** Every push to main triggers a full Fly deploy, even if it's just a markdown edit in `docs/`. Add a `paths-ignore: ['docs/**', '*.md']` filter.

**Realistic target after fixes: 6–8 min merge-to-live.**

---

## 8. Cost estimate

| Line item | Spec | $/mo |
|---|---|---|
| Compute: 2× performance-2x | 2 CPU / 4GB each, 24/7 | $116 |
| Fly Postgres (assume `dev` size, 1GB RAM, 10GB disk) | minimal HA | $30 |
| Fly Postgres backups | included | — |
| Outbound bandwidth | ~50GB at $0.02/GB after free tier | $1 |
| Anycast IPs (1 dedicated v4 + v6) | included | — |
| Image storage / registry | ~2GB | $0.30 |
| **Total Fly bill** | | **~$148/mo** |

If you upgrade DB to HA cluster (`flyctl postgres create --high-availability`): **+$60/mo** = $208/mo total.
If you add a passive replica region: **+$116 compute + $30 DB = $354/mo total** for proper DR.

For a SaaS with billing + PII + a SOC2 ambition, $354/mo is **dirt cheap** for the SLA you're claiming. Don't optimize cost here. Optimize survivability.

---

## 9. The 1-week Fly hardening sprint

**Day 1 — observability & safety nets**
- Add `/api/health/live` endpoint (process-only, no DB).
- Split fly.toml into liveness vs readiness checks; bump `grace_period` to 30s.
- Wire BetterStack log shipper. ($25/mo.)
- Add `[metrics]` block; verify Prometheus scrape works.

**Day 2 — migration discipline**
- Wrap `migrate.mjs` STATEMENTS loop in `BEGIN; ... COMMIT;` with rollback.
- Fail-fast on first error.
- Add `schema_patches` audit table.
- File the drizzle-kit reconciliation ticket (P1, owned by Dmitri).

**Day 3 — backup drill**
- Run a real restore from yesterday's snapshot into `acreos-db-restoretest`.
- Document the time and any surprises.
- Schedule quarterly recurrence (calendar invite, not a TODO).

**Day 4 — secrets hygiene**
- Audit current `flyctl secrets list` against `fly-secrets.example` — find drift.
- Add `npm run check:secrets` that pings Stripe/Clerk/OpenRouter with current keys.
- Implement key-id prefix scheme on `FIELD_ENCRYPTION_KEY` (`v1:...`) so future rotation is non-breaking.
- Document rotation runbook in `docs/ops/secrets-rotation.md`.

**Day 5 — CI speed**
- Cache `node_modules` + `dist` between test and deploy jobs.
- Add `paths-ignore` for docs-only changes.
- Fix or skip vitest fixtures (decide: enforce or remove).

**Stretch (week 2)** — DR
- Provision passive Postgres replica in `ord`.
- Add a failover runbook with a tested `flyctl postgres failover` step.
- Run a region-down game day.

---

## Severity-ranked findings

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Zero restore drills, ever | **P0** | 2h |
| 2 | Single region (iad) — no DR | **P0** | 2-3 days |
| 3 | `migrate.mjs` no transaction, partial-apply on failure | **P1** | 1h |
| 4 | Single health check doing liveness + readiness | **P1** | 2h |
| 5 | Logs evaporate after 24h | **P1** | 3h |
| 6 | `grace_period=15s` too short for cold start | **P2** | 5min |
| 7 | No autoscale ceiling (`max_machines_running` unset) | **P2** | 5min |
| 8 | `FIELD_ENCRYPTION_KEY` has no rotation scheme | **P2** | 1 day |
| 9 | CI runs `npm ci` twice; no docs-skip | **P3** | 30min |
| 10 | Vitest runs in CI but never blocks | **P3** | hand to Dmitri |

---

**— Bjorn**
*"Two warm machines in iad is a homepage, not a system. Fix the restore drill before anything else."*
