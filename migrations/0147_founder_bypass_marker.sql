-- 0147_founder_bypass_marker.sql
-- ============================================================================
-- QUINN (Chief of Alignment) — close the founder-bypass accountability loop.
--
-- The public /transparency report publishes `founderBypassCount`, previously
-- computed by regex-matching solene_pre_call_decisions.reasoning for
-- 'founder.bypass|founder.override|sovereign.veto'. NOTHING ever wrote those
-- markers into that column, so the published count was structurally,
-- permanently 0 — a false accountability metric. The founder-bypass alignment
-- detector read the same dead marker and could never fire.
--
-- This migration adds an explicit boolean marker that the real founder-bypass
-- write path (founderBypass.founderDispatch) now sets, plus the founder's
-- stated reason. The transparency count + the alignment detector are retargeted
-- onto this column. It is only ever TRUE on a real founder bypass — never
-- inflated.
-- ============================================================================

ALTER TABLE "solene_pre_call_decisions"
  ADD COLUMN IF NOT EXISTS "is_founder_bypass" boolean NOT NULL DEFAULT false;

ALTER TABLE "solene_pre_call_decisions"
  ADD COLUMN IF NOT EXISTS "founder_bypass_reason" text;

CREATE INDEX IF NOT EXISTS "solene_pre_call_decisions_founder_bypass_idx"
  ON "solene_pre_call_decisions" ("is_founder_bypass", "decided_at");
