-- 0163 — Negotiation tenant-isolation
--
-- The negotiation orchestrator ranked strategies and rolled up performance
-- with `findMany({})` across ALL organizations, so one tenant's negotiation
-- outcomes influenced another tenant's "best strategy" selection. Org-scope
-- strategies + outcomes and link threads → the strategy driving them so every
-- rollup/read is bounded to a single tenant.
--
-- Additive + idempotent. Pre-existing rows keep NULL organization_id and are
-- never surfaced by the now org-scoped reads (no backfill required; correct by
-- omission). Columns are nullable because existing rows have no org to assign.

ALTER TABLE "negotiation_strategies" ADD COLUMN IF NOT EXISTS "organization_id" integer;
ALTER TABLE "negotiation_outcomes"   ADD COLUMN IF NOT EXISTS "organization_id" integer;
ALTER TABLE "negotiation_threads"    ADD COLUMN IF NOT EXISTS "strategy_id"     integer;

CREATE INDEX IF NOT EXISTS "negotiation_strategies_org_idx"
  ON "negotiation_strategies" ("organization_id", "success_rate");
CREATE INDEX IF NOT EXISTS "negotiation_outcomes_org_idx"
  ON "negotiation_outcomes" ("organization_id", "created_at");
