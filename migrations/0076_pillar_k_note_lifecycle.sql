-- Pillar K — note-investor persona insights: reperforming progress +
-- compliance posture cache on acquired_notes.
--
-- See docs/exhaustive-completion/pillar-k-note-investors-25-personas.md
-- for the persona insights driving these columns. Three additions:
--   * consecutive_on_time_payments        — INT, default 0
--   * reperforming_threshold_met          — BOOL, default false
--   * compliance_posture_json             — JSONB, nullable (cache of
--                                            shared/regulatory/rmloAdvisor.ts)
--
-- All three are additive — no data migration, no destructive change.

ALTER TABLE acquired_notes
  ADD COLUMN IF NOT EXISTS consecutive_on_time_payments INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reperforming_threshold_met BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_posture_json JSONB;
