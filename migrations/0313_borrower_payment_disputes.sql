-- 0313 — Founder Autopilot B-2: borrower chargebacks (Stripe disputes on a
-- lender's OWN connected account) were invisible to AcreOS: the Connect
-- endpoint subscribed to no dispute events and no handler existed, so the
-- servicing ledger silently diverged from Stripe reality.
--
-- The dispute state lives ON the ledger row it concerns (the `payments`
-- row the borrower's Checkout session posted), not in a new table: the
-- flag the lender sees, the response deadline, and the escalation stamps
-- are all facts about that one payment. NO amount, balance, or payment
-- status column is touched by the dispute path — a dispute flags the row
-- "under review"; whether money is ever reversed stays a founder/lender
-- judgment (drills record B-2, 2026-11-16: no automatic ledger reversal).
--
-- All additive + idempotent; no table added, no existing column touched.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_id" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_status" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_reason" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_amount_cents" integer;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_due_by" timestamp with time zone;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_opened_at" timestamp with time zone;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_closed_at" timestamp with time zone;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_escalation_72h_at" timestamp with time zone;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "dispute_escalation_24h_at" timestamp with time zone;

-- The escalation sweep scans open disputes by deadline.
CREATE INDEX IF NOT EXISTS "payments_dispute_due_idx" ON "payments" ("dispute_due_by") WHERE "dispute_id" IS NOT NULL AND "dispute_closed_at" IS NULL;
