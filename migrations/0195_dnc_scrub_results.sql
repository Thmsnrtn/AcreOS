-- ============================================================================
-- 0195 — DNC / litigator scrub results (TCPA cold-outreach seam, H0 item)
-- ----------------------------------------------------------------------------
-- Cached outcome of scrubbing a phone number against a Do-Not-Call registry
-- and/or a known-TCPA-litigator list via a pluggable vendor adapter
-- (server/services/compliance/dncScrub.ts).
--
-- The vendor pick is a pending founder decision (roadmap-2026-07 "Founder
-- decisions" #1). Until a vendor is configured via DNC_SCRUB_PROVIDER the
-- seam is inert and this table stays empty. Once configured:
--   * status='litigator'  — always blocks outbound SMS, even with consent.
--   * status='dnc_listed' — blocks unless the lead has express TCPA consent.
--   * scrub errors are never cached; fail-closed for lead-matched marketing
--     sends, fail-open for unmatched/transactional traffic.
--
-- Rows carry expires_at because DNC lists require periodic re-scrub (the
-- federal SAN convention is every 31 days; default TTL 30 days).
--
-- Composite index leads with organization_id (Tahoe shard-readiness —
-- scripts/check-org-leading-index.mjs).
--
-- Mirrors shared/schema.ts (dncScrubResults) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "dnc_scrub_results" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- Normalized digits (last 10, US-centric) — matches the lead-matching
  -- convention in smsService.tcpaGateForRecipient.
  "phone_last10" text NOT NULL,
  -- "clean" | "dnc_listed" | "litigator". Errors are never cached.
  "status" text NOT NULL,
  -- Which vendor adapter produced the result ("fixture" | vendor name).
  "provider" text NOT NULL,
  "list_source" text,
  "reason" text,
  "scrubbed_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "dnc_scrub_results_org_phone_idx"
  ON "dnc_scrub_results" ("organization_id", "phone_last10", "scrubbed_at");
