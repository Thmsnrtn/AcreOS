-- Decision review date — the answer to "when is this due for an outcome".
--
-- Nullable, and null is a real answer: many decisions have no natural review
-- date. Frozen at decision time by the person making the call rather than
-- guessed later by a heuristic, which would nag about a long land hold and stay
-- silent on a flip.
ALTER TABLE "decision_snapshots" ADD COLUMN IF NOT EXISTS "review_due_at" timestamp;

-- The prompt sweep's index. Org-leading per the shard-readiness invariant.
CREATE INDEX IF NOT EXISTS "decision_snapshots_org_review_due_idx"
  ON "decision_snapshots" ("organization_id", "review_due_at");
