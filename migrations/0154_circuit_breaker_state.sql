-- 0154_circuit_breaker_state.sql
-- Tier 1G/1H (elevation blueprint 2026-06-10) — shared-state stores + job-runtime hardening.
--
-- circuit_breaker_state — the provider-registry circuit breaker (3 failures in
-- 5 min = open) held its trip state in process memory only. Every deploy reset
-- failure counts, so a hard-down provider got re-hammered with 3 fresh failures
-- per machine per deploy, and the 5-minute cooloff clock restarted from zero.
-- One row per provider persists the breaker across deploys/machines and records
-- the half-open probe claim: after the cooloff, exactly ONE request per process
-- transitions the breaker to 'half_open' and probes the provider; success
-- closes the breaker, failure re-trips it.
--
-- deadman_page_state — server/jobs/deadmanCheck.ts throttled re-pages via an
-- in-memory map (_lastPagedAt). A deploy mid-incident reset the throttle and
-- re-paged on-call for every still-dark job. One row per job persists the
-- last-paged timestamp across deploys.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS); self-contained block.

CREATE TABLE IF NOT EXISTS "circuit_breaker_state" (
  "provider_name" text PRIMARY KEY,
  "state" text NOT NULL DEFAULT 'closed',
  "failures" integer NOT NULL DEFAULT 0,
  "opened_at" timestamp,
  "last_failure_at" timestamp,
  "half_open_probe_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "deadman_page_state" (
  "job_name" text PRIMARY KEY,
  "last_paged_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
