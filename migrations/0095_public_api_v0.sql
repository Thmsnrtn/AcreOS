-- Public API v0 (Lens 50) — additive scaffold.
--
-- Backing tables for /api/v1/* (api_keys + usage log) and outbound webhooks
-- (webhook_subscriptions + webhook_delivery_log). The public surface is NOT
-- mounted in server/routes.ts yet — these tables exist so the design can be
-- reviewed end-to-end before flipping the feature on.

CREATE TABLE IF NOT EXISTS api_keys (
  id              SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  hashed_key      TEXT NOT NULL,
  scopes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit      INTEGER,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_by      TEXT NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  revoked_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx          ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx         ON api_keys(hashed_key);
CREATE INDEX IF NOT EXISTS api_keys_org_revoked_idx  ON api_keys(organization_id, revoked_at);

CREATE TABLE IF NOT EXISTS api_key_usage (
  id                 BIGSERIAL PRIMARY KEY,
  api_key_id         INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method             TEXT NOT NULL,
  path               TEXT NOT NULL,
  status_code        INTEGER NOT NULL,
  duration_ms        INTEGER NOT NULL,
  remote_addr_prefix TEXT,
  user_agent         TEXT,
  request_id         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_key_usage_key_created_idx ON api_key_usage(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS api_key_usage_org_created_idx ON api_key_usage(organization_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id                    SERIAL PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  events                JSONB NOT NULL DEFAULT '[]'::jsonb,
  signing_secret        TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  created_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_subs_org_idx        ON webhook_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS webhook_subs_org_active_idx ON webhook_subscriptions(organization_id, is_active);

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending',
  status_code     INTEGER,
  response_body   TEXT,
  error_message   TEXT,
  next_retry_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_log_sub_idx         ON webhook_delivery_log(subscription_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_event_idx       ON webhook_delivery_log(event_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_next_retry_idx  ON webhook_delivery_log(next_retry_at);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_org_created_idx ON webhook_delivery_log(organization_id, created_at);
