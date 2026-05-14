-- Pillar S — founder daily attention budget on organizations.
-- Default 5 items/day; founder can adjust per-org. See
-- docs/exhaustive-completion/pillar-s-one-inbox.md.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS founder_daily_attention_cap INTEGER NOT NULL DEFAULT 5;
