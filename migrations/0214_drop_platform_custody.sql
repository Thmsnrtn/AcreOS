-- ============================================================================
-- 0214 — Drop the dead platform-custody surfaces
-- Founder ruling 2026-07-29: "Be the rail, not the provider."
-- ----------------------------------------------------------------------------
-- The ruling: payment architecture applies ONLY to direct subscription payments
-- TO the AcreOS platform. When a customer manages their own notes/rents/
-- payments they are ROUTED to a payment service so the liability stays out of
-- AcreOS's hands. Customer money never moves on AcreOS's own account.
--
-- A custody audit found the storage below to be DEAD, so removing it costs
-- nothing:
--
--   transaction_fee_settlements / fee_payout_schedules / fee_audit_log
--     Storage for server/services/transactionFeeService.ts — a full
--     escrow-and-take-a-cut engine (collect buyer/seller/platform fee, HOLD it
--     on AcreOS's balance for N days, release, transfer out) that had ZERO call
--     sites. Nothing ever wrote a row and nothing ever read one. Its
--     processPayout() also stamped a FABRICATED `tr_simulated_<ts>` identifier
--     into stripe_transfer_ids, a money column — independently a
--     no-fabrication violation. Service, its stub `/api/transaction-fees`
--     router, and its `/fee-dashboard` console are deleted in the same commit.
--
--   marketplace_transactions.seller_payout_status / seller_payout_amount /
--   seller_stripe_transfer_id
--     These three columns encoded AcreOS receiving the sale proceeds and paying
--     the seller from its own balance. status/amount were written by
--     marketplace.completeTransaction() and read by NOTHING;
--     seller_stripe_transfer_id was never even written. Verified by grep across
--     server/, shared/ and client/ before dropping.
--
-- DELIBERATELY NOT DROPPED: marketplace_transactions.platform_fee_percent /
-- platform_fee_cents. That fee is a payment TO AcreOS — which the ruling
-- permits — charged to the buyer org as AcreOS's own customer. It never carries
-- the sale proceeds.
--
-- Idempotent. Mirrors shared/schema/compliance.ts and
-- shared/schema/marketplace.ts.
-- ============================================================================

-- fee_audit_log references transaction_fee_settlements, so it goes first.
DROP TABLE IF EXISTS "fee_audit_log";
DROP TABLE IF EXISTS "fee_payout_schedules";
DROP TABLE IF EXISTS "transaction_fee_settlements";

ALTER TABLE "marketplace_transactions" DROP COLUMN IF EXISTS "seller_payout_status";
ALTER TABLE "marketplace_transactions" DROP COLUMN IF EXISTS "seller_payout_amount";
ALTER TABLE "marketplace_transactions" DROP COLUMN IF EXISTS "seller_stripe_transfer_id";
