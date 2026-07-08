-- 0155 — Tier 2D (elevation blueprint, 2026-06-10): close the self-improvement loops.
--
-- 1) support_resolver_threshold_adjustments — the bounded, audited threshold-offset
--    trail for the Pax support auto-resolve calibration grader. When the daily
--    grader detects calibration drift (Brier >= 0.3 on the labeled autonomous
--    support path) it records a domain-audit finding AND nudges the auto-resolve
--    confidence threshold upward by a bounded step; recovery steps it back down.
--    Every adjustment (raise or lower, including clamped saturations) is a row here.
--    Platform-level (one autonomous path), so no organization_id.
--    Deliberately DISTINCT from any Tier 2A `model_calibration_log` (LCS
--    calibrator weights) — different loop, different consumers; they coexist.
--
-- 2) solene_failure_modes.status + source_incident_id — incident resolutions
--    carrying lessonsLearned auto-draft a failure-mode entry with
--    status='draft'. Drafts are NEVER auto-published: the dispatch preamble
--    reads the disk ledger (docs/internal/failure-modes/), so a draft only
--    reaches agents after a human promotes it to a disk entry. source_incident_id
--    makes the auto-draft idempotent per incident.

CREATE TABLE IF NOT EXISTS "support_resolver_threshold_adjustments" (
  "id" serial PRIMARY KEY,
  "surface" text NOT NULL DEFAULT 'support_resolve',
  "previous_offset" integer NOT NULL,
  "new_offset" integer NOT NULL,
  "direction" text NOT NULL,
  "reason" text NOT NULL,
  "brier_score" numeric(6,4),
  "overconfidence_bias" numeric(6,2),
  "graded_decisions" integer NOT NULL DEFAULT 0,
  "clamped" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "srta_surface_created_idx"
  ON "support_resolver_threshold_adjustments" ("surface", "created_at");

ALTER TABLE "solene_failure_modes"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'published';
ALTER TABLE "solene_failure_modes"
  ADD COLUMN IF NOT EXISTS "source_incident_id" text;

CREATE INDEX IF NOT EXISTS "solene_failure_modes_status_idx"
  ON "solene_failure_modes" ("status");
