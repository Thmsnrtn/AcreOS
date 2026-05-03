-- Phase 3 Week 14 (Liana §1+§3, Reyna §1, Blanco §1):
-- RBAC standardization to 4 pragmatic roles + `va` + co-owners relation.
--
-- 1. Standardize team_members.role on { owner | admin | member | viewer | va }.
--    Legacy values (`acquisitions`, `marketing`, `finance`) collapse to `member`
--    — they were never used by any guard differently from `member` operationally.
-- 2. Add team_members.view_only_assigned_leads — per-user flag that, when true,
--    forces every leads query to filter by assigned_to = team_member.id.
--    Default false. Honored by storage.getLeads / storage.getLeadsPaginated
--    via the existing assignedTo filter. Routes that already pass
--    `permissionContext.permissions.viewOnlyAssignedLeads` keep working —
--    permissions.ts now reads this column for `va` users.
-- 3. New `org_co_owners` table — co-ownership relation distinct from
--    operational role. A row here unlocks dual-billing-card and dual-tax-
--    contact UX. LLC-EIN-on-Stripe-customer sync is deferred to a billing
--    follow-up.

-- ─── 1. Role remap ──────────────────────────────────────────────────────────
-- Collapse legacy roles into `member`. We do NOT touch `owner`, `admin`,
-- `member`, or `viewer` rows — they are already canonical. `va` is brand-new
-- and only created by the invite UI from this point forward.
UPDATE team_members
SET    role = 'member'
WHERE  role IN ('acquisitions', 'marketing', 'finance');

-- Same migration on pending invitations (they're populated by the same UI).
UPDATE organization_invitations
SET    role = 'member'
WHERE  role IN ('acquisitions', 'marketing', 'finance');

-- ─── 2. team_members.view_only_assigned_leads ────────────────────────────────
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS view_only_assigned_leads BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: for safety, any existing row that legacy code marked as `viewer`
-- gets the flag flipped. The new `va` role will set it explicitly via the UI.
UPDATE team_members
SET    view_only_assigned_leads = TRUE
WHERE  role = 'viewer'
  AND  view_only_assigned_leads = FALSE;

-- ─── 3. org_co_owners ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_co_owners (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          TEXT    NOT NULL,
  added_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  added_by         TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_co_owners_org_user
  ON org_co_owners (organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_org_co_owners_org
  ON org_co_owners (organization_id);
