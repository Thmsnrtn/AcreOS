-- 0287 — D1 data-sourcing foundation (bucket-independent parts).
--
-- A3 demand events: a provider_lookup_log row with an organization is that
-- org's demand event. These three columns complete its shape (intent class,
-- answering layer, confidence served); org/geography/latency/cost were
-- already there. Shape: shared/openData/demandEvent.ts.
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "intent_class" text;
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "answering_layer" text;
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "confidence_served" real;
CREATE INDEX IF NOT EXISTS "provider_lookup_org_demand_idx" ON "provider_lookup_log" ("organization_id", "created_at");

-- A4 history: what a run OBSERVED, written once when the run completes. A run
-- row is never updated after completion, so the rows of one job ordered by
-- started_at are an append-only series — for the statewide metadata poller,
-- every source's (lastEditDate, row count, ETag, fetched-at) from its first run.
ALTER TABLE "etl_runs" ADD COLUMN IF NOT EXISTS "observation" jsonb;

-- D1c: the statewide-layer change-detection poller (metadata only, no
-- re-ingest). Seeded INACTIVE: arming it starts outbound polling of nine
-- state GIS servers, which is a deliberate switch, not a side effect of a
-- deploy. '*/1440' is the orchestrator's daily cadence (intervalMsFromCron).
-- D1b: the Florida statewide cadastral build. Seeded INACTIVE and dry-run
-- only: no bucket is provisioned (founder decision), so it builds artifacts
-- locally and never claims "ingested".
INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing", "config")
VALUES
  ('statewide_layer_metadata_v1', 'statewide_layer_metadata_v1', NULL, 'lastEditDate', '*/1440 * * * *', false, false, '{}'::jsonb),
  ('fl_statewide_cadastral_v1', 'fl_statewide_cadastral_v1', 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0', NULL, '*/1440 * * * *', false, false, '{"dryRun": true}'::jsonb)
ON CONFLICT ("job_name") DO NOTHING;
