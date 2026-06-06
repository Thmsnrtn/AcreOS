-- ============================================================================
-- 0119 — Tahoe / Beatrice — customer-visible security activity log.
-- ----------------------------------------------------------------------------
-- A per-org, customer-READABLE log of security/data-significant events:
-- logins, data exports, member invite/remove, role changes, billing changes,
-- subscription pause/cancel, API-key issuance. Surfaced behind Settings as the
-- "Security activity" view (NOT a new top-level door). Append-only by
-- convention; metadata is written through redactByClassification() so PII /
-- financial values are labelled rather than stored in the clear.
--
-- Distinct from audit_log (entity CRUD, hash-chained) and audit_events
-- (founder/recovery-console forensic log). Mirrors shared/schema.ts +
-- scripts/migrate.mjs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "customer_audit_log" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "actor_user_id" text,
  "actor_email" text,
  "action" text NOT NULL,
  "category" text NOT NULL,
  "target_label" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_audit_log_org_created_idx"
  ON "customer_audit_log" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_audit_log_org_category_idx"
  ON "customer_audit_log" ("organization_id", "category");
