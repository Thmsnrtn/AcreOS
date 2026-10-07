-- 0264 — Delegated releases are bounded by hand and by drafting role, and a
-- refund is claimed exactly once.
--
-- autopilot_pending_actions.source_role
--                     which role worker (or seam) drafted the frozen action.
--                     NULL = drafted by something no grant may release for
--                     (a coding dispatch, the chat) — founder tap only.
-- witness_grants.hands / source_roles
--                     the hands and drafting roles a grant covers. Empty
--                     covers nothing (fail-closed), so a grant issued before
--                     this column existed releases nothing until re-issued.
-- autopilot_refund_claims
--                     one row per Stripe charge the apply_refund hand has
--                     refunded or is refunding; the UNIQUE charge id makes a
--                     second refund of the same payment impossible under
--                     concurrency.
--
-- Purely additive.
ALTER TABLE "autopilot_pending_actions" ADD COLUMN IF NOT EXISTS "source_role" text;
ALTER TABLE "witness_grants" ADD COLUMN IF NOT EXISTS "hands" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "witness_grants" ADD COLUMN IF NOT EXISTS "source_roles" jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS "autopilot_refund_claims" (
  "id" serial PRIMARY KEY,
  "charge_key" text NOT NULL,
  "organization_id" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "credits_clawed_back_cents" integer NOT NULL DEFAULT 0,
  "stripe_refund_id" text,
  "approved_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_refund_claims_charge_key_uniq" ON "autopilot_refund_claims" ("charge_key");
