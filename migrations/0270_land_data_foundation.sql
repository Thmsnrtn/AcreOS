-- 0270 — W2 land-data foundation (Tennessee showcase).
-- Global infrastructure tables (no organization_id): owned public-record
-- parcels and derived facts are shared across orgs, like county_gis_endpoints.
-- Mirrors shared/schema/land-data.ts and the matching block in
-- scripts/migrate.mjs. Idempotent.
CREATE TABLE IF NOT EXISTS "county_parcel_jobs" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "refusal_reason" text,
  "demand_count" integer NOT NULL DEFAULT 1,
  "source_endpoint_id" integer,
  "source_url" text,
  "next_offset" integer NOT NULL DEFAULT 0,
  "parcels_stored" integer NOT NULL DEFAULT 0,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "county_parcel_jobs_state_county_uidx" ON "county_parcel_jobs" ("state", "county");
CREATE INDEX IF NOT EXISTS "county_parcel_jobs_status_demand_idx" ON "county_parcel_jobs" ("status", "demand_count");

CREATE TABLE IF NOT EXISTS "owned_parcels" (
  "id" serial PRIMARY KEY,
  "parcel_key" text NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "county_fips" text,
  "source_parcel_id" text NOT NULL,
  "source_name" text NOT NULL,
  "source_url" text NOT NULL,
  "retrieved_at" timestamp NOT NULL,
  "geometry" jsonb NOT NULL,
  "centroid_lng" double precision NOT NULL,
  "centroid_lat" double precision NOT NULL,
  "gis_acres" double precision NOT NULL,
  "deeded_acres" double precision,
  "attributes" jsonb,
  "facts" jsonb,
  "facts_computed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "owned_parcels_parcel_key_uidx" ON "owned_parcels" ("parcel_key");
CREATE INDEX IF NOT EXISTS "owned_parcels_state_county_idx" ON "owned_parcels" ("state", "county");
CREATE INDEX IF NOT EXISTS "owned_parcels_source_id_idx" ON "owned_parcels" ("state", "county", "source_parcel_id");

CREATE TABLE IF NOT EXISTS "parcel_id_crosswalk" (
  "id" serial PRIMARY KEY,
  "parcel_key" text NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "source_parcel_id" text NOT NULL,
  "first_seen_at" timestamp NOT NULL,
  "last_seen_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_id_crosswalk_uidx" ON "parcel_id_crosswalk" ("state", "county", "source_parcel_id", "parcel_key");
CREATE INDEX IF NOT EXISTS "parcel_id_crosswalk_key_idx" ON "parcel_id_crosswalk" ("parcel_key");

CREATE TABLE IF NOT EXISTS "open_data_ingest_receipts" (
  "id" serial PRIMARY KEY,
  "corpus_key" text NOT NULL,
  "object_key" text NOT NULL,
  "bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "etag" text,
  "uploaded_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "open_data_ingest_receipts_object_uidx" ON "open_data_ingest_receipts" ("object_key", "sha256");
CREATE INDEX IF NOT EXISTS "open_data_ingest_receipts_corpus_idx" ON "open_data_ingest_receipts" ("corpus_key");
