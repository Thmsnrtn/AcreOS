-- 0186 — Persisted WitnessGrants (step-away gap #5).
-- Founder-issued, bounded, expiring, revocable delegation of the witnessed-send
-- tap to a named principal. deny_money / deny_broadcast DEFAULT TRUE — a grant
-- covers money or broadcasts only by explicit founder opt-in. used_count is
-- consumed atomically so the action budget is real under concurrency.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "witness_grants" (
  "id" serial PRIMARY KEY,
  "grantor_id" text NOT NULL,
  "grantee_id" text NOT NULL,
  "domains" jsonb NOT NULL DEFAULT '[]',
  "max_cost_usd" numeric(10,2) NOT NULL,
  "max_actions" integer NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "deny_money" boolean NOT NULL DEFAULT true,
  "deny_broadcast" boolean NOT NULL DEFAULT true,
  "used_count" integer NOT NULL DEFAULT 0,
  "revoked" boolean NOT NULL DEFAULT false,
  "revoked_at" timestamptz,
  "revoke_reason" text,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "note" text
);
CREATE INDEX IF NOT EXISTS "witness_grants_grantee_idx"
  ON "witness_grants" ("grantee_id", "revoked", "expires_at");
CREATE INDEX IF NOT EXISTS "witness_grants_issued_idx"
  ON "witness_grants" ("issued_at");
