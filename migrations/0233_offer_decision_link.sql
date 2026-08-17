-- Link an offer to the DecisionSnapshot that produced it.
--
-- Plain integer, no foreign key: offers.organization_id does not cascade while
-- decision_snapshots.organization_id does, so an FK would create a
-- delete-ordering hazard when a tenant is pruned. The read path resolves it
-- through the org-scoped getDecision, so a stale id yields nothing.
--
-- Null is the normal state — every offer not drafted through the fix-and-flip
-- analyzer, and any whose reasoning failed to record.
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "decision_snapshot_id" integer;
