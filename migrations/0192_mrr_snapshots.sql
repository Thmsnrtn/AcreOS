-- 0192 — Weekly MRR snapshots (roadmap W4.5, 2026-07 audit).
-- WoW MRR growth was structurally 0 (no history existed), which made the
-- runway "upside" scenario identical to base since launch. The
-- mrr_snapshot_weekly job writes one row per week; runwayModel reads the
-- most recent row older than 6 days as the prior-week baseline.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "mrr_snapshots" (
  "id" serial PRIMARY KEY,
  "captured_at" timestamp NOT NULL DEFAULT now(),
  "mrr_cents" integer NOT NULL,
  "paying_orgs" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "mrr_snapshots_captured_idx" ON "mrr_snapshots" ("captured_at");
