-- ============================================================================
-- 0142 — Beatrice (CRO) — OFAC/sanctions ADVISORY screening results
--   Org-scoped record of an advisory counterparty name-screen.
-- ----------------------------------------------------------------------------
-- When a counterparty (a lead / borrower / seller on a deal or note) is
-- created or updated, AcreOS runs an ADVISORY name-screen of the counterparty
-- name against an OFAC SDN-style sanctions list and records the outcome here.
--
-- IMPORTANT FRAMING — this is an ADVISORY screen, NOT a legal determination:
--   * A `potential_match` does NOT block the originating action. The lead /
--     deal / note is still created. We only raise a founder-visible flag.
--   * A human MUST review every `potential_match` manually before drawing any
--     conclusion. The score + matched entry exist to support that review, not
--     to substitute for it.
--   * This table is not, and must not be represented as, evidence of a
--     compliant sanctions-screening program.
--
-- Privacy: we persist only the screened NAME (display) of the counterparty —
-- no other counterparty PII. The match itself runs on a normalized form of the
-- name in application code.
--
-- Founder-visible flag = a row where result='potential_match' AND
-- reviewed_at IS NULL. Reviewing stamps reviewed_at / reviewed_by /
-- review_disposition.
--
-- Composite index leads with organization_id (Tahoe shard-readiness —
-- scripts/check-org-leading-index.mjs).
--
-- Mirrors shared/schema.ts (sanctionsScreenings) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sanctions_screenings" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- "lead" | "borrower" | "contact" | "ad_hoc" — not a FK; subject may be any
  -- counterparty kind or an ad-hoc typed name with no row.
  "subject_type" text NOT NULL,
  "subject_id" text,
  -- Screened name AS PRESENTED (display only). Matching runs on a normalized form.
  "screened_name" text NOT NULL,
  -- "clear" | "potential_match" | "error". Advisory bucket — NOT a determination.
  "result" text NOT NULL,
  -- 0..1 best-match normalized-name similarity across all candidate entries.
  "match_score" real NOT NULL DEFAULT 0,
  -- Matched SDN-style entry (present when result='potential_match').
  "matched_entry_name" text,
  "matched_entry_program" text,
  "list_source" text NOT NULL DEFAULT 'bundled-fixture',
  -- Engine snapshot for reproducibility.
  "engine_version" text NOT NULL DEFAULT 'v1',
  "threshold" real NOT NULL,
  -- Human review of a potential match. Null until a human acts.
  "reviewed_at" timestamp,
  "reviewed_by" text,
  -- "false_positive" | "confirmed_match" | "inconclusive"
  "review_disposition" text,
  "review_notes" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sanctions_screenings_org_created_idx"
  ON "sanctions_screenings" ("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "sanctions_screenings_org_result_idx"
  ON "sanctions_screenings" ("organization_id", "result", "reviewed_at");
