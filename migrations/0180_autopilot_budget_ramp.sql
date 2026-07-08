-- 0180 — Autopilot budget ramp (the zero-capital compounding wire).
-- The founder-gated mechanism by which the company reinvests its first earned
-- dollars into its own growth budget. When proven CAC is healthy (real
-- attributed signups at an acceptable cost), the autopilot PROPOSES a budget
-- lift; on the founder's approval the new cap is written here and the live
-- envelope reads it. Never auto-spends; never feeds the learning loop.
--
--  - autopilot_settings.growth_budget_override_usd: the DB-backed monthly cap an
--    approved ramp writes. NULL → the env/charter default still governs. Clamped
--    to a hard ceiling at read-time so a bad value can never run away.
--  - autopilot_policy_proposals.target_value_usd: the proposed new cap carried on
--    a ramp_budget proposal row, applied verbatim on approval.
-- Additive + idempotent.

ALTER TABLE "autopilot_settings"
  ADD COLUMN IF NOT EXISTS "growth_budget_override_usd" double precision;

ALTER TABLE "autopilot_policy_proposals"
  ADD COLUMN IF NOT EXISTS "target_value_usd" double precision;
