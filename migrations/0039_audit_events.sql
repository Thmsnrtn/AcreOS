-- Coriander §1: Recovery-console audit trail.
-- Append-only event log for high-risk admin recovery operations (2FA reset,
-- session revoke, ownership transfer, autopay freeze, password-reset link).
-- Distinct from the org-scoped audit_log table: audit_events is platform-
-- wide, founder-driven, and may have no owning organization (cross-org
-- ownership transfers, account-wide 2FA resets, etc.).
--
-- Retention: 7 years (legal). No deletes. Append-only.

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   TEXT,                                  -- Clerk userId of admin
  actor_email     TEXT,                                  -- founder email at action time
  action          TEXT NOT NULL,                         -- e.g. "recovery.2fa_reset"
  target_type     TEXT NOT NULL,                         -- "user" | "organization" | "session"
  target_id       TEXT NOT NULL,                         -- target user id, org id, session id
  justification   TEXT,                                  -- founder-supplied rationale
  metadata        JSONB,                                 -- proof refs, request body, Clerk responses
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
