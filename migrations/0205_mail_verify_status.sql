-- ============================================================================
-- 0205 — Jarvis Phase 1 CP3: verify verdict columns on mail_shipments
-- ----------------------------------------------------------------------------
-- Founder-approved plan: docs/internal/jarvis-phase0-audit.md (Phase 1,
-- "Verified Act-and-Confirm"). CP3 extends the generic `verify` dispatch
-- (0204) to the OUTREACH workflow: after the mail flusher actually SENDS a
-- shipment, an independent READ-ONLY verify dispatch evaluates the
-- shipment's own record (piece accounting vs the locked quote, debit-ledger
-- consistency, compliance posture).
--
--   mail_shipments.verify_status / verify_findings — where a SENT shipment's
--     verification VERDICT lands ('pending' | 'passed' | 'flagged' + the
--     FINDINGS block). NULL = no verify enqueued (pre-CP3 rows, dispatch
--     disabled, enqueue failed).
--
-- Verification never blocks or un-sends a shipment — CP3's act-and-confirm
-- binding is the Trust Ledger (verdicts on autopilot dispatches earn/cost
-- domain autonomy), not blocking. All columns nullable + additive; existing
-- rows untouched.
-- Mirrors scripts/migrate.mjs + shared/schema/finance.ts.
-- ============================================================================

ALTER TABLE "mail_shipments" ADD COLUMN IF NOT EXISTS "verify_status" text;
ALTER TABLE "mail_shipments" ADD COLUMN IF NOT EXISTS "verify_findings" text;
