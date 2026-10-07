-- 0264 — Delegated releases are bounded by hand and by drafting role, and a
-- purchase is refunded by the autopilot exactly once.
--
-- autopilot_pending_actions.source_role
--                     which role worker (or seam) drafted the frozen action.
--                     NULL = drafted by something no grant may release for
--                     (a coding dispatch, the chat) — founder tap only.
-- witness_grants.hands / source_roles
--                     the hands and drafting roles a grant covers. Empty
--                     covers nothing (fail-closed), so a grant issued before
--                     these columns existed releases nothing until re-issued.
-- credit_txn_purchase_refund_pi_uniq
--                     the apply_refund hand's 'purchase_refund' row (the
--                     purchased credits taken back) is its claim on the
--                     payment; this partial UNIQUE index makes a second claim
--                     on the same payment impossible under concurrency.
--
-- Purely additive.
ALTER TABLE "autopilot_pending_actions" ADD COLUMN IF NOT EXISTS "source_role" text;
ALTER TABLE "witness_grants" ADD COLUMN IF NOT EXISTS "hands" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "witness_grants" ADD COLUMN IF NOT EXISTS "source_roles" jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "credit_txn_purchase_refund_pi_uniq" ON "credit_transactions" ("stripe_payment_intent_id") WHERE type = 'purchase_refund';
