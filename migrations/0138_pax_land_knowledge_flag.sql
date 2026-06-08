-- ============================================================================
-- 0138_pax_land_knowledge_flag.sql
-- ----------------------------------------------------------------------------
-- Andrei (Tahoe E5) — seed the founder-only feature flag that controls the
-- Pax land-expertise retrieval tool (retrieve_land_knowledge).
--
-- The land-knowledge cards are stored in the EXISTING generic pgvector
-- registry (solene_embedded_records, namespace 'land_knowledge',
-- organization_id IS NULL) — no new storage table is required, so this
-- migration only registers the rollout flag.
--
-- State 'founder-only': the tool is dark for customers until the retrieval-
-- recall eval is green and the founder flips it on. The runtime tool-list
-- builder additionally gates on the synchronous PAX_LAND_KNOWLEDGE_ENABLED
-- env flag (belt-and-suspenders, hot-path-cheap). Idempotent via ON CONFLICT.
--
-- Mirrored in scripts/migrate.mjs (the canonical apply path; this .sql file
-- documents the change and matches the migrations/ numbering convention).
-- ============================================================================

INSERT INTO "platform_feature_flags"
  ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
VALUES (
  'feature.pax-land-knowledge',
  'Pax land-knowledge retrieval',
  'Lets Pax retrieve curated, cited land-domain knowledge cards (FEMA flood zones, USDA soils/perc, seller-finance/usury mechanics, diligence traps) for explanatory turns. Distinct from parcel-fact lookups; every card carries a citation.',
  false,
  'founder-only',
  '{}'::jsonb,
  '[]'::jsonb
)
ON CONFLICT ("key") DO NOTHING;
