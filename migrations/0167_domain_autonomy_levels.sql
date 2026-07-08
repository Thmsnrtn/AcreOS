-- 0167 — Founder Autopilot: per-domain earned-autonomy (the Trust Ledger)
--
-- One row per founder-ops domain (growth/support/deploy/ops/finance). Tracks
-- the domain's autonomy level (observe → draft → execute_gated →
-- autonomous_gated) and its clean-cycle progress toward promotion. Global, not
-- org-scoped — this is AcreOS governing its OWN operations. Additive +
-- idempotent. Rows are seeded at the safe default (observe) by
-- ensureDomainsSeeded() at runtime.

CREATE TABLE IF NOT EXISTS "domain_autonomy_levels" (
  "id"                   serial PRIMARY KEY,
  "domain"               text NOT NULL UNIQUE,
  "level"                text NOT NULL DEFAULT 'observe',
  "clean_cycle_count"    integer NOT NULL DEFAULT 0,
  "last_promoted_at"     timestamp,
  "last_demoted_at"      timestamp,
  "last_demotion_reason" text,
  "updated_at"           timestamp DEFAULT now()
);
