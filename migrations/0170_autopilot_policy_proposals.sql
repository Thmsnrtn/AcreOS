-- 0170 — Founder Autopilot: policy-induction proposals. Global. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_policy_proposals" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "play_id" text NOT NULL,
  "domain" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "ask_id" integer,
  "created_at" timestamp DEFAULT now(),
  "resolved_at" timestamp
);
CREATE INDEX IF NOT EXISTS "autopilot_policy_proposals_play_kind_idx" ON "autopilot_policy_proposals" ("play_id", "kind");
CREATE INDEX IF NOT EXISTS "autopilot_policy_proposals_ask_idx" ON "autopilot_policy_proposals" ("ask_id");
