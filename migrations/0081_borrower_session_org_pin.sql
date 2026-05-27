-- 0081_borrower_session_org_pin.sql
--
-- SEC: pin borrower_sessions to the originating organization (Lens 23
-- finding). Before this column existed, validateBorrowerSession in
-- server/routes-borrower.ts trusted session.noteId verbatim and read
-- notes.organizationId at request time. If a note was ever migrated
-- across orgs (admin tool, manual SQL, future feature), an old
-- borrower session would silently follow the note into the new org
-- and start writing payments / messages there. The note's
-- organizationId is also the only authority binding the session to
-- the org it was minted for — there's no other tenant pin.
--
-- Fix: snapshot the org at session-creation time. Every read path
-- re-asserts `note.organization_id = session.organization_id` and
-- 401s otherwise. Backfill existing rows from their linked note.
--
-- This migration is additive (no destructive ops); idempotent.

ALTER TABLE borrower_sessions
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill: pull the note's organization_id for every existing session
-- where the column is still NULL. New rows will populate it directly
-- in createBorrowerSession.
UPDATE borrower_sessions bs
SET organization_id = n.organization_id
FROM notes n
WHERE bs.note_id = n.id
  AND bs.organization_id IS NULL;

-- Once backfill is complete in this environment, the NOT NULL constraint
-- can be enforced. We do this in a separate statement so a partial
-- backfill (orphaned session rows whose note was deleted) doesn't fail
-- the whole migration — orphans get cleaned up via expiry naturally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM borrower_sessions WHERE organization_id IS NULL
  ) THEN
    ALTER TABLE borrower_sessions
      ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_borrower_sessions_org_note
  ON borrower_sessions(organization_id, note_id);
