-- ============================================================================
-- 0144 — Beatrice (CRO) — OFAC sanctions LIST ENTRIES (live cached copy)
--   Global reference table backing the advisory fuzzy name-matcher.
-- ----------------------------------------------------------------------------
-- The live, CLEARTEXT OFAC reference list that backs the advisory fuzzy
-- name-matcher (server/services/compliance/ofacScreening.ts). It is refreshed
-- DAILY from the public U.S. Treasury data files (the SDN list + the
-- Consolidated Sanctions list) by
-- server/services/compliance/sanctionsListSync.ts, which fetches Treasury's
-- published data files under https://www.treasury.gov/ofac/downloads/
-- (sdn.csv + consolidated.csv / sdn.xml), parses them, and UPSERTs here.
--
-- GLOBAL / COMPANY-WIDE reference table — intentionally NOT org-scoped:
--   * There is deliberately NO organization_id. This is the SAME public
--     Treasury list for every org, so there is no tenant to scope by and no
--     tenant to LEAD a composite index with. It is therefore EXEMPT from the
--     org-leading composite-index gate (scripts/check-org-leading-index.mjs),
--     which only governs tenant-scoped tables.
--   * It is DISTINCT from `sanctions_list` (the hash-only signup gate). A fuzzy
--     matcher needs cleartext candidate names; the hash table cannot back it.
--
-- IMPORTANT FRAMING — ADVISORY, NOT A LEGAL DETERMINATION:
--   * A row here is a public Treasury list entry. A fuzzy match against it is
--     ADVISORY: it raises a founder-visible flag for MANUAL review. It NEVER
--     blocks the originating action, and it is NOT a legal determination that
--     any person is or is not sanctioned.
--   * The screener surfaces "list current as of `list_published_at`" so a
--     reviewer knows the provenance of the list version that was matched.
--
-- Resilience: the refresh job UPSERTs and never wipes the table on a
-- fetch/parse failure — a bad fetch logs and leaves the existing cached list
-- intact (see sanctionsListSync.ts).
--
-- Mirrors shared/schema.ts (sanctionsListEntries) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sanctions_list_entries" (
  "id" serial PRIMARY KEY,
  -- "SDN" | "CONSOLIDATED" — which Treasury list this row came from.
  "source_list" text NOT NULL,
  -- "individual" | "entity" | "vessel" | "aircraft".
  "entity_type" text NOT NULL,
  -- Primary display name exactly as published by Treasury.
  "primary_name" text NOT NULL,
  -- Normalized form (NFKD + lowercase + sorted token set), mirrors
  -- normalizeName() in ofacScreening.ts so indexed lookups align.
  "normalized_name" text NOT NULL,
  -- AKA / alternate names.
  "aliases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- OFAC program code(s), e.g. ["SDNTK","IRAN"].
  "programs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Addresses / countries associated with the entry.
  "addresses" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Free-text remarks from the Treasury record.
  "remarks" text,
  -- Treasury's stable unique identifier (ent_num / uid).
  "ofac_uid" text NOT NULL,
  -- When the Treasury list itself was published (provenance for "current as of").
  "list_published_at" timestamp,
  -- When THIS row was last upserted from the live fetch.
  "fetched_at" timestamp NOT NULL DEFAULT now()
);

-- GLOBAL reference table — no organization_id, so NO org-leading composite
-- index (exempt from scripts/check-org-leading-index.mjs by design). Match
-- path is a normalized_name lookup.
CREATE INDEX IF NOT EXISTS "sanctions_list_entries_normalized_name_idx"
  ON "sanctions_list_entries" ("normalized_name");

-- Idempotent upsert key: one row per (list, OFAC uid).
CREATE UNIQUE INDEX IF NOT EXISTS "sanctions_list_entries_source_uid_idx"
  ON "sanctions_list_entries" ("source_list", "ofac_uid");
