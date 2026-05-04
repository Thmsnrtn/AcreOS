-- ============================================================================
-- 0067 — Property Vision Snapshots (Ingrid §1)
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- Phase 8 Months 10-11 introduces scheduled vision-AI re-imaging for every
-- property under management. The job (server/jobs/propertyVisionReimaging.ts)
-- pulls fresh aerial imagery on a configurable cadence (default 90 days),
-- runs vision analysis, compares to the prior snapshot, and raises a
-- system_alert when the change-detection score crosses the threshold.
--
-- This table is intentionally distinct from `satellite_snapshots`:
--   • satellite_snapshots is the raw imagery feed (existing)
--   • property_vision_snapshots is the vision-AI scheduled run history,
--     keyed to the property's re-imaging cadence with per-row alert state.
--
-- The migration is additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS property_vision_snapshots (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL
    REFERENCES properties(id) ON DELETE CASCADE,

  -- Capture metadata
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  image_s3_key TEXT NOT NULL,
  image_url TEXT,
  provider TEXT,
  resolution NUMERIC,

  -- Vision-AI analysis result (free-form jsonb keyed by detector module)
  analysis_jsonb JSONB,

  -- Change detection vs. prior snapshot for the same property
  prior_snapshot_id INTEGER,
  change_detection_score NUMERIC,
  change_summary TEXT,

  -- Alerting
  alerted_to_org BOOLEAN NOT NULL DEFAULT FALSE,
  system_alert_id INTEGER REFERENCES system_alerts(id) ON DELETE SET NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_vision_snapshots_org_idx
  ON property_vision_snapshots(organization_id);
CREATE INDEX IF NOT EXISTS property_vision_snapshots_property_idx
  ON property_vision_snapshots(property_id);
CREATE INDEX IF NOT EXISTS property_vision_snapshots_captured_idx
  ON property_vision_snapshots(captured_at);

COMMENT ON TABLE property_vision_snapshots IS
  'Scheduled vision-AI imagery snapshots per property; row-per-run with change-detection score and alert state.';
COMMENT ON COLUMN property_vision_snapshots.change_detection_score IS
  '0-100 score representing detected change from the prior snapshot. Threshold for alerting is configured via env VISION_CHANGE_ALERT_THRESHOLD (default 25).';
COMMENT ON COLUMN property_vision_snapshots.alerted_to_org IS
  'True once the corresponding system_alerts row has been created. Prevents duplicate alerts on retry.';
