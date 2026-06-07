-- 0125 — Iris + Iyari — demand-driven county-GIS coverage growth.
--
-- The binary gap: ~34 counties seeded → a parcel outside them returns nothing
-- ("premium vs broken"). This migration adds the substrate to close that gap
-- for $0, along real customer demand:
--
--   1. county_discovery_queue (GLOBAL, no org) — when a parcel lookup misses
--      for an unseeded county we enqueue (state, county) here, bumping
--      demand_count on every repeat miss/request. A worker job drains it in
--      demand+priority order: runs ArcGIS discovery, probes a candidate
--      /query endpoint for an APN-shaped field, auto-populates field mappings,
--      inserts the county_gis_endpoints row as is_active=false +
--      redistributable='review-required' (Beatrice rule — un-reviewed counties
--      are live-passthrough only, never auto-marked fully redistributable),
--      and flips is_active=true only after the endpoint returns a real feature
--      for a test APN.
--
--   2. county_coverage_requests (ORG-scoped) — the per-org ledger behind the
--      customer-facing "request this county" CTA. Lets us prioritise discovery
--      against real demand and notify the org when their county comes online.
--
-- All idempotent.

-- 1. Global discovery work queue
CREATE TABLE IF NOT EXISTS "county_discovery_queue" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "demand_count" integer NOT NULL DEFAULT 1,
  "priority" integer NOT NULL DEFAULT 0,
  "first_requested_by" integer REFERENCES "organizations" ("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "last_attempt_at" timestamp,
  "last_result" text,
  "resolved_endpoint_id" integer REFERENCES "county_gis_endpoints" ("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "county_discovery_queue_state_county_uidx"
  ON "county_discovery_queue" ("state", "county");
CREATE INDEX IF NOT EXISTS "county_discovery_queue_drain_idx"
  ON "county_discovery_queue" ("status", "priority", "demand_count");

-- 2. Per-org coverage request ledger
CREATE TABLE IF NOT EXISTS "county_coverage_requests" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "requested_by_user_id" text,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "queue_id" integer REFERENCES "county_discovery_queue" ("id"),
  "notified_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "county_coverage_requests_org_created_idx"
  ON "county_coverage_requests" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "county_coverage_requests_org_state_county_idx"
  ON "county_coverage_requests" ("organization_id", "state", "county");
