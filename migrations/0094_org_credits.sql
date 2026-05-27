-- Lens 3 (Pricing Coherence) — org_credits cache table.
--
-- The canonical pool ledger lives in `financial_ledger` (category =
-- 'opex_spent', feature in TRACKED_CATEGORIES). This table caches the
-- per-org current-month balance so fast paths (rate gates, gauge polls)
-- don't have to aggregate the ledger on every request.
--
-- Writes are best-effort and idempotent. The gauge query at
-- /api/outreach/mail/credits/summary still reads the financial_ledger
-- aggregation as the source of truth — this cache is for hard-wall paths
-- that need sub-millisecond balance checks.

CREATE TABLE IF NOT EXISTS org_credits (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_credits_updated_at ON org_credits(updated_at);
