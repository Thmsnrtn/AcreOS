-- 0139 — Tess — worker liveness heartbeat (single-row).
--
-- The worker process (server/worker.ts) runs every scheduled job AND
-- originates every alert (autonomousHealthMonitor, dataSourceProbe, the
-- burn-rate monitor). If it dies we lose background processing *and* the
-- ability to tell anyone we lost it. This single-row table is the worker's
-- pulse: the outbox poll loop bumps updated_at every cycle, and an EXTERNAL
-- eye reads GET /api/health/worker-heartbeat (auth-free, like /api/healthz)
-- to detect "alerting itself is down."
--
-- Single row pinned to id=1; server/worker.ts UPSERTs (ON CONFLICT (id)) so it
-- can never grow beyond one row. Mirrors shared/schema.ts workerHeartbeat +
-- scripts/migrate.mjs.
CREATE TABLE IF NOT EXISTS "worker_heartbeat" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "instance_id" text,
  "git_sha" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed the singleton row so the first read returns a (stale) row rather than
-- null — an external probe treats "no row" and "very old row" the same, but
-- seeding keeps the UPSERT path simple and the freshness query total.
INSERT INTO "worker_heartbeat" ("id", "updated_at")
VALUES (1, now())
ON CONFLICT ("id") DO NOTHING;
