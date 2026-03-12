-- Migration: direct_mail_attribution_and_api_keys
-- Adds tracking codes to mailing order pieces for direct mail attribution,
-- source mail piece FK to leads, and per-org API key management table.

-- 1. Add trackingCode to mailing_order_pieces for attribution
ALTER TABLE mailing_order_pieces
  ADD COLUMN IF NOT EXISTS tracking_code TEXT UNIQUE;

-- 2. Add sourceMailPieceId to leads for direct mail attribution
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_mail_piece_id INTEGER REFERENCES mailing_order_pieces(id);

-- 3. Create org_api_keys table
CREATE TABLE IF NOT EXISTS org_api_keys (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES organizations(id),
  name              TEXT NOT NULL,
  key_hash          TEXT NOT NULL,
  key_prefix        TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'read',
  expires_at        TIMESTAMP,
  last_used_at      TIMESTAMP,
  is_revoked        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INTEGER,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_api_keys_org_idx ON org_api_keys (organization_id);
