-- ============================================================================
-- 0213 — Borrower ACH autopay: mandate record + idempotent debit attempts
-- Wave C "Money moves" (founder ruling #12(c), 2026-07-29)
-- ----------------------------------------------------------------------------
-- The borrower portal's autopay Switch wrote one boolean (notes.auto_pay_
-- enabled) and scheduled nothing. Its only reader was cashFlowForecaster,
-- which used it to FORECAST money that was never collected, while the portal
-- told the borrower "we'll collect this payment automatically".
--
-- Two tables make it real:
--   ach_mandates        — the retained NACHA §2.3 authorization (exact text,
--                         timestamp, IP/UA, amount ceiling, frequency) plus
--                         the processor's corroborating mandate id. No bank
--                         credentials are ever stored here — last4 only.
--   ach_debit_attempts  — one row per (note, period, attempt). The unique
--                         index IS the double-charge guard; the same key is
--                         replayed as the processor idempotency key, and the
--                         resulting PaymentIntent id becomes the unique
--                         payments.transaction_id.
--
-- Mirrors shared/schema/ach-autopay.ts. Registered in scripts/migrate.mjs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ach_mandates" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  "borrower_lead_id" integer REFERENCES "leads" ("id") ON DELETE SET NULL,
  "rail" text NOT NULL DEFAULT 'stripe_us_bank_account',
  "processor_account_id" text,
  "processor_customer_id" text,
  "processor_payment_method_id" text,
  "processor_mandate_id" text,
  "processor_setup_intent_id" text,
  "setup_reference" text,
  "bank_name" text,
  "account_last4" text,
  "account_type" text,
  "authorization_text" text NOT NULL,
  "authorization_text_version" text NOT NULL,
  "authorization_method" text NOT NULL DEFAULT 'web',
  "agreed_at" timestamp NOT NULL,
  "agreed_ip_address" text,
  "agreed_user_agent" text,
  "agreed_by_email" text NOT NULL,
  "debit_type" text NOT NULL DEFAULT 'recurring',
  "max_amount_cents" integer NOT NULL,
  "frequency" text NOT NULL DEFAULT 'monthly',
  "schedule_description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "confirmed_at" timestamp,
  "revoked_at" timestamp,
  "revoked_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ach_mandates_note_status_idx" ON "ach_mandates" ("note_id", "status");
-- Org-LEADING composite, not a bare (organization_id): every read of this
-- table is "the mandate(s) for this note in this org, by status", including
-- the supersede-on-confirm sweep. This is an authorization record on a debit
-- path, so the tenant key leads both the index and the query.
CREATE INDEX IF NOT EXISTS "ach_mandates_org_note_status_idx" ON "ach_mandates" ("organization_id", "note_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "ach_mandates_setup_reference_uidx" ON "ach_mandates" ("setup_reference");

CREATE TABLE IF NOT EXISTS "ach_debit_attempts" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "note_id" integer NOT NULL REFERENCES "notes" ("id") ON DELETE CASCADE,
  "mandate_id" integer NOT NULL REFERENCES "ach_mandates" ("id") ON DELETE RESTRICT,
  "period_key" text NOT NULL,
  "attempt_number" integer NOT NULL DEFAULT 1,
  "idempotency_key" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "due_date" timestamp NOT NULL,
  "status" text NOT NULL DEFAULT 'created',
  "processor_payment_intent_id" text,
  "processor_charge_id" text,
  "return_code" text,
  "return_category" text,
  "returned_at" timestamp,
  "failure_reason" text,
  "next_retry_at" timestamp,
  "retry_of_attempt_id" integer,
  "payment_id" integer REFERENCES "payments" ("id") ON DELETE SET NULL,
  "reversal_payment_id" integer REFERENCES "payments" ("id") ON DELETE SET NULL,
  "submitted_at" timestamp,
  "settled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- The double-charge guard: one presentment per (note, period, attempt).
CREATE UNIQUE INDEX IF NOT EXISTS "ach_debit_attempts_period_uidx" ON "ach_debit_attempts" ("note_id", "period_key", "attempt_number");
CREATE UNIQUE INDEX IF NOT EXISTS "ach_debit_attempts_idem_uidx" ON "ach_debit_attempts" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "ach_debit_attempts_pi_uidx" ON "ach_debit_attempts" ("processor_payment_intent_id");
CREATE INDEX IF NOT EXISTS "ach_debit_attempts_status_idx" ON "ach_debit_attempts" ("status");
CREATE INDEX IF NOT EXISTS "ach_debit_attempts_retry_idx" ON "ach_debit_attempts" ("next_retry_at");
CREATE INDEX IF NOT EXISTS "ach_debit_attempts_org_note_idx" ON "ach_debit_attempts" ("organization_id", "note_id");
