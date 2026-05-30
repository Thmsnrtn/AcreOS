-- ============================================================================
-- 0102_org_underwriting_defaults.sql — per-org underwriting defaults.
-- ============================================================================
--
-- blindOfferCalculator.ts hardcoded owner-finance defaults to 9% APR / 84
-- months. The Texas land standard (and Hank's actual book of 70 notes) is
-- 9.9% / 120 months / 20% down / no balloon. Hardcoding meant every blind
-- offer's projected cash-flow was ~30% off for the operators who actually
-- write owner-finance paper.
--
-- This adds a single jsonb column on organizations so the per-org defaults
-- can be set from Settings → Underwriting and read on every offer build.
-- Null is treated as "use the legacy hardcoded defaults" so existing rows
-- keep their current behavior until they explicitly opt in.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS underwriting_defaults jsonb;
