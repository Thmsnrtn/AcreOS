-- ============================================================================
-- Devon Park — wave-3 FK semantics correction.
-- ============================================================================
--
-- Why a second FK pass after migrations/0081?
-- ───────────────────────────────────────────
-- 0081 installed hard FKs but used CASCADE everywhere a contractor was the
-- target. On second read, two of those are wrong for the business:
--
--   contractor_payments.contractor_id — must be RESTRICT, not CASCADE.
--     A payment row IS the 1099-NEC evidence. CASCADE means deleting a
--     contractor silently destroys every >$600 payment IRS-reportable
--     receipt for that tax year. RESTRICT forces the operator to confront
--     payment history before the contractor can be deleted (or, more
--     realistically, marks them inactive instead). Devon §4: "1099-NEC for
--     every sub I paid >$600."
--
--   bid_estimates.contractor_id — must be SET NULL, not CASCADE.
--     Bid history is part of project post-mortem and contractor evaluation.
--     "Why did we pick GC A over GC B" depends on the losing bid still
--     existing after the loser is removed from the roster. SET NULL keeps
--     the bid row, with contractor identity collapsed to "former contractor."
--     Requires bid_estimates.contractor_id to be nullable; we relax that
--     constraint below.
--
-- Also installs the long-missing FK on contractor_w9_documents (CASCADE on
-- contractor — when the contractor is gone the W-9 has no subject).
--
-- Idempotent — each ALTER consults pg_constraint first.
-- ============================================================================

DO $$
BEGIN
  -- ── contractor_payments.contractor_id  CASCADE → RESTRICT ────────────────
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contractor_payments_contractor_id_fkey'
       AND confdeltype = 'c'    -- 'c' = CASCADE
  ) THEN
    ALTER TABLE contractor_payments
      DROP CONSTRAINT contractor_payments_contractor_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contractor_payments_contractor_id_fkey'
       AND confdeltype = 'r'    -- 'r' = RESTRICT
  ) THEN
    ALTER TABLE contractor_payments
      ADD CONSTRAINT contractor_payments_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE RESTRICT;
  END IF;

  -- ── bid_estimates.contractor_id  CASCADE → SET NULL ──────────────────────
  -- Relax NOT NULL first so SET NULL on delete is legal.
  ALTER TABLE bid_estimates
    ALTER COLUMN contractor_id DROP NOT NULL;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bid_estimates_contractor_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    ALTER TABLE bid_estimates
      DROP CONSTRAINT bid_estimates_contractor_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bid_estimates_contractor_id_fkey'
       AND confdeltype = 'n'    -- 'n' = SET NULL
  ) THEN
    ALTER TABLE bid_estimates
      ADD CONSTRAINT bid_estimates_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE SET NULL;
  END IF;

  -- ── contractor_w9_documents.contractor_id  → CASCADE (was soft) ──────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contractor_w9_documents_contractor_id_fkey'
  ) THEN
    -- Defang orphans first so the ADD CONSTRAINT survives on drifted dev DBs.
    DELETE FROM contractor_w9_documents w
     WHERE w.contractor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM contractors c WHERE c.id = w.contractor_id);

    ALTER TABLE contractor_w9_documents
      ADD CONSTRAINT contractor_w9_documents_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE CASCADE;
  END IF;
END$$;
