-- ============================================================================
-- 0231 — R-3: collection-sequence ARMING + named crisis pre-authorisation
--        (founder ruling 2026-08-11 — consumer-contact behaviour)
-- ----------------------------------------------------------------------------
-- COLUMNS + DEFAULTS ONLY on two existing tables. No data is destroyed and no
-- running collection is stopped.
--
-- ── 1) collection_sequences: auto_start DEFAULT true → false ────────────────
-- A `collection_sequences` row is a debt-collection ladder an AcreOS CUSTOMER
-- runs against a CONSUMER (a borrower late on a seller-financed note). Its
-- `auto_start` column defaulted to TRUE, so contact with a real person could
-- begin because a schema default said yes — not because a customer chose it.
--
-- ⚠️ WHAT HAPPENS TO ROWS CREATED UNDER THE OLD DEFAULT — read this before
--    "fixing" the apparent omission below:
--
--    ALTER COLUMN ... SET DEFAULT changes only what FUTURE inserts get. It does
--    NOT rewrite existing rows, and THIS MIGRATION DELIBERATELY DOES NOT
--    BACKFILL THEM. There is intentionally no
--        UPDATE collection_sequences SET auto_start = false ...
--    statement anywhere in this file. Adding one would disarm live collections
--    wholesale, cutting a consumer off mid-ladder — which the founder
--    explicitly ruled against.
--
--    So a pre-2026-08-11 row keeps auto_start = true and gets armed_at = NULL
--    (the new column is NULL for every existing row). That pair is the state
--    `armed_unconfirmed` in shared/collections/arming.ts:
--      • it KEEPS DISPATCHING          → no live collection is severed, and
--      • it SURFACES FOR CONFIRMATION  → Finance → Collections lists it until a
--                                        human confirms the exact ladder.
--    Neither silent grandfathering nor wholesale disarming. That is the whole
--    point of the confirm surface.
--
-- armed_ladder_digest pins the confirmation to the ladder that was on screen:
-- edit the steps afterwards and the sequence returns to the confirm surface.
--
-- ── 2) pre_authorized_tradeoffs: auto_execute DEFAULT true → false ──────────
-- Founder-side crisis handling. Unattended execution is defensible (a 3am
-- outage should not wait for a human) but must be a NAMED grant rather than an
-- implicit default. auto_execute defaults to false and is only honoured when
-- pre_authorized_by names who granted it. Existing rows are likewise NOT
-- backfilled to false; they are instead left for the engine to refuse until
-- named, which is visible rather than silent.
--
-- This table had no CREATE TABLE anywhere (it was in the schema↔migration
-- orphan baseline), so it is created here before being altered; both baseline
-- lists shrink by one in the same commit.
--
-- MONEY POSTURE: nothing here moves money. A dunning contact tells a consumer
-- money is owed on the CUSTOMER'S own rails; AcreOS is not a party to the debt.
-- ============================================================================

-- ── 1) collection-sequence arming ───────────────────────────────────────────
ALTER TABLE "collection_sequences" ALTER COLUMN "auto_start" SET DEFAULT false;
ALTER TABLE "collection_sequences" ADD COLUMN IF NOT EXISTS "armed_at" timestamp;
ALTER TABLE "collection_sequences" ADD COLUMN IF NOT EXISTS "armed_by" text;
ALTER TABLE "collection_sequences" ADD COLUMN IF NOT EXISTS "armed_ladder_digest" text;

-- Finds the confirm-surface population (armed, but nobody on record).
CREATE INDEX IF NOT EXISTS "collection_sequences_org_arming_idx"
  ON "collection_sequences" ("organization_id", "auto_start", "armed_at");

-- ── 2) named crisis pre-authorisation ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pre_authorized_tradeoffs" (
  "id" serial PRIMARY KEY,
  "tradeoff_id" text NOT NULL UNIQUE,
  "condition" text NOT NULL,
  "action" text NOT NULL,
  "severity" text NOT NULL,
  "auto_execute" boolean NOT NULL DEFAULT false,
  "pre_authorized_by" text,
  "pre_authorized_at" timestamp,
  "pre_authorization_note" text,
  "execution_count" integer NOT NULL DEFAULT 0,
  "last_executed_at" timestamp,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "pre_authorized_tradeoffs" ALTER COLUMN "auto_execute" SET DEFAULT false;
ALTER TABLE "pre_authorized_tradeoffs" ADD COLUMN IF NOT EXISTS "pre_authorized_by" text;
ALTER TABLE "pre_authorized_tradeoffs" ADD COLUMN IF NOT EXISTS "pre_authorized_at" timestamp;
ALTER TABLE "pre_authorized_tradeoffs" ADD COLUMN IF NOT EXISTS "pre_authorization_note" text;
