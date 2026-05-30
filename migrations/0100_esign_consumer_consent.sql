-- ============================================================================
-- 0100_esign_consumer_consent.sql — E-SIGN Act §101(c)(1)(B) consent capture.
-- ============================================================================
--
-- The federal E-SIGN Act conditions the validity of an electronic signature
-- on a consumer transaction on the consumer FIRST receiving five disclosures
-- and affirmatively consenting:
--   (i)   hardware/software requirements for receiving the record
--   (ii)  right to receive a paper copy and any fee for it
--   (iii) right to withdraw consent and any consequences
--   (iv)  procedures for updating contact information
--   (v)   scope statement (which records are covered)
--
-- AcreOS previously surfaced only a single "this signature is legally
-- binding" line on /sign/:docId — none of the five disclosures, no consent
-- capture. That makes every e-signed promissory note arguably unenforceable
-- in the originating state. This migration:
--
--   1. Adds users.esign_consented_at + users.esign_consent_version columns
--      so the dialog suppresses itself once consent is on file (and re-fires
--      when the disclosure version bumps).
--   2. Creates signing_consent_audit table — one row per consent capture,
--      keyed by either users.id (authenticated AcreOS user) or
--      (signer_email, document_id) for HMAC-tokened external signers.
--      Records each of the five disclosure flags individually so a regulator
--      can verify each box was rendered + acknowledged.
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "esign_consented_at" timestamp;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "esign_consent_version" varchar(32);

CREATE TABLE IF NOT EXISTS "signing_consent_audit" (
  "id" serial PRIMARY KEY,
  "user_id" varchar,
  "organization_id" integer REFERENCES "organizations"("id"),
  "signer_email" text,
  "document_id" integer REFERENCES "generated_documents"("id"),
  "disclosure_version" varchar(32) NOT NULL,
  "consented_hardware_requirements" boolean NOT NULL DEFAULT false,
  "consented_paper_copy_right" boolean NOT NULL DEFAULT false,
  "consented_withdrawal_right" boolean NOT NULL DEFAULT false,
  "consented_contact_update" boolean NOT NULL DEFAULT false,
  "consented_scope" boolean NOT NULL DEFAULT false,
  "ip_address" text,
  "user_agent" text,
  "consented_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "signing_consent_audit_user_idx"
  ON "signing_consent_audit" ("user_id");
CREATE INDEX IF NOT EXISTS "signing_consent_audit_email_doc_idx"
  ON "signing_consent_audit" ("signer_email", "document_id");
