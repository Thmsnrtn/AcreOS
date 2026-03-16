-- Task #4: Add GIN indexes for PostgreSQL full-text search (tsvector)
-- Accelerates the fullTextSearch service which uses to_tsvector('english', ...)
-- GIN (Generalized Inverted Index) is the recommended index type for tsvector.
-- Using expression indexes so no schema change is needed — Postgres computes
-- the tsvector at index build time and caches it for subsequent queries.

-- ── Leads FTS index ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "leads_fts_idx"
  ON "leads" USING GIN (
    to_tsvector('english',
      COALESCE("first_name", '') || ' ' ||
      COALESCE("last_name", '') || ' ' ||
      COALESCE("email", '') || ' ' ||
      COALESCE("phone", '') || ' ' ||
      COALESCE("address", '') || ' ' ||
      COALESCE("city", '') || ' ' ||
      COALESCE("notes", '')
    )
  );

-- ── Properties FTS index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "properties_fts_idx"
  ON "properties" USING GIN (
    to_tsvector('english',
      COALESCE("address", '') || ' ' ||
      COALESCE("city", '') || ' ' ||
      COALESCE("state", '') || ' ' ||
      COALESCE("zip_code", '') || ' ' ||
      COALESCE("notes", '')
    )
  );

-- ── Deals FTS index ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "deals_fts_idx"
  ON "deals" USING GIN (
    to_tsvector('english',
      COALESCE("title", '') || ' ' ||
      COALESCE("notes", '')
    )
  );

-- ── Support tickets FTS index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "support_tickets_fts_idx"
  ON "support_tickets" USING GIN (
    to_tsvector('english',
      COALESCE("subject", '') || ' ' ||
      COALESCE("description", '')
    )
  );
