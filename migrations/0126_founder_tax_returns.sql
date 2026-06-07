-- ============================================================================
-- 0126_founder_tax_returns.sql
-- ----------------------------------------------------------------------------
-- Lena (CFO/CIO) + Beatrice (CRO) — Founder Life-Cockpit DRAFT-RETURN engine.
--
-- FOUNDER-SIDE ONLY. Extends the Life-Cockpit foundation (0123) with:
--   1. W-2/1099 withholding-box intake on founder_income_sources (federal box 2
--      + state box 17), stored ENCRYPTED at rest like the amount column.
--   2. founder_tax_returns — stores the COMPUTED draft return (federal 1040 + MA
--      Form 1 estimate from server/services/founder/taxEngine.ts). The full
--      computed draft + every dollar-valued headline figure is ENCRYPTED
--      (AES-256-GCM enc:v1: envelope). The DB never sees plaintext tax figures.
--
-- This is SELF-PREPARED draft software, NOT IRS e-file. Drafts are estimates the
-- founder transcribes into Free File Fillable Forms / MassTaxConnect or hands to
-- a CPA. Founder-scoped (founder_user_id), NOT org-scoped customer data; must
-- NEVER appear on a customer surface, in shared logs, or train any customer
-- feature (Quinn's rule).
--
-- Mirror of shared/schema/founder-life-cockpit.ts and scripts/migrate.mjs.
-- All statements idempotent (IF NOT EXISTS).
-- ============================================================================

-- ── 0126.1 — W-2/1099 withholding-box intake (encrypted) ─────────────────────
ALTER TABLE "founder_income_sources"
  ADD COLUMN IF NOT EXISTS "encrypted_federal_withheld" text;
ALTER TABLE "founder_income_sources"
  ADD COLUMN IF NOT EXISTS "encrypted_state_withheld" text;

-- ── 0126.2 — founder_tax_returns (computed draft, encrypted) ─────────────────
CREATE TABLE IF NOT EXISTS "founder_tax_returns" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "tax_year" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "filing_status" text NOT NULL DEFAULT 'married_joint',
  "state" text NOT NULL DEFAULT 'MA',
  "encrypted_payload" text NOT NULL,
  "encryption_kid" text NOT NULL DEFAULT 'default',
  "encrypted_federal_total_tax" text,
  "encrypted_federal_refund_or_owed" text,
  "encrypted_state_total_tax" text,
  "encrypted_state_refund_or_owed" text,
  "provisional" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "founder_tax_returns_user_year_idx" ON "founder_tax_returns" ("founder_user_id", "tax_year");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_tax_returns_user_year_version_uk" ON "founder_tax_returns" ("founder_user_id", "tax_year", "version");
