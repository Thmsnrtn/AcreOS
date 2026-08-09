-- ============================================================================
-- 0226 — agent_investor: client-vs-own-book + dual-agency disclosure TRACKER
--        (2026-08, agent_investor stays BETA — this builds toward core)
-- ----------------------------------------------------------------------------
-- COLUMNS ONLY on the existing `deals` table — no new table. table-count stays
-- 756 and reachability's tables-no-reader/no-writer stay FLAT (47/59): every
-- column rides `deals`, which already has readers and writers. All additive and
-- NULLABLE, so every existing row keeps working with the value NULL.
--
-- ── 1. CLIENT vs OWN BOOK (`deal_book`) ─────────────────────────────────────
-- The agent_investor persona is both a broker (earns a commission on a CLIENT's
-- transaction) and an investor (buys/sells on their OWN account). Those are
-- different economics and were conflated: every closed deal auto-recorded a
-- commission. A brokerage commission on the agent's OWN buy is a fabricated
-- number — there is no client and no commission. `deal_book` separates them:
--   'client'          — a brokerage transaction; earns a commission.
--   'own_investment'  — the agent's own P&L; NEVER a commission.
-- NULL (the default, and every pre-0226 row) is treated as 'client' — that is
-- what a deal always was — so the PRESENCE of 'own_investment' is the only
-- signal and nothing is inferred from absence. The deal-close commission
-- auto-record now SKIPS own_investment deals (server/routes-deals.ts), on top
-- of the existing hasCommissionConfig honesty gate.
--
-- ── 2. DUAL-AGENCY DISCLOSURE TRACKER (record-only) ─────────────────────────
-- These three columns are a RECORD ONLY. AcreOS does NOT generate, send, or
-- e-sign any disclosure — legal-signing is a founder-only hard-stop. They store
-- what the operator ASSERTS and UPLOADS:
--   `dual_agency_side`            — which side the agent represented
--                                   ('seller' | 'buyer' | 'dual'), operator-set.
--   `disclosure_acknowledged_at`  — a recorded acknowledgement DATE (a fact the
--                                   operator enters), NOT a signature.
--   `disclosure_doc_ref`          — a reference (URL/id) to a document the
--                                   OPERATOR uploaded ELSEWHERE — never generated
--                                   here.
-- A deal carries at most one such record, so these are columns, not a table.
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- Nothing here moves, holds, collects or charges a cent. `deal_book` is a label;
-- the disclosure columns are records of operator-asserted facts.
--
-- ── MIRRORED ────────────────────────────────────────────────────────────────
-- Mirrors shared/schema.ts (`deals`). Registered in scripts/migrate.mjs (the
-- path that runs on deploy as the Fly release_command). Idempotent — every
-- statement is safe to re-run on every deploy.
-- ============================================================================

-- ── 1. Client vs own book ───────────────────────────────────────────────────
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "deal_book" text;

-- Pipeline filter read: "my client deals under contract" reads by (org, book).
-- Org-LEADING per the shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "deals_org_book_idx"
  ON "deals" ("organization_id", "deal_book");

-- ── 2. Dual-agency disclosure tracker (record-only) ─────────────────────────
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "dual_agency_side" text;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "disclosure_acknowledged_at" timestamp;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "disclosure_doc_ref" text;
