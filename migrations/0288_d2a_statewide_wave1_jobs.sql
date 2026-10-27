-- 0288 — D2a bulk wave 1: one streamed statewide cadastral build per seeded
-- wave-1 state (server/services/landData/statewideCadastral.ts; FL's job is
-- D1's fl_statewide_cadastral_v1, seeded by 0287).
--
-- Seeded INACTIVE with an empty config: a run must name the live layer's
-- county field and value (config.countyField / countyValue), and those field
-- names are read from each layer's own metadata at activation, never guessed
-- here. With the bucket live, a run still uploads nothing until its state's
-- dossier resolves all four use classes (statewideSourceRegistry.ts) — today
-- every one is unresolved, so every run is a dry run with its reasons stated.
-- IN and OH (wave 1) have no verified statewide layer and therefore no job.
INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing", "config")
VALUES
  ('nc_statewide_cadastral_v1', 'nc_statewide_cadastral_v1', 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1', NULL, '*/1440 * * * *', false, false, '{}'::jsonb),
  ('wi_statewide_cadastral_v1', 'wi_statewide_cadastral_v1', 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0', NULL, '*/1440 * * * *', false, false, '{}'::jsonb),
  ('ar_statewide_cadastral_v1', 'ar_statewide_cadastral_v1', 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6', NULL, '*/1440 * * * *', false, false, '{}'::jsonb),
  ('mt_statewide_cadastral_v1', 'mt_statewide_cadastral_v1', 'https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0', NULL, '*/1440 * * * *', false, false, '{}'::jsonb)
ON CONFLICT ("job_name") DO NOTHING;
