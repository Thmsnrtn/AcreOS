-- Phase 3 Week 7-8 (P2-11): enable Postgres extensions we'll lean on
-- across the founder/agent stack. All CREATE EXTENSION IF NOT EXISTS so
-- this migration is idempotent and additive.
--
--  • pgvector            — embedding storage + ANN search. Sayuri-Vatanen
--                          will use it for semantic recall (lead/property
--                          similarity, agent memory, RAG over notes).
--  • pg_trgm             — trigram-based fuzzy text matching. Anaïs uses
--                          it for typo-tolerant search across leads,
--                          properties, and contacts (`ILIKE` over indexed
--                          trigrams beats sequential scan by 10-100×).
--  • pg_stat_statements  — query-level performance telemetry. Required
--                          input for the next index audit pass and for
--                          the post-pgBouncer rollout dashboard.
--
-- pgvector and pg_trgm are extension-only (no schema change here). We'll
-- add concrete indexes (e.g. `USING gin(name gin_trgm_ops)`) in follow-up
-- migrations once individual call-sites are ready to consume them.
--
-- pg_stat_statements requires `shared_preload_libraries` to include it on
-- the Postgres server. On Fly.io managed Postgres this is the default.
-- If you're running this against a Postgres that doesn't preload the
-- library, the CREATE EXTENSION will succeed but the view will be empty
-- until the server is restarted with the library loaded.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
