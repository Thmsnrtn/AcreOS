-- ============================================================================
-- Note Investor vertical foundation — Phase 5 §5 (Q4 2026).
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- Note investors are land investors who hold paper (notes) instead of dirt.
-- We share the same brand and persona registry as the land flow, but a note
-- investor's daily artefacts differ — they track acquired notes, payment
-- ledgers, and 1099-INT issuance off interest income, not direct-mail
-- campaigns and lead pipelines.
--
-- This migration is foundation only:
--   • acquired_notes  — the notes themselves (loans the org has bought).
--   • note_payments   — per-payment ledger; drives 1099-INT aggregation.
--   • organizations.investor_type — drives sidebar / onboarding fork.
--
-- The full BPO + tape diligence + Sophie agent expansion is tracked in
-- docs/exhaustive-completion/note-investor-followups.md and is *not* part
-- of this PR.
--
-- Additive only — every column has a default or is nullable; existing land
-- workflows are unaffected.
-- ============================================================================

-- ─── Part A — Investor-type fork on organizations ────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS investor_type TEXT NOT NULL DEFAULT 'land';

COMMENT ON COLUMN organizations.investor_type IS
  'Vertical fork — ''land'' | ''notes'' | ''both''. Drives sidebar module visibility, onboarding-step skipping, and persona vocabulary. Defaults to ''land'' so legacy orgs are unchanged.';

-- ─── Part B — acquired_notes ─────────────────────────────────────────────────
-- Notes the org has *acquired* (purchased from a previous holder). Distinct
-- from the existing `notes` table, which models notes the org *originated*
-- as the seller-financier on a land sale. The 1099-INT generator unions
-- both sources when an org is investorType = 'both'.

CREATE TABLE IF NOT EXISTS acquired_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Underlying collateral (land that secures the note). Optional — can be
  -- attached later from the note detail surface.
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  -- Borrower-of-record. Reuses the leads table (which already carries
  -- borrower fields + encrypted TIN). Optional for partial-import notes.
  borrower_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  -- Org-scoped internal identifier (uniqueness enforced via the index below
  -- in combination with organization_id).
  note_number TEXT NOT NULL,
  -- All money in cents (bigint) to match the rest of AcreOS.
  original_principal_cents BIGINT NOT NULL,
  current_balance_cents BIGINT NOT NULL,
  -- Interest rate in basis points — 800 = 8.00%.
  interest_rate_bps INTEGER NOT NULL,
  term_months INTEGER NOT NULL,
  payment_amount_cents BIGINT NOT NULL,
  payment_due_day INTEGER NOT NULL, -- 1-31
  origination_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  -- The day WE bought the note. Can differ (and usually does) from
  -- origination — the note may have been originated years before we
  -- acquired it from the previous holder.
  acquisition_date DATE NOT NULL,
  acquisition_price_cents BIGINT NOT NULL,
  -- performing | late | default | paid_off | sold
  status TEXT NOT NULL DEFAULT 'performing',
  -- Payer (borrower-side) snapshot. Mirrors the lead row so the 1099-INT
  -- generator can read either source without a join chain when the lead
  -- record is incomplete (e.g. CSV-imported note with partial borrower).
  payer_name TEXT NOT NULL,
  payer_address JSONB,
  -- Encrypted TIN (SSN/EIN/ITIN) via fieldEncryption.encrypt().
  payer_encrypted_tin TEXT,
  payer_tin_type TEXT, -- 'SSN' | 'EIN' | 'ITIN'
  -- Provenance — who held the note before us. Useful for diligence + servicer
  -- handoff tracking across an assignment.
  original_lender TEXT,
  -- S3 key of the assignment paperwork (allonge / assignment of mortgage /
  -- assignment of beneficial interest depending on jurisdiction).
  assignment_doc_s3_key TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline / "what needs servicing" reads.
CREATE INDEX IF NOT EXISTS acquired_notes_org_status_maturity_idx
  ON acquired_notes(organization_id, status, maturity_date);

-- Annual / monthly acquisition reporting.
CREATE INDEX IF NOT EXISTS acquired_notes_org_acquisition_idx
  ON acquired_notes(organization_id, acquisition_date);

-- Reverse lookup from a property — "what notes are secured by this parcel?"
CREATE INDEX IF NOT EXISTS acquired_notes_property_idx
  ON acquired_notes(property_id);

-- Org-scoped uniqueness on note number — multiple orgs can use the same
-- internal number; one org cannot reuse one.
CREATE UNIQUE INDEX IF NOT EXISTS acquired_notes_org_number_uk
  ON acquired_notes(organization_id, note_number);

-- ─── Part C — note_payments ──────────────────────────────────────────────────
-- Per-payment ledger. Drives 1099-INT yearly aggregation (sum interestCents
-- per payer per tax year) and per-note amortization-variance reporting.

CREATE TABLE IF NOT EXISTS note_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES acquired_notes(id) ON DELETE CASCADE,
  -- Denormalized for query speed on the yearly 1099 aggregation — we want
  -- to filter by org + year without joining every time.
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  principal_cents BIGINT NOT NULL DEFAULT 0,
  interest_cents BIGINT NOT NULL DEFAULT 0,
  escrow_cents BIGINT NOT NULL DEFAULT 0,
  late_fee_cents BIGINT NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'ach', -- ach | check | wire | cash | other
  reference_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_payments_note_date_idx
  ON note_payments(note_id, payment_date);

-- 1099-INT aggregation read path — filter by org + year, sum interest_cents.
CREATE INDEX IF NOT EXISTS note_payments_org_date_idx
  ON note_payments(organization_id, payment_date);
