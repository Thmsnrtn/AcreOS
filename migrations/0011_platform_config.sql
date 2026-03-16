-- Migration: Add platform_config table for encrypted founder credential storage
-- Credentials are AES-256-GCM encrypted before storage; configManager patches
-- process.env at startup so all existing code picks them up automatically.

CREATE TABLE IF NOT EXISTS "platform_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "encrypted_value" text,
  "service" text NOT NULL,
  "label" text NOT NULL,
  "is_secret" boolean NOT NULL DEFAULT true,
  "is_required" boolean NOT NULL DEFAULT false,
  "validated_at" timestamp,
  "validation_status" text,
  "validation_message" text,
  "updated_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_config_key_idx" ON "platform_config" ("key");
CREATE INDEX IF NOT EXISTS "platform_config_service_idx" ON "platform_config" ("service");
