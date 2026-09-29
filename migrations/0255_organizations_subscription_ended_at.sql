-- 0255 — when a lender's subscription ended (founder ruling 2026-09-29 #3,
-- DEFECT-0106). Starts the 90-day borrower wind-down: autopay, the borrower
-- portal and periodic statements continue for 90 days, then new debits stop
-- and borrowers are told to pay the lender directly. NULL for a subscription
-- that has not ended; a lender already cancelled when this ships is stamped
-- on first sight by server/services/borrower/servicingPhase.ts.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_ended_at" timestamp;
