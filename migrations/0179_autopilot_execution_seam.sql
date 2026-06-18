-- 0179 — Autopilot execution seam (Elite Vision H1).
-- The founder-scoped witnessed-send surface for autopilot hands: a dispatched
-- agent's drafted customer-facing action is FROZEN here (hand + args + content
-- hash + 24h expiry) instead of sending; the founder approves it in /decisions,
-- approval re-verifies the hash and fires executeHandWitnessed exactly once.
-- Plus the append-only autopilot_sends audit. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "autopilot_pending_actions" (
  "id" serial PRIMARY KEY,
  "hand_name" text NOT NULL,
  "args" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "domain" text,
  "summary" text,
  "source_dispatch_id" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamp,
  "approved_by" text,
  "executed_at" timestamp,
  "result_summary" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "autopilot_pending_actions_status_idx"
  ON "autopilot_pending_actions" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "autopilot_pending_actions_dedup_idx"
  ON "autopilot_pending_actions" ("hand_name", "content_hash", "status");

CREATE TABLE IF NOT EXISTS "autopilot_sends" (
  "id" serial PRIMARY KEY,
  "pending_action_id" integer,
  "hand_name" text NOT NULL,
  "domain" text,
  "approved_by" text,
  "content_hash" text,
  "sent_at" timestamp DEFAULT now()
);
