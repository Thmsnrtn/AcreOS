-- 0181 — Growth targets (county-targeted owned-content selection).
-- The autonomous SEO engine writes ONE genuinely-useful county/topic guide per
-- day (publish-capped, budget-bound). This table is the queue of WHICH county to
-- write next: seeded from the founder's buy-box counties at ignition, and later
-- demand-ranked from real parcel-check volume. The daily grow loop drains the
-- highest-priority pending target instead of blind play rotation — the #1
-- leverage change every acquisition panel named. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "growth_targets" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,                      -- 2-letter, uppercased
  "county_slug" text NOT NULL,                -- lowercase slug
  "county_label" text NOT NULL,               -- human label
  "source" text NOT NULL DEFAULT 'seed',      -- seed | demand
  "demand_score" double precision NOT NULL DEFAULT 0,  -- real parcel-check volume (filled later)
  "status" text NOT NULL DEFAULT 'pending',   -- pending | dispatched
  "dispatched_at" timestamp,
  "last_dispatch_id" integer,
  "created_at" timestamp DEFAULT now()
);

-- One row per (state, county) — re-seeding is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "growth_targets_state_county_idx"
  ON "growth_targets" ("state", "county_slug");
-- Selection scans pending by priority.
CREATE INDEX IF NOT EXISTS "growth_targets_status_score_idx"
  ON "growth_targets" ("status", "demand_score");
