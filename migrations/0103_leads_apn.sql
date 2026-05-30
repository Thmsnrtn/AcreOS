-- ============================================================================
-- 0103_leads_apn.sql — APN on leads for CSV importer dedupe.
-- ============================================================================
--
-- Hank's VA spent 60 minutes per import cleaning county tax-delinquent CSVs
-- to AcreOS's expected column shape. The new CSV importer with auto-mapping
-- + APN dedupe needs an APN column on leads to track the canonical parcel
-- identifier across re-imports of the same county list month after month.
--
-- Nullable: manual-add and legacy imports don't carry APN. Indexed per-org
-- because the importer's dedupe path queries `WHERE org = $1 AND apn = $2`.
-- Not UNIQUE — multiple orgs may legitimately have the same APN as a lead.
-- ============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS apn text;

CREATE INDEX IF NOT EXISTS leads_org_apn_idx
  ON leads (organization_id, apn)
  WHERE apn IS NOT NULL;
