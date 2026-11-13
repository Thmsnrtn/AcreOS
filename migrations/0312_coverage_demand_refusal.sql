-- 0312 — P1-7 / A-2: gate-refusal demand wiring.
--
-- Demand capture existed (0125) but a statewide-gate refusal wrote no demand
-- artefact: gated refusals were indistinguishable from not-found downstream.
-- This migration adds the refusal context the wiring records:
--
--   1. county_coverage_requests.surface / .reason — which product surface an
--      explicit "request this county" came from (maps | parcel_lookup | pax |
--      passport | …) and the refusal reason that prompted it (gated |
--      no_endpoint | no_key | not_found). The two columns A-2 prescribes.
--   2. county_discovery_queue.last_refusal_reason — the most recent refusal
--      reason that bumped this county's demand, so the founder demand view
--      can rank gate-refusal demand separately from search-sourced demand.
--
-- All additive + idempotent; no table added, no existing column touched.

ALTER TABLE "county_coverage_requests" ADD COLUMN IF NOT EXISTS "surface" text;
ALTER TABLE "county_coverage_requests" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "last_refusal_reason" text;
