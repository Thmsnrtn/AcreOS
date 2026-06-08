-- 0135 — Iris — shared continuous-audit substrate.
--
-- domain_audit_findings is COMPANY/FOUNDER-LEVEL (there is intentionally NO
-- organization_id — a finding is a fact about the COMPANY, not a customer
-- tenant; it may optionally point at a subject via subject_ref). Six domains
-- (Lena/Beatrice/Quinn/Andrei/Tess/Iyari) ship per-domain detectors that emit
-- findings; the founder Command cockpit renders "is it green?" off this one
-- table.
--
-- Dedupe: UNIQUE(detector, dedupe_key) lets recordFinding() upsert — insert
-- once, then bump last_seen_at on every subsequent firing of the same logical
-- finding, never duplicating. Resolution is explicit (resolve/acknowledge) or
-- automatic (staleFindings marks open findings unseen in N days as 'stale').
--
-- Mirrors shared/schema/domain-audit-findings.ts + scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS "domain_audit_findings" (
  "id" serial PRIMARY KEY,
  "domain" text NOT NULL,            -- finance|compliance|alignment|ai|reliability|future|product|cs|growth
  "detector" text NOT NULL,
  "severity" text NOT NULL,          -- info|warn|critical
  "title" text NOT NULL,
  "detail" text NOT NULL,
  "cited_reason" text NOT NULL,      -- charter rule / immutable / SLO it violates
  "status" text NOT NULL DEFAULT 'open', -- open|acknowledged|resolved|stale
  "dedupe_key" text NOT NULL,
  "subject_ref" text,                -- optional org id / parcel / bucket the finding is about
  "metadata" jsonb,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "domain_audit_findings_status_severity_domain_idx"
  ON "domain_audit_findings" ("status", "severity", "domain");

CREATE UNIQUE INDEX IF NOT EXISTS "domain_audit_findings_detector_dedupe_idx"
  ON "domain_audit_findings" ("detector", "dedupe_key");
