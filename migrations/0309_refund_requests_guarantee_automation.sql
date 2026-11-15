-- 0309 — Refund automation (design 2026-11 §4): columns on refund_requests.
--
-- PROVISIONAL number — renumbered at merge if another migration lands first.
-- Columns only; NO new table. All additive, idempotent.
--
--   eligibility   jsonb       the E1–E6 guarantee-eligibility verdicts at intake
--   brake         text        B1–B7 code when a request is not auto-processed
--   due_at        timestamptz the queue decision SLA (created_at + 24h)
--   attempts      integer     executor retry bookkeeping
--   last_error    text        most recent execution failure, for the queue view
--   denied_reason text        written by the founder deny action
--
-- status is text: the vocabulary extends by value, not by migration
-- (pending, approved, denied, processed + processing, uncertain).
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "eligibility" jsonb;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "brake" text;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "due_at" timestamptz;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "denied_reason" text;
CREATE INDEX IF NOT EXISTS "refund_requests_due_at_idx" ON "refund_requests" ("due_at");
