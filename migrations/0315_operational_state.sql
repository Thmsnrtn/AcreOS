-- 0315 — P12-1c slice 1c-1: the `operational_state` table — the shared
-- key-value destination for the five direct-table subsystems that today
-- keep operational state (NOT founder settings) in `founder_settings`:
-- the autopilot gate watcher, the decisions-inbox throttle, the LQ22
-- tripwire, and the two channel-override grammars (Atlas founder-chat
-- tools + founder inspector finance routes). Design record:
-- seat2-q8v5-p12-1c-design-2026-11.md §6; Step-0:
-- seat2-q8v5-p12-1c-1-step0-2026-11.md §6.
--
-- This migration creates the table and COPIES the live rows for the
-- gate_watcher / inbox_throttle / lq22_tripwire / channel_overrides
-- namespaces out of `founder_settings`, non-destructively: nothing is
-- deleted from `founder_settings`, and nothing reads `operational_state`
-- yet. Readers and writers switch in slices 1c-2…1c-5, so this slice is
-- additive with zero behaviour change. Dial / org_override rows are NOT
-- copied (their disposition is founder flag F2, design §8).
--
-- All additive + idempotent; no existing table is altered. Mirrored
-- statement for statement in scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS "operational_state" (
  "id" serial PRIMARY KEY,
  "namespace" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "value_type" text NOT NULL DEFAULT 'string',
  "description" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" text,
  CONSTRAINT "operational_state_namespace_key_unique" UNIQUE ("namespace", "key")
);

CREATE INDEX IF NOT EXISTS "operational_state_key_idx" ON "operational_state" ("key");

INSERT INTO "operational_state" ("namespace", "key", "value", "value_type", "description", "updated_at", "updated_by")
SELECT
  CASE
    WHEN "key" LIKE 'gate_watcher.state.%' THEN 'gate_watcher'
    WHEN "key" LIKE 'inbox_throttle.%' THEN 'inbox_throttle'
    WHEN "key" LIKE 'lq22_tripwire.%' THEN 'lq22_tripwire'
    WHEN "key" LIKE 'channel.pause.%' THEN 'channel_overrides'
    WHEN "key" LIKE 'channel.throttle.%' THEN 'channel_overrides'
    WHEN "key" LIKE 'founder.org_%.channel_pause.%' THEN 'channel_overrides'
    WHEN "key" LIKE 'founder.org_%.channel_throttle.%' THEN 'channel_overrides'
  END,
  "key",
  "value",
  "value_type",
  "description",
  "updated_at",
  "updated_by"
FROM "founder_settings"
WHERE "key" LIKE 'gate_watcher.state.%'
   OR "key" LIKE 'inbox_throttle.%'
   OR "key" LIKE 'lq22_tripwire.%'
   OR "key" LIKE 'channel.pause.%'
   OR "key" LIKE 'channel.throttle.%'
   OR "key" LIKE 'founder.org_%.channel_pause.%'
   OR "key" LIKE 'founder.org_%.channel_throttle.%'
ON CONFLICT ("namespace", "key") DO NOTHING;
