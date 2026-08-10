-- ============================================================================
-- 0229 — X-A slice 1: org trust-tier spine + borrower portal-link expiry
--        (handoff section E / Addendum A — abuse and bad-customer spine)
-- ----------------------------------------------------------------------------
-- COLUMNS ONLY on two existing tables — no new table.
--
-- 1) organizations.trust_tier ('new' | 'established' | 'trusted')
--    Every org starts 'new'. EXISTING orgs are seeded by a DETERMINISTIC rule
--    over real columns only — age (created_at), activity (last_active_at),
--    and standing (subscription_status, dunning_stage). No per-org numbers
--    are invented; the rule is pinned to FIXED timestamps (relative to this
--    migration's date, 2026-08-10) so re-running it — including via the
--    migrate.mjs mirror on every deploy — always produces the same result:
--      • the founder's own org        → 'trusted'  (already bypasses limits)
--      • ≥90 days old AND active in the 30 days before 2026-08-10 AND in
--        good standing                → 'established'
--      • everyone else               → 'new'
--    NO org is auto-seeded to 'trusted' except the founder's own — 'trusted'
--    is earned or founder-granted, and the promotion/demotion ladder is a
--    founder-queued decision (docs/proposals/x-a-send-chokepoint-caps.md).
--
-- 2) notes.access_token_expires_at
--    The borrower portal link (/portal/:accessToken) was non-expiring, and
--    pre-2026-06 tokens were minted with Math.random() (predictable). Every
--    EXISTING token-bearing note gets a 90-day sunset window from the first
--    run of this migration (the WHERE ... IS NULL guard makes re-runs no-op),
--    then the column DEFAULT gives every future note a 365-day link at mint.
--    NULL stays legal and means "no expiry recorded" (fail-open by design so
--    a pre-migration row can never be locked out by a code-only deploy).
--
-- MONEY POSTURE: records trust/expiry state; moves nothing.
-- ============================================================================

-- ── 1) org trust tier ───────────────────────────────────────────────────────
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trust_tier" text NOT NULL DEFAULT 'new';

-- Deterministic seed for orgs that existed before this migration. Fixed
-- timestamps (not now()) freeze the cohort on re-runs — the activity window
-- is CLOSED on both ends ([2026-07-11, 2026-08-10]) because last_active_at
-- only moves forward, so an org that becomes active AFTER the migration date
-- exits the window and can never be silently promoted by a later deploy
-- re-running this statement (fleet-6 verifier catch: an open-ended window
-- re-evaluated mutable columns and was a promotion side channel). Promotions
-- after this seed go through the founder-carded ladder only. The is_founder
-- branch still re-evaluates for orgs at 'new'; is_founder is set at org
-- creation and never granted later, so the branch is stable in practice.
--   2026-05-12 = 90 days before the migration date (age gate)
--   2026-07-11 = 30 days before the migration date (activity-window start)
--   2026-08-10 = the migration date (activity-window end)
-- An org with NULL created_at is untouched (no data → no trust).
UPDATE "organizations" SET "trust_tier" = CASE
  WHEN "is_founder" = true THEN 'trusted'
  WHEN "created_at" <= timestamp '2026-05-12'
   AND "last_active_at" IS NOT NULL
   AND "last_active_at" >= timestamp '2026-07-11'
   AND "last_active_at" <= timestamp '2026-08-10'
   AND "subscription_status" = 'active'
   AND COALESCE("dunning_stage", 'none') = 'none'
  THEN 'established'
  ELSE "trust_tier"
END
WHERE "trust_tier" = 'new'
  AND "created_at" IS NOT NULL
  AND "created_at" < timestamp '2026-08-10';

-- ── 2) borrower portal-link expiry ──────────────────────────────────────────
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp;

-- Legacy links: 90-day sunset window from the first run (re-runs no-op via
-- the IS NULL guard). Notes without a token keep NULL until one is minted.
UPDATE "notes" SET "access_token_expires_at" = now() + interval '90 days'
WHERE "access_token" IS NOT NULL
  AND "access_token_expires_at" IS NULL;

-- Future notes: the mint path (storage.createNote) inserts the token in the
-- same row, so the column default stamps a 365-day expiry at origination.
ALTER TABLE "notes" ALTER COLUMN "access_token_expires_at" SET DEFAULT (now() + interval '365 days');
