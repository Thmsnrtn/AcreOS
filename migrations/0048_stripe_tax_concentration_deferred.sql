-- Phase 3 Week 10 — Stripe Tax automation, customer concentration alerting,
-- deferred-revenue tracking. Pairs with the SDK apiVersion pin (no SQL change),
-- the dunning SMS leg, and the daily concentration job.
--
-- Three additions:
--   1. customer_concentration — historical snapshots of MRR concentration so
--      the founder can spot single-customer or top-3 risk over time.
--   2. deferred_revenue — period-by-period accrual rows so the recognition
--      worker (Week 10+) has a table to write into. The worker is not in
--      scope here; this migration only ships the table.
--   3. dunning_events.sms_sent_at — flag-and-timestamp column so the SMS
--      throttle can guarantee at most one SMS per dunning sequence without
--      re-scanning the JSONB notifications_sent column.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. customer_concentration
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_concentration" (
  "id"                    SERIAL PRIMARY KEY,
  "computed_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "top_mrr_pct_single"    NUMERIC(5,2) NOT NULL DEFAULT 0,  -- top customer / total MRR (0-100)
  "top_mrr_pct_top3"      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- top 3 customers / total MRR (0-100)
  "total_mrr_cents"       BIGINT NOT NULL DEFAULT 0,
  "active_org_count"      INTEGER NOT NULL DEFAULT 0,
  "snapshot"              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- top-N orgs with id/name/mrrCents
  "alert_triggered"       BOOLEAN NOT NULL DEFAULT FALSE,
  "alert_severity"        TEXT,  -- null | 'warning' | 'critical'
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_customer_concentration_computed_at"
  ON "customer_concentration" ("computed_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_customer_concentration_alert"
  ON "customer_concentration" ("alert_triggered", "computed_at" DESC)
  WHERE "alert_triggered" = TRUE;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. deferred_revenue
-- ───────────────────────────────────────────────────────────────────────────
-- One row per (organization, subscription invoice period). The recognition
-- worker (out of scope this migration) will increment recognized_cents
-- as time passes within [period_start, period_end]; once recognized_cents
-- equals amount_cents the row is fully recognised. as_of_date marks the
-- point-in-time of the latest recognition pass for the row.
CREATE TABLE IF NOT EXISTS "deferred_revenue" (
  "id"                  SERIAL PRIMARY KEY,
  "organization_id"     INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "subscription_id"     TEXT,           -- Stripe subscription ID (sub_xxx); null for one-time invoices
  "invoice_id"          TEXT,           -- Stripe invoice ID (in_xxx); useful for recon
  "period_start"        TIMESTAMPTZ NOT NULL,
  "period_end"          TIMESTAMPTZ NOT NULL,
  "amount_cents"        BIGINT NOT NULL,
  "recognized_cents"    BIGINT NOT NULL DEFAULT 0,
  "as_of_date"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "currency"            TEXT NOT NULL DEFAULT 'usd',
  "metadata"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "deferred_revenue_period_chk" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "deferred_revenue_recognized_chk" CHECK ("recognized_cents" >= 0 AND "recognized_cents" <= "amount_cents")
);

CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_org"
  ON "deferred_revenue" ("organization_id", "period_start" DESC);

CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_subscription"
  ON "deferred_revenue" ("subscription_id")
  WHERE "subscription_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_unrecognized"
  ON "deferred_revenue" ("period_end")
  WHERE "recognized_cents" < "amount_cents";

-- ───────────────────────────────────────────────────────────────────────────
-- 3. dunning_events.sms_sent_at — fast lookup for the SMS-throttle guard.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "dunning_events"
  ADD COLUMN IF NOT EXISTS "sms_sent_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_dunning_events_sms_sent"
  ON "dunning_events" ("organization_id", "sms_sent_at")
  WHERE "sms_sent_at" IS NOT NULL;
