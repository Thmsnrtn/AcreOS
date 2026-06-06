-- 0115_marketing_touch.sql
-- Marketing-touch acquisition event substrate (Soren, 2026-06-06).
--
-- Companion: docs/internal/marketing-os/03-analytics.md §4.
-- Drizzle:   shared/schema.ts  (export const marketingTouch)
-- Release:   scripts/migrate.mjs (mirrored idempotent statements)
--
-- The canonical, owned record of every pre-signup marketing/lifecycle
-- touchpoint. Keyed by a 1st-party `anonymous_id` cookie so the pre-signup
-- chain survives the auth handshake (fixes the UTM-loss-at-auth bug). On
-- signup the server JOINs anonymous_id -> user_id / organization_id so the
-- touch chain is preserved.
--
-- Privacy locks (per feedback_rate_limit_ip_keying + spec §4 notes):
--   * NO raw IP stored. Country-level geo only (ip_country).
--   * User-agent HASHED, not raw (user_agent_hash) — cohort grouping only.

CREATE TABLE IF NOT EXISTS "marketing_touch" (
  "id"                bigserial PRIMARY KEY,
  "anonymous_id"      text NOT NULL,
  "occurred_at"       timestamptz NOT NULL DEFAULT now(),
  "surface"           text NOT NULL,
  "event_type"        text NOT NULL DEFAULT 'page_view',
  "source_artifact_id" text,
  "utm_source"        text,
  "utm_medium"        text,
  "utm_campaign"      text,
  "utm_term"          text,
  "utm_content"       text,
  "referrer"          text,
  "landing_path"      text NOT NULL,
  "device_type"       text,
  "user_agent_hash"   text,
  "ip_country"        text,
  "payload"           jsonb,
  "user_id"           text,
  "organization_id"   integer
);

-- Hot path: pre-signup chain reconstruction for a single anon visitor.
CREATE INDEX IF NOT EXISTS "marketing_touch_anon_occurred_idx"
  ON "marketing_touch" ("anonymous_id", "occurred_at");

-- Surface-level rollups (touches per artifact / surface over time).
CREATE INDEX IF NOT EXISTS "marketing_touch_surface_occurred_idx"
  ON "marketing_touch" ("surface", "occurred_at");

-- Leading-org composite — post-signup attribution rollup per tenant.
-- Satisfies scripts/check-org-leading-index.mjs.
CREATE INDEX IF NOT EXISTS "marketing_touch_org_occurred_idx"
  ON "marketing_touch" ("organization_id", "occurred_at");
