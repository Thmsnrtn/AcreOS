-- 0162_ledger_dead_letters.sql — Tier 2B (one money spine), 2026-06-10.
--
-- Durable dead-letter store for failed financial_ledger postings. The Stripe
-- webhook handlers post revenue/refund/fee rows best-effort (a ledger failure
-- must never 5xx the webhook); before this table a failure was a log line and
-- the money silently never reached the system of record. Now the original
-- posting args are captured here and the hourly `ledger_dead_letter_replay`
-- worker job re-dispatches them through the same idempotent posting functions.
--
-- external_event_id is UNIQUE: one dead letter per failed event regardless of
-- Stripe redelivery count. status: pending | replayed | abandoned.

CREATE TABLE IF NOT EXISTS "ledger_dead_letters" (
  "id" serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "external_event_id" text NOT NULL UNIQUE,
  "payload" jsonb NOT NULL,
  "last_error" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "last_attempt_at" timestamptz,
  "replayed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ledger_dead_letters_org_status_idx"
  ON "ledger_dead_letters" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "ledger_dead_letters_status_created_idx"
  ON "ledger_dead_letters" ("status", "created_at");
