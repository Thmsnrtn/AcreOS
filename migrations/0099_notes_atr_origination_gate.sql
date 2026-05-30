-- ============================================================================
-- 0099_notes_atr_origination_gate.sql — Reg-Z §1026.43 ATR hard gate.
-- ============================================================================
--
-- §1026.43(c) requires the creditor on every consumer-purpose closed-end
-- credit transaction secured by a dwelling to make a reasonable, good-faith
-- ability-to-repay determination AT OR BEFORE consummation. The §1026.36(a)(4)
-- seller-financer exemption is for MLO LICENSING — it does NOT exempt the
-- creditor from §1026.43. The only statutory escapes are:
--   (i)   raw land (non-dwelling collateral)
--   (ii)  business-purpose credit (§1026.43(a)(1)(i))
--   (iii) commercial / entity borrower (not a natural person)
--
-- Statutory damages on an unsupported ATR transaction = actual damages + ALL
-- finance charges and fees paid + statutory damages, available for the life
-- of the loan plus 3 years after default. Until this migration shipped, a
-- note row could be inserted with status='active' and no ATR record on file —
-- one tape of those is consent-order shape.
--
-- This migration:
--   1. Adds the atr_exemption_code column (text — see CHECK below).
--   2. Adds a CHECK constraint so status='active' is impossible without
--      atr_determination_completed=true OR a valid atr_exemption_code.
--   3. Pre-existing 'active' rows are GRANDFATHERED to exemption_code='legacy'
--      so the constraint can be added without rewriting history; the servicing
--      audit surface already flags any pre-gate note for retroactive review.
-- ============================================================================

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "atr_exemption_code" text;

-- Whitelist values the exemption code can take. NULL is allowed (means
-- "no exemption claimed — full ATR required"); any other string is rejected.
-- 'legacy' is included for grandfathering pre-gate rows in step 3.
ALTER TABLE "notes"
  DROP CONSTRAINT IF EXISTS "notes_atr_exemption_code_check";
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_atr_exemption_code_check"
  CHECK (
    atr_exemption_code IS NULL
    OR atr_exemption_code IN ('raw_land', 'business_purpose', 'commercial_borrower', 'legacy')
  );

-- Grandfather: every existing active note without an ATR determination gets
-- the 'legacy' exemption marker so the gate constraint below can be added
-- without rewriting prod data. The audit surface treats 'legacy' as a flag
-- for retroactive review, NOT as evidence of compliance.
UPDATE "notes"
SET    atr_exemption_code = 'legacy'
WHERE  status = 'active'
  AND  (atr_determination_completed IS NULL OR atr_determination_completed = false)
  AND  atr_exemption_code IS NULL;

-- The hard gate. After this lands, no insert / update can move a note row
-- to status='active' without a completed ATR determination OR a valid
-- exemption code. Trying it raises a Postgres CHECK violation at the DB
-- layer regardless of which code path bypassed the application-layer gate.
ALTER TABLE "notes"
  DROP CONSTRAINT IF EXISTS "notes_atr_origination_gate";
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_atr_origination_gate"
  CHECK (
    status <> 'active'
    OR atr_determination_completed = true
    OR atr_exemption_code IS NOT NULL
  );

-- Quick-filter index — audit surfaces query "find all active notes with
-- exemption_code='legacy'" frequently to enumerate retroactive-review work.
CREATE INDEX IF NOT EXISTS "notes_atr_exemption_idx"
  ON "notes" (organization_id, atr_exemption_code)
  WHERE atr_exemption_code IS NOT NULL;
