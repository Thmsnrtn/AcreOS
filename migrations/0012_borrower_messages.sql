-- Migration: borrower_messages
-- Adds self-service messaging thread between borrowers and lenders

CREATE TABLE IF NOT EXISTS borrower_messages (
  id          SERIAL PRIMARY KEY,
  note_id     INTEGER NOT NULL REFERENCES notes(id),
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('borrower', 'lender')),
  content     TEXT NOT NULL,
  read_at     TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_borrower_messages_note_id ON borrower_messages (note_id);
CREATE INDEX IF NOT EXISTS idx_borrower_messages_org_id  ON borrower_messages (org_id);
