-- 0191 — Data-API key hardening (roadmap W1.6, 2026-07 security audit).
-- Partner keys were minted with Math.random() and stored/compared plaintext.
-- key_hash (SHA-256 hex) becomes the only long-term credential at rest;
-- key_last4 is the display stub. Legacy plaintext rows upgrade on first
-- successful auth (hash written, api_key nulled). Additive + idempotent.
ALTER TABLE "system_api_keys" ADD COLUMN IF NOT EXISTS "key_hash" text;
ALTER TABLE "system_api_keys" ADD COLUMN IF NOT EXISTS "key_last4" text;
CREATE INDEX IF NOT EXISTS "system_api_keys_key_hash_idx"
  ON "system_api_keys" ("key_hash");
