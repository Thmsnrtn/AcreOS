-- Pax Connector Instances: per-org connector/plugin configurations
CREATE TABLE IF NOT EXISTS "pax_connector_instances" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "connector_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'disconnected',
  "credentials_encrypted" text,
  "settings" jsonb,
  "last_tested_at" timestamp,
  "last_error_at" timestamp,
  "error_message" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pax_ci_org_idx" ON "pax_connector_instances" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pax_ci_connector_idx" ON "pax_connector_instances" ("organization_id", "connector_id");
