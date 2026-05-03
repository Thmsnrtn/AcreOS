-- Phase 3 Week 14 (Anaïs §2): accent-folding for search
-- Enables `unaccent()` so a query for "cafe" matches stored "café",
-- "Anais" matches "Anaïs", "Sao Paulo" matches "São Paulo", etc.
--
-- The Anaïs fuzzy-search service applies unaccent() at query and index
-- build time. We do not rebuild the existing tsvector GIN indexes here
-- (those use to_tsvector('english', ...) directly); instead the search
-- service applies unaccent() at call time. A separate migration can swap
-- the GIN expression to `to_tsvector('english', unaccent(coalesce(...)))`
-- once we have a quiet window for CONCURRENTLY rebuilds.
--
-- IMMUTABLE wrapper: Postgres tsvector indexes require IMMUTABLE inputs.
-- Stock unaccent() is STABLE because the dictionary lives on disk; we
-- wrap it in a SQL function declared IMMUTABLE so it can be used inside
-- expression indexes without changing planner semantics.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE wrapper used by tsvector expression indexes.
CREATE OR REPLACE FUNCTION public.acreos_unaccent_immutable(text)
RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
