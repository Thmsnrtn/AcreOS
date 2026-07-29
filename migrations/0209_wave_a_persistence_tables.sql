-- ============================================================================
-- 0209 — Wave A "Nothing lies" persistence tables (founder ruling #12(c))
-- ----------------------------------------------------------------------------
-- Three shipped features ran entirely on module-level Maps/arrays: their state
-- was per-process, split across machines, and vanished on every restart or
-- deploy. The UI presented that state as if it were durable — which is the
-- lie. This migration gives each of them real storage.
--
--   market_watchlist_entries / market_watchlist_alerts
--       T117 market watchlist (server/services/marketWatchlist.ts). The alert
--       serial PK replaces the per-process `nextAlertId` counter that collided
--       across machines.
--
--   outreach_ab_tests / outreach_ab_outcomes
--       T22 outreach A/B engine (server/services/abTestEngine.ts). One row per
--       outcome EVENT so significance is aggregated in SQL over every
--       machine's data, not one process's slice. Deliberately separate from
--       the existing ab_tests / ab_test_variants campaign split-testing tables
--       (different keys, different shape, different feature).
--
--   investor_verification_requests
--       KYC request state machine (server/services/investorVerification.ts),
--       ported in the same wave. Its table landed in
--       shared/schema/compliance.ts without a migration — included here so the
--       Drizzle reads in that service do not 500 on deploy.
--
-- Tracked in docs/company/deletion-ledger.md "Module-state residue"
-- (audit 2026-07-07). Mirrors shared/schema/market-watchlist.ts,
-- shared/schema/outreach-ab.ts, shared/schema/compliance.ts +
-- scripts/migrate.mjs. Additive + idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

-- ─── T117 market watchlist ──────────────────────────────────────────────────

-- Text PK keeps the service's historical natural key
-- (`${orgId}:${state}:${county}` lowercased) so client-held entry ids and the
-- add-is-upsert semantics survive the port unchanged.
CREATE TABLE IF NOT EXISTS "market_watchlist_entries" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "alert_on_tax_delinquent" boolean NOT NULL DEFAULT true,
  "alert_on_price_drop" boolean NOT NULL DEFAULT true,
  "price_drop_threshold_pct" integer NOT NULL DEFAULT 10,
  "alert_on_demand_increase" boolean NOT NULL DEFAULT true,
  "demand_score_threshold" integer NOT NULL DEFAULT 70,
  "alert_on_foreclosure" boolean NOT NULL DEFAULT true,
  "email_alert" boolean NOT NULL DEFAULT true,
  "push_alert" boolean NOT NULL DEFAULT true,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_alert_at" timestamp
);

CREATE INDEX IF NOT EXISTS "market_watchlist_entries_org_created_idx"
  ON "market_watchlist_entries" ("organization_id", "created_at");

-- organization_id is denormalized from the entry so org-scoped reads
-- (list / unread count / mark-read) are a single probe.
CREATE TABLE IF NOT EXISTS "market_watchlist_alerts" (
  "id" serial PRIMARY KEY,
  "entry_id" text NOT NULL REFERENCES "market_watchlist_entries" ("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "severity" text NOT NULL,
  "data" jsonb,
  "read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "market_watchlist_alerts_org_created_idx"
  ON "market_watchlist_alerts" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "market_watchlist_alerts_org_read_idx"
  ON "market_watchlist_alerts" ("organization_id", "read");
CREATE INDEX IF NOT EXISTS "market_watchlist_alerts_entry_idx"
  ON "market_watchlist_alerts" ("entry_id");

-- ─── T22 outreach A/B engine ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "outreach_ab_tests" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "name" text NOT NULL,
  "variants" jsonb NOT NULL,
  "metric" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "winner_id" text,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "ended_at" timestamp
);

CREATE INDEX IF NOT EXISTS "outreach_ab_tests_org_status_idx"
  ON "outreach_ab_tests" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "outreach_ab_outcomes" (
  "id" serial PRIMARY KEY,
  "test_id" text NOT NULL REFERENCES "outreach_ab_tests" ("id") ON DELETE CASCADE,
  "variant_id" text NOT NULL,
  "lead_id" integer NOT NULL,
  "event" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outreach_ab_outcomes_test_variant_event_idx"
  ON "outreach_ab_outcomes" ("test_id", "variant_id", "event");

-- ─── KYC verification requests ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "investor_verification_requests" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "investor_profile_id" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "documents" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "submitted_at" timestamp,
  "reviewed_at" timestamp,
  "reviewed_by" integer,
  "decision" text,
  "reason" text,
  "accreditation_data" jsonb,
  "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "investor_ver_requests_org_status_idx"
  ON "investor_verification_requests" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "investor_ver_requests_profile_created_idx"
  ON "investor_verification_requests" ("investor_profile_id", "created_at");
