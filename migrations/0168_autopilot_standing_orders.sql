-- 0168 — Founder Autopilot: standing orders + intents ("Your Voice").
-- Durable natural-language policy the founder issues; the autopilot honors
-- active orders in every outward action. Global (founder-level). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_standing_orders" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL DEFAULT 'standing_order',
  "body" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
