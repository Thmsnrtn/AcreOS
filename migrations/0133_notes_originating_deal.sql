-- ============================================================================
-- 0133 — Maren (CPO) #1 "Close & Carry" — Deal→Note lifecycle bridge
--   (weld the Deals door to the Finance door into one continuous object)
-- ----------------------------------------------------------------------------
-- A seller-finance land business is one loop:
--   parcel → owner → offer → contract → close → CARRY THE NOTE → collect → payoff
-- AcreOS built both ends — the Deals door (deals) and the servicing book
-- (notes, amortizationSchedule, dunning, 1099-INT readiness) — but left the
-- middle disconnected: closing a deal then re-keying buyer/price/down/rate/term
-- into a blank note. This migration adds the bridge.
--
-- `originating_deal_id` stamps the deal that originated a note. The carry flow
-- (POST /api/notes/from-deal/:dealId) maps deal fields → note and sets this
-- column, so:
--   * note → deal  : notes.originating_deal_id
--   * deal → note  : SELECT … FROM notes WHERE organization_id = $org
--                                          AND originating_deal_id = $deal
-- Once a customer's live book of carried notes is stitched to its originating
-- deals here, switching cost becomes structural — the indispensability bet.
--
-- ON DELETE SET NULL: deleting (or soft-deleting → hard-deleting) the deal must
-- NEVER cascade-destroy a live serviced note. The ledger outlives the
-- origination record; the link just goes null.
--
-- Index: leading-org composite (organization_id, originating_deal_id) so the
-- reverse deal→note lookup is a single per-tenant index probe
-- (scripts/check-org-leading-index.mjs / Tahoe shard-readiness).
--
-- Mirrors shared/schema.ts (notes) + scripts/migrate.mjs STATEMENTS.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "originating_deal_id" integer
  REFERENCES "deals" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "notes_org_originating_deal_idx"
  ON "notes" ("organization_id", "originating_deal_id");
