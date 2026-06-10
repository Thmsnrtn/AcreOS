-- 0156 — Tier 3A (elevation blueprint, 2026-06-10) — public parcel reports.
-- Saved, shareable /p/:state/:county/:apn permalinks: free/government-data
-- parcel facts + the honest PARTIAL Land Credit Score (locked dimensions carry
-- NULL scores in the lcs jsonb — never invented values). The row IS the cache:
-- a popular permalink is one DB read, and the sitemap only lists rows that
-- actually exist (no fabricated coverage). No org linkage by design — these
-- are pre-signup acquisition surfaces. All statements idempotent.

CREATE TABLE IF NOT EXISTS "public_parcel_reports" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,
  "county_slug" text NOT NULL,
  "county_label" text NOT NULL,
  "apn" text NOT NULL,
  "apn_key" text NOT NULL,
  "facts" jsonb NOT NULL,
  "lcs" jsonb NOT NULL,
  "latitude" real,
  "longitude" real,
  "view_count" integer NOT NULL DEFAULT 0,
  "last_viewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_parcel_reports_identity_uq"
  ON "public_parcel_reports" ("state", "county_slug", "apn_key");

CREATE INDEX IF NOT EXISTS "public_parcel_reports_created_idx"
  ON "public_parcel_reports" ("created_at");

CREATE INDEX IF NOT EXISTS "public_parcel_reports_refreshed_idx"
  ON "public_parcel_reports" ("refreshed_at");
