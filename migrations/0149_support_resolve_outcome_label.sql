-- 0149 — Andrei (AI/ML) — close the calibration loop on the autonomous support resolver.
--
-- server/ai/paxSupportResolver.ts auto-resolves a customer-facing support ticket
-- when the MODEL'S SELF-REPORTED confidence_score clears a static threshold
-- (60/70/90). That confidence is written to support_tickets.ai_confidence_score,
-- but NOTHING ever read it back against an outcome — so Pax could auto-send a
-- wrong answer at "70% confidence" forever and calibration never learned.
--
-- These two columns are the outcome LABEL that closes the loop:
--   ai_resolution_outcome  — null while the auto-resolve decision stands
--     unobserved, then one of:
--        'held'          — stayed resolved / not contradicted
--        'reopened'      — the customer posted again on an auto-resolved ticket
--                          (the answer didn't land)
--        'csat_negative' — the customer rated the resolution ≤2★ / thumbs-down
--   ai_resolution_reopened — convenience bool mirroring the reopen case for fast
--     filtering. (reopened OR csat_negative) == "the auto-resolve was corrected",
--     the label the Brier/calibration job needs.
--
-- Set by gradeAutoResolvedTicket() (server/services/andrei/supportResolverCalibration.ts),
-- called from the reopen/CSAT handlers + a daily grader job. This is
-- INSTRUMENTATION ONLY — Pax's live auto-resolve threshold is unchanged; we only
-- record the outcome so the data to govern that threshold later exists.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Mirrored into scripts/migrate.mjs.

ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "ai_resolution_outcome" text;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "ai_resolution_reopened" boolean DEFAULT false;

-- Partial index over the autonomous-resolve path: the calibration query only
-- ever scans AI-handled tickets that carry a confidence score, so index that
-- slice for the daily grader's Brier computation.
CREATE INDEX IF NOT EXISTS "support_tickets_ai_resolve_outcome_idx"
  ON "support_tickets" ("ai_resolution_outcome")
  WHERE "ai_handled" = true AND "ai_confidence_score" IS NOT NULL;
