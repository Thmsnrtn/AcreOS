-- 0261 — when the borrower's card Checkout slot was opened (W10.5 audit).
-- Autopay holds an ACH debit while a card Checkout may be paying the same
-- installment. That hold was bounded by notes.updated_at, which the dunning
-- job and the reminder sender refresh daily on a past-due note — so an
-- abandoned Checkout blocked autopay for good. The slot now carries its own
-- timestamp, written with it and cleared with it.
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "pending_checkout_opened_at" timestamp;
