-- Coriander §1: Recovery-console autopay freeze.
-- Adds an autopayFrozen flag to organizations so the founder can pause
-- Stripe collection without cancelling the subscription. Set when an
-- account is in dispute (death, fraud claim, court order). Cleared by
-- the founder explicitly — no automatic unfreeze.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopay_frozen BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopay_frozen_at TIMESTAMPTZ;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopay_frozen_reason TEXT;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS autopay_frozen_until TIMESTAMPTZ;
