-- ============================================================================
-- 0129_founder_estimated_payments.sql
-- ----------------------------------------------------------------------------
-- Lena (CFO/CIO) — Founder Life-Cockpit quarterly estimated-tax RADAR.
--
-- FOUNDER-SIDE ONLY. Extends the Life-Cockpit foundation with a ledger of the
-- quarterly estimated-tax payments the founder has MARKED PAID. The amounts DUE
-- are derived live from server/services/founder/estimatedTax.ts (safe-harbor
-- engine) and are NOT stored. This table records only what was actually paid so
-- the radar can show paid / upcoming / overdue status.
--
-- `amount_paid` is SENSITIVE → stored ENCRYPTED at rest (AES-256-GCM enc:v1:
-- envelope). The DB never sees a plaintext estimated-payment figure. Founder-
-- scoped (founder_user_id), NOT org-scoped customer data; must NEVER appear on a
-- customer surface, in shared logs, or train any customer feature (Quinn's rule).
--
-- Mirror of shared/schema/founder-life-cockpit.ts and scripts/migrate.mjs.
-- All statements idempotent (IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "founder_estimated_payments" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "tax_year" integer NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT 'federal',
  "quarter" integer NOT NULL,
  "encrypted_amount_paid" text,
  "encryption_kid" text NOT NULL DEFAULT 'default',
  "paid_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "founder_estimated_payments_user_year_idx" ON "founder_estimated_payments" ("founder_user_id", "tax_year");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_estimated_payments_unique_quarter_uk" ON "founder_estimated_payments" ("founder_user_id", "tax_year", "jurisdiction", "quarter");
