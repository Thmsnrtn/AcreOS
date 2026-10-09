-- 0269 — team_members.view_only_assigned_leads becomes a per-member OVERRIDE
-- of the role default, with NULL meaning "use the role's default" (`va` →
-- assigned leads only). It was NOT NULL DEFAULT false, so a row written
-- without the field (an invite accept) stored false, which took precedence
-- over the va role default. The effective value is computed in one place:
-- server/utils/permissions.ts resolveViewOnlyAssignedLeads.
--
-- Column definition ONLY. Existing rows are deliberately not rewritten here
-- ("[OWNER] Confirm before migrating production rows"): a stored false may be
-- an owner's deliberate choice. The founder-run
-- scripts/data/reset-va-view-only-default.ts resets the VA rows still at the
-- old default, dry-run first. Idempotent: both ALTERs are no-ops once applied.
ALTER TABLE "team_members" ALTER COLUMN "view_only_assigned_leads" DROP NOT NULL;
ALTER TABLE "team_members" ALTER COLUMN "view_only_assigned_leads" DROP DEFAULT;
