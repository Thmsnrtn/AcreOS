-- Rachel (LP-fund persona) §1: per-LP P&L roll-up needs a funding-source
-- tag on each note acquisition. The full Pool entity is deferred (Lens 16
-- follow-ups); until then this carries a free-form label
-- ("Fund I", "Bridge", "JV-Henderson") which the per-LP roll-up reads.
-- When the Pool entity ships this column will be migrated to a FK.

ALTER TABLE note_acquisitions ADD COLUMN IF NOT EXISTS funding_pool_id TEXT;

-- Index to support the per-pool P&L query path. Partial because most rows
-- will be NULL during the bridge-capital era; we only index tagged ones.
CREATE INDEX IF NOT EXISTS note_acquisitions_org_pool_idx
  ON note_acquisitions (organization_id, funding_pool_id)
  WHERE funding_pool_id IS NOT NULL;
