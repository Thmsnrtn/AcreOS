-- ============================================================================
-- 0225 — Short-term-rental (STR) Wave B: per-stay P&L, turnover scheduling and
--        operator-set nightly pricing (2026-08, STR beta → core).
-- ----------------------------------------------------------------------------
-- Wave A (0224) added the `reservations` nightly-stay primitive + occupancy /
-- ADR / RevPAR. Wave B adds the three capabilities the registry names as core,
-- and each is ADDITIVE — no new table (scripts/ratchets/table-count.json stays
-- 756), only nullable columns + one partial index:
--
--   1. OPERATOR-SET NIGHTLY PRICING — reservations.nightly_rate_cents. The
--      operator's OWN set nightly rate for a stay, a figure they RECORD. NOT a
--      market/dynamic "suggested" rate (that would touch the residential-comps
--      data plane — a standing hard-stop — and need a vendor; there is none).
--      The pricing helper derives expected revenue (rate × nights) and its
--      variance vs the recorded gross booking, and REFUSES (null) when unset.
--
--   2. TURNOVER / CLEANING SCHEDULING — maintenance_tickets.reservation_id. A
--      checkout's turnover is a REUSE of the existing maintenance_tickets table
--      (category 'cleaning'), NOT a new table. This nullable column links the
--      turnover ticket to the reservation whose checkout it cleans, and the
--      partial unique index makes generation idempotent: at most one turnover
--      per reservation checkout, so a re-run never double-creates.
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- RECORD-ONLY. nightly_rate_cents is a figure the operator RECORDS; nothing
-- here holds, moves, collects or charges a cent. A turnover ticket is a task,
-- not a payment. The per-stay P&L (shared/rental/stayPnl.ts) TOTALS recorded
-- facts (gross/fees the operator recorded + an allocation of their own recorded
-- property_expenses) and REFUSES rather than fabricate a missing term.
--
-- ── ADDITIVE + NULLABLE — no backfill ───────────────────────────────────────
-- Both columns are nullable and null for every existing row: an unset nightly
-- rate is an honest "not recorded" (never a fabricated comp), and reservation_id
-- is null for every ordinary maintenance ticket (only auto-generated turnover
-- tickets carry it).
--
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command). Idempotent.
-- ============================================================================

-- 1. Operator-set nightly rate on the stay (B3).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "nightly_rate_cents" bigint;

-- 2. Turnover link on the reused maintenance_tickets table (B2).
ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "reservation_id" varchar;

-- Turnover idempotency: at most ONE turnover-cleaning ticket per reservation
-- checkout. Org-LEADING (L3 shard-readiness) + PARTIAL so it binds only turnover
-- rows; ordinary tickets (null reservation_id) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_tickets_org_reservation_uk"
  ON "maintenance_tickets" ("organization_id", "reservation_id")
  WHERE "reservation_id" IS NOT NULL;
