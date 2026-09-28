-- DEFECT-0146: index the workflow outbox dedupe key.
CREATE INDEX IF NOT EXISTS "outbox_dedupe_key_idx" ON "outbox" ((payload->>'dedupeKey'));
