-- ============================================================================
-- 0208 — open_data_change_events (Temporal Spine core, ruling #9 wave 3)
-- ----------------------------------------------------------------------------
-- Open data becomes EVENTS (docs/company/founder-decisions-2026-07-28.md):
-- when a refreshed lookup materially differs from what we previously knew for
-- the same place, that change is itself intelligence ("FEMA redrew the map
-- under this parcel") and is durably recorded here.
--
-- Scope contract: scope_type "point" → scope_ref "lat,lng" rounded to 4
-- decimal places; scope_type "county" → scope_ref "ST/countyslug".
-- previous_value/new_value are always REAL previously-observed values —
-- null→value (first sight) and value→null (lookup gap) are never recorded.
-- narrative is one plain-words sentence built only from the two real values.
-- Diff/materiality rules: server/services/openData/changeDetection.ts.
-- Mirrors shared/schema.ts (openDataChangeEvents) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "open_data_change_events" (
  "id" serial PRIMARY KEY,
  "category" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_ref" text NOT NULL,
  "field" text NOT NULL,
  "previous_value" text NOT NULL,
  "new_value" text NOT NULL,
  "previous_as_of" timestamp,
  "detected_at" timestamp NOT NULL DEFAULT now(),
  "source" text NOT NULL,
  "severity" text NOT NULL,
  "narrative" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_odce_scope_detected"
  ON "open_data_change_events" ("scope_type", "scope_ref", "detected_at");
