-- Mae Vasquez (title-ops audit, 2026-05-27): IOLTA / escrow-license flag
-- on EMD holds.
--
-- Every state requires earnest money to be held by a fiduciary — in
-- attorney-states (NY, NJ, GA, SC, LA + others) that's a state-bar IOLTA
-- (Interest On Lawyers' Trust Account); in escrow-license states (CA, FL,
-- WA, AZ, NV, OR) it must be a licensed escrow company. EMD held in a
-- personal account, an LLC operating account, or with an out-of-state
-- title agent who isn't licensed in the property state is one of the
-- top three loss vectors at closing.
--
-- AcreOS lets operators type any title-company name into the EMD record
-- dialog. We can't validate licensure programmatically without a
-- per-state DOI / bar-association lookup integration, but we CAN force
-- the operator to acknowledge they've verified the holder, and we CAN
-- persist that acknowledgement as part of the EMD audit trail.
--
-- Three states:
--   verified     — operator confirmed via state bar / DOI / underwriter
--   self_attested — operator typed yes but didn't confirm externally
--   unverified   — default; surfaces a warning on the hold
--
-- The check that fails closed is enforced at the application layer.
-- The schema column lets us report on it.

ALTER TABLE earnest_money_holds
  ADD COLUMN IF NOT EXISTS iolta_status text
    NOT NULL DEFAULT 'unverified'
    CHECK (iolta_status IN ('verified', 'self_attested', 'unverified'));

ALTER TABLE earnest_money_holds
  ADD COLUMN IF NOT EXISTS iolta_verified_at timestamptz;

ALTER TABLE earnest_money_holds
  ADD COLUMN IF NOT EXISTS iolta_verification_source text;
  -- e.g. "TX_DOI_lookup", "NJ_bar_attorney_trust_search",
  -- "underwriter_confirmation", "operator_attestation"

CREATE INDEX IF NOT EXISTS emd_iolta_status_idx
  ON earnest_money_holds (organization_id, iolta_status)
  WHERE iolta_status != 'verified';
-- Partial index — we only ever query for the unverified set
-- (compliance dashboard "EMD held with unverified escrow agent").
