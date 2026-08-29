-- OD-9 "GRANTS FOR ALL" — seed the standing witness grant the founder ruled
-- for via the decision picker on 2026-08-29 (docs/autonomous/
-- OWNER_DECISIONS_PENDING.md, OD-9 DECIDED; stage-4 turn 5 of
-- docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md).
--
-- What this grant is: the release mechanism for agent emails migrating onto
-- the witnessed hands lane (turns 6-9). Grants are the machinery's native
-- granularity at the DOMAIN level, so this covers the "support" domain's
-- outward hands — send_email, send_sms, send_push — all movesMoney=false,
-- outwardClass=none. The conservative belts stay ON (deny_money,
-- deny_broadcast), so no money-moving or broadcast hand can ever ride this
-- grant; the $500 clamp, panic stop, counterparty hard-stop and suppression
-- checks all sit above it, and the founder can revoke it at any time from
-- Controls.
--
-- Budget: 300 actions over a 30-day TTL (~10/day across all covered
-- classes) — the "conservative starter" the ruling recorded; renewal after
-- expiry is a deliberate founder act, not an auto-renew.
--
-- Idempotent: the WHERE NOT EXISTS keys on the note's ruling tag, so a
-- re-run (or a replayed release command) seeds exactly one grant.
INSERT INTO witness_grants
  (grantor_id, grantee_id, domains, max_cost_usd, max_actions, expires_at,
   deny_money, deny_broadcast, note)
SELECT
  'founder (OD-9 picker ruling, 2026-08-29)',
  'solene',
  '["support"]'::jsonb,
  0.00,
  300,
  now() + interval '30 days',
  true,
  true,
  'OD-9 GRANTS-FOR-ALL: standing release for support-domain outward hands (email/SMS/push) as agent cadences migrate onto the witnessed lane. Seeded by migration 0240; revoke from Controls at any time. [od9-2026-08-29]'
WHERE NOT EXISTS (
  SELECT 1 FROM witness_grants WHERE note LIKE '%[od9-2026-08-29]%'
);
