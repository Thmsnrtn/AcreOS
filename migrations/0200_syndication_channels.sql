-- ============================================================================
-- 0200 — Syndication channel states (founder decision D7, 2026-07-13)
-- ----------------------------------------------------------------------------
-- The /syndication customer page (listing-syndication.tsx) has always called
-- /api/syndication/status, sync-all, and PATCH channels/:id — endpoints that
-- never existed. This table stores the per-org half of the channel model:
-- enabled state + last-sync bookkeeping. The channel catalog (names, env
-- keys, API availability) stays in code (listingSyndication.PLATFORMS).
-- Composite unique index leads with organization_id (org-leading-index gate).
-- Mirrors shared/schema.ts (syndicationChannelStates) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "syndication_channel_states" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "last_sync_at" timestamp,
  "last_sync_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "syndication_channel_states_org_channel_idx"
  ON "syndication_channel_states" ("organization_id", "channel_id");
