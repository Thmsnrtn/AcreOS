-- ============================================================================
-- 0123_founder_life_cockpit.sql
-- ----------------------------------------------------------------------------
-- Lena (CFO/CIO) + Iris (CTO) + Beatrice (CRO) — Founder Life-Cockpit substrate.
--
-- FOUNDER-SIDE ONLY. All tables are FOUNDER-SCOPED (keyed by founder_user_id, the
-- Clerk user id), NOT organization-scoped customer data. They hold SENSITIVE
-- personal data (W2s, possibly SSNs, financial records). Any sensitive value
-- (document blobs, dollar amounts) is encrypted at rest (AES-256-GCM, enc:v1:
-- envelope) by the application before it touches these columns — the DB never
-- sees plaintext SSNs or raw file bytes.
--
-- Mirror of shared/schema/founder-life-cockpit.ts and scripts/migrate.mjs.
-- All statements idempotent (IF NOT EXISTS).
-- ============================================================================

-- ── founder_tax_profile ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "founder_tax_profile" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "tax_year" integer NOT NULL,
  "filing_status" text NOT NULL DEFAULT 'married_joint',
  "state" text NOT NULL DEFAULT 'MA',
  "has_spouse" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "founder_tax_profile_user_year_uk" ON "founder_tax_profile" ("founder_user_id", "tax_year");
CREATE INDEX IF NOT EXISTS "founder_tax_profile_user_idx" ON "founder_tax_profile" ("founder_user_id");

-- ── founder_documents (encrypted vault) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "founder_documents" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "doc_type" text NOT NULL DEFAULT 'other',
  "label" text NOT NULL,
  "tax_year" integer,
  "encrypted_blob" text NOT NULL,
  "encryption_kid" text NOT NULL DEFAULT 'default',
  "file_name" text,
  "mime_type" text,
  "byte_size" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "founder_documents_user_created_idx" ON "founder_documents" ("founder_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "founder_documents_user_type_idx" ON "founder_documents" ("founder_user_id", "doc_type");
CREATE INDEX IF NOT EXISTS "founder_documents_user_year_idx" ON "founder_documents" ("founder_user_id", "tax_year");

-- ── founder_obligations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "founder_obligations" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "title" text NOT NULL,
  "obligation_type" text NOT NULL DEFAULT 'tax',
  "due_date" timestamptz,
  "status" text NOT NULL DEFAULT 'open',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "founder_obligations_user_due_idx" ON "founder_obligations" ("founder_user_id", "due_date");
CREATE INDEX IF NOT EXISTS "founder_obligations_user_status_idx" ON "founder_obligations" ("founder_user_id", "status");

-- ── founder_income_sources ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "founder_income_sources" (
  "id" serial PRIMARY KEY,
  "founder_user_id" text NOT NULL,
  "tax_year" integer NOT NULL,
  "source_type" text NOT NULL DEFAULT 'w2_self',
  "label" text NOT NULL,
  "encrypted_amount" text,
  "encryption_kid" text NOT NULL DEFAULT 'default',
  "withholding_at_source" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "founder_income_sources_user_year_idx" ON "founder_income_sources" ("founder_user_id", "tax_year");
CREATE INDEX IF NOT EXISTS "founder_income_sources_user_type_idx" ON "founder_income_sources" ("founder_user_id", "source_type");
