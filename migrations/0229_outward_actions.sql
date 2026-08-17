-- ============================================================================
-- 0229_outward_actions.sql — the consequential-action claim ledger.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `outward_actions` — one row per logical consequential action, keyed
-- (organization_id, action_kind, idempotency_key) under a UNIQUE index. The
-- atomic `INSERT ... ON CONFLICT DO NOTHING` against that index is what makes
-- two concurrent workers unable to both call a provider.
--
-- WHY
-- ───
-- Canonical law 8 and BI74: idempotency belongs at the ACTION/PROVIDER
-- boundary, not at the HTTP request. server/middleware/idempotency.ts is
-- request-scoped (an Idempotency-Key header, 24h TTL, in-memory fallback) and
-- protects a client retrying a POST. It does nothing for the case that costs
-- money: a background JOB retrying after a partial success, which never passes
-- through an HTTP request at all.
--
-- The concrete defect: directMailService.sendLetter() deducts credits, posts
-- the piece cost to the ledger, and calls Lob. If the process dies after Lob
-- accepted the letter but before the result was recorded, the retry deducts
-- credits AGAIN, posts cost AGAIN, and prints a SECOND physical letter to a
-- real seller. preMailDedupe.ts does not catch this — it is an AUDIENCE policy
-- (don't mail your own parcel, don't re-mail within 90 days), not retry safety.
--
-- MUTABLE, DELIBERATELY
-- ─────────────────────
-- Unlike evidence_claims and decision_snapshots — which are HISTORY and never
-- change — this is OPERATIONAL STATE: claimed, then succeeded / failed /
-- ambiguous. BI76 is explicit that audit events, decision snapshots, action
-- receipts and outcomes are different things that must not collapse into one
-- log. This is the idempotency CLAIM; the immutable proof is a receipt
-- (server/services/autopilot/proofReceipt.ts), a separate artifact.
--
-- THE 'ambiguous' STATUS IS THE POINT
-- ───────────────────────────────────
-- AU28: a provider timeout AFTER the request left is neither success nor
-- failure. Most implementations treat it as failure and retry, which is exactly
-- how a double-send happens. Here it is terminal and REFUSES further attempts
-- until reconciliation — the system stops and asks rather than guessing with
-- someone else's money.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent. This table exists to
-- stop money being spent twice.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/outward-actions.ts. Registered in scripts/migrate.mjs.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "outward_actions" (
  "id"               serial PRIMARY KEY,
  "organization_id"  integer NOT NULL
                       REFERENCES "organizations"("id") ON DELETE CASCADE,
  "action_kind"      text NOT NULL,
  "idempotency_key"  text NOT NULL,
  "request_hash"     text NOT NULL,
  "status"           text NOT NULL DEFAULT 'in_flight',
  "external_id"      text,
  "attempts"         integer NOT NULL DEFAULT 1,
  "last_error"       text,
  "claimed_at"       timestamp NOT NULL DEFAULT now(),
  "completed_at"     timestamp
);

-- THE load-bearing constraint: the atomic claim. Org-LEADING, which also
-- satisfies the shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE UNIQUE INDEX IF NOT EXISTS "outward_actions_org_kind_key_uk"
  ON "outward_actions" ("organization_id", "action_kind", "idempotency_key");

-- Reconciliation sweep: "every ambiguous action, oldest first".
CREATE INDEX IF NOT EXISTS "outward_actions_org_status_idx"
  ON "outward_actions" ("organization_id", "status", "claimed_at");
