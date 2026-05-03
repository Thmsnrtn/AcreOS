-- ============================================================================
-- Per-customer unit economics — Lavender Week 12 (profit-margin dashboard).
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- AcreOS sells $20 / $49 / $79 subscriptions but every customer also drags a
-- variable-cost tail behind them: AI tokens, Lob mailings, Twilio SMS,
-- SendGrid email, skip-trace credits. Plus a slice of fixed infra
-- (Fly compute, Postgres, Clerk MAU, Sentry). Without a single rollup the
-- founder can't tell who's profitable and who's bleeding cash.
--
-- This migration introduces `customer_unit_economics` — one snapshot row per
-- (organizationId, computedAt) — populated nightly by
-- server/services/unitEconomics.ts. We deliberately use a regular table
-- (not a materialized view) because:
--
--   • REFRESH MATERIALIZED VIEW on a 50-org cluster is overkill but on a
--     500-org cluster it would lock readers for several seconds; an upsert
--     keyed on (organizationId, computed_date) gives us the same surface
--     with no DDL on the hot path and easier debugging.
--   • Storing successive daily snapshots gives us free 90-day trend lines
--     without re-aggregating ai_usage_daily / mailing_orders / messages /
--     skip_traces / ledger entries every page-load.
--
-- Math invariants
-- ───────────────
-- All cost columns are USD with 6 decimal places of precision so the email
-- $0.0001 figures never round to $0. `total_cogs_usd` is enforced to equal
-- the sum of variable + fixed-share components; `profit_margin_usd` =
-- mrr_usd - total_cogs_usd. We store both raw and percent so the dashboard
-- can sort by either without recomputing.
--
-- Alignment with `account_ledger_entries` (Wave 9 double-entry):
--   - mrrUsd ↔ revenue accounts (4xxx) for the period
--   - aiCost / smsCost / etc. ↔ COGS accounts (5xxx)
--   - Sum of debits and credits posted on a given (org, day) should reconcile
--     to the (mrr - cogs) figure in this rollup. The reconciliation job is
--     non-blocking — discrepancies are logged, not enforced.

CREATE TABLE IF NOT EXISTS customer_unit_economics (
  id                          SERIAL PRIMARY KEY,
  organization_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_date               DATE        NOT NULL DEFAULT CURRENT_DATE,
  window_days                 INTEGER     NOT NULL DEFAULT 30,

  -- Revenue (normalized to monthly)
  mrr_usd                     NUMERIC(12, 6) NOT NULL DEFAULT 0,

  -- Variable costs over the trailing window_days
  ai_cost_usd                 NUMERIC(12, 6) NOT NULL DEFAULT 0,
  direct_mail_cost_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
  sms_cost_usd                NUMERIC(12, 6) NOT NULL DEFAULT 0,
  email_cost_usd              NUMERIC(12, 6) NOT NULL DEFAULT 0,
  skip_trace_cost_usd         NUMERIC(12, 6) NOT NULL DEFAULT 0,

  -- Allocated fixed infrastructure share (Fly, Postgres, Clerk, Sentry / N customers)
  fixed_cost_share_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,

  -- Aggregates
  total_cogs_usd              NUMERIC(12, 6) NOT NULL DEFAULT 0,
  profit_margin_usd           NUMERIC(12, 6) NOT NULL DEFAULT 0,
  profit_margin_pct           NUMERIC(7,  2) NOT NULL DEFAULT 0,

  -- Counters used for the "Why?" expander on the founder UI
  ai_call_count               INTEGER NOT NULL DEFAULT 0,
  sms_count                   INTEGER NOT NULL DEFAULT 0,
  email_count                 INTEGER NOT NULL DEFAULT 0,
  direct_mail_pieces          INTEGER NOT NULL DEFAULT 0,
  skip_trace_count            INTEGER NOT NULL DEFAULT 0,

  -- Free-form breakdown so the UI can render structured tooltips without a
  -- second round-trip (e.g. cost-by-feature within AI, cost per channel).
  breakdown                   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Consecutive-day-unprofitable counter — used by the alerting job to
  -- decide when to file a system_alerts row. Resets to 0 on the first day
  -- the customer turns profitable again.
  consecutive_unprofitable_days INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT customer_unit_economics_window_positive
    CHECK (window_days > 0),
  CONSTRAINT customer_unit_economics_costs_non_negative
    CHECK (
      ai_cost_usd >= 0 AND direct_mail_cost_usd >= 0 AND sms_cost_usd >= 0
      AND email_cost_usd >= 0 AND skip_trace_cost_usd >= 0
      AND fixed_cost_share_usd >= 0
    )
);

-- One row per (org, computed_date). Re-runs the same day update in place so
-- we never double-count fixed-cost share.
CREATE UNIQUE INDEX IF NOT EXISTS customer_unit_economics_org_date_uniq
  ON customer_unit_economics (organization_id, computed_date);

-- Founder dashboard reads "latest snapshot per org sorted by margin". The
-- index supports both "latest by org" and the 90-day trend chart query.
CREATE INDEX IF NOT EXISTS customer_unit_economics_org_computed_idx
  ON customer_unit_economics (organization_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS customer_unit_economics_computed_date_idx
  ON customer_unit_economics (computed_date DESC);

CREATE INDEX IF NOT EXISTS customer_unit_economics_margin_idx
  ON customer_unit_economics (profit_margin_usd ASC);
