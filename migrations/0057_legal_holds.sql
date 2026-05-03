-- Phase 3 Week 11 — Legal-hold mechanism (Saskia, Lazlo, Margolis).
--
-- FRCP 37(e) requires that data NOT be deleted by retention policies once
-- litigation is reasonably anticipated. AcreOS has automatic retention paths
-- (server/storage.ts purgeOld* + soft-delete -> permadelete sweepers) that
-- would otherwise destroy evidence. This table is the authoritative record of
-- which orgs / leads / properties / users are under hold.
--
-- Semantics:
--   * `scope = 'org_wide'`              — every row owned by organizationId is preserved.
--   * `scope = 'lead_specific'`         — rows in scope_ids (lead ids) are preserved.
--   * `scope = 'property_specific'`     — rows in scope_ids (property ids) are preserved.
--   * `scope = 'user_specific'`         — rows authored by users in scope_ids are preserved.
--
-- A hold is "active" when status='active' AND released_at IS NULL.

CREATE TABLE IF NOT EXISTS legal_holds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_ref         TEXT NOT NULL,        -- court docket # / internal ticket / matter #
  scope            TEXT NOT NULL,        -- org_wide | lead_specific | property_specific | user_specific
  scope_ids        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  placed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  placed_by        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  released_at      TIMESTAMPTZ,
  release_reason   TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'active',  -- active | released
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT legal_holds_scope_chk CHECK (scope IN ('org_wide','lead_specific','property_specific','user_specific')),
  CONSTRAINT legal_holds_status_chk CHECK (status IN ('active','released'))
);

-- Hot-path index: every delete-blocker call queries by (organizationId, status='active').
CREATE INDEX IF NOT EXISTS idx_legal_holds_org_active
  ON legal_holds (organization_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_legal_holds_status ON legal_holds(status);
CREATE INDEX IF NOT EXISTS idx_legal_holds_placed_at ON legal_holds(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_holds_case_ref ON legal_holds(case_ref);

-- GIN index for scope_ids contains-checks (lead_specific / property_specific / user_specific).
CREATE INDEX IF NOT EXISTS idx_legal_holds_scope_ids
  ON legal_holds
  USING GIN (scope_ids);
