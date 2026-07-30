-- ============================================================================
-- 0215 — ach_mandates.authorization_challenge_id
-- CodeQL HIGH remediation, PR #259: "User-controlled bypass of security check"
-- at POST /api/borrower/autopay/mandate (2026-07-30)
-- ----------------------------------------------------------------------------
-- Creating a NACHA ACH debit authorization was gated on
-- `body.authorizationAccepted === true`, cross-checked against an echo of the
-- authorization text the client claimed to have displayed. Both are values the
-- CLIENT supplies, so a scripted or buggy portal could assert a consent no
-- human ever gave. For a record whose only job is to prove, in an R10
-- unauthorized-debit dispute, that this borrower saw this language and agreed
-- to it, "the client said so" is the wrong evidentiary standard.
--
-- The read endpoint that renders the authorization text
-- (GET /api/borrower/autopay) now also mints a short-lived HMAC-signed
-- challenge bound to (borrower session id, note id, authorization text
-- version) with a random single-use id. The mandate POST must present it, and
-- the id it redeemed lands in this column.
--
-- Two properties come from this one column:
--   1. PROVENANCE — the mandate row itself attests that the SERVER served that
--      exact authorization version to that session moments earlier, alongside
--      the client-side artifacts (echoed text, accepted flag) it already kept.
--   2. SINGLE USE — the UNIQUE index below IS the guard. A replayed challenge
--      loses the INSERT rather than minting a second authorization, the same
--      way ach_debit_attempts_period_uidx is the double-charge guard.
--
-- Nullable on purpose: mandates created before this gate legitimately have no
-- challenge, and NULLs do not collide in a Postgres unique index.
--
-- No new table — the challenge needs no storage of its own. It is signed, not
-- persisted, and its consumption is recorded on the artifact it produces, so
-- there are no challenge rows to expire and no cleanup job. Table count is
-- unchanged (scripts/ratchets/table-count.json stays at 753).
--
-- Mirrors shared/schema/ach-autopay.ts. Registered in scripts/migrate.mjs.
-- ============================================================================

ALTER TABLE "ach_mandates"
  ADD COLUMN IF NOT EXISTS "authorization_challenge_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "ach_mandates_authorization_challenge_uidx"
  ON "ach_mandates" ("authorization_challenge_id");
