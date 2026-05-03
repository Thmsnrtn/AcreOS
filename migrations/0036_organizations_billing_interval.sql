-- Adds billing_interval to organizations so MRR math in
-- /api/founder/executive-dashboard can normalise yearly subscriptions to a
-- per-month figure. Pairs with shared/billing/tier-pricing.ts which carries
-- the canonical monthly + yearly prices for solo / operator / empire.
--
-- Default 'monthly' matches the historical implicit behaviour — every
-- existing row keeps its prior MRR contribution after this migration runs.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly';
