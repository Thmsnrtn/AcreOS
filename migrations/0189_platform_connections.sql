-- 0189 — Platform Connections (native connect-an-account infra).
-- Founder-entered credentials for the accounts the platform itself runs on,
-- resolved DB-first with env fallback so a pasted key works without a
-- redeploy. Secrets are AES-256-GCM envelopes in bytea (never TEXT);
-- non-secret config (topics, repo slugs, emails) lives in value_plain.
-- At most one ACTIVE row per (provider, field). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "platform_connections" (
  "id" serial PRIMARY KEY,
  "provider" text NOT NULL,
  "field" text NOT NULL,
  "secret_encrypted" bytea,
  "value_plain" text,
  "fingerprint" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "platform_connections_provider_idx"
  ON "platform_connections" ("provider", "field");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_connections_active_uidx"
  ON "platform_connections" ("provider", "field") WHERE "revoked_at" IS NULL;
