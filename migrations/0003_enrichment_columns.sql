ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "enrichment_data" jsonb,
  ADD COLUMN IF NOT EXISTS "enrichment_status" text,
  ADD COLUMN IF NOT EXISTS "enriched_at" timestamp;
