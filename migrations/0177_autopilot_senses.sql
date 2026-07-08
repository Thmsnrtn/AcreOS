-- 0177 — Autopilot outward perception bus (Hands roadmap P0.2).
-- Append-only ledger of senses derived from the OUTSIDE world: the webhooks
-- that already land (SendGrid deliverability, Stripe revenue/churn, inbound
-- SMS opt-outs) write rows here so the brain can perceive the market it acts
-- on. Best-effort writes (must never break the emitting webhook); reads
-- aggregate the latest rows per kind within a window. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "autopilot_senses" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "value" double precision NOT NULL DEFAULT 0,
  "detail" jsonb,
  "observed_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "autopilot_senses_kind_observed_idx"
  ON "autopilot_senses" ("kind", "observed_at");
