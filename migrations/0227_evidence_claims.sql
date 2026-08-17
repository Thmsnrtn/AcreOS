-- ============================================================================
-- 0227_evidence_claims.sql — the Evidence Fabric's one table.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `evidence_claims` — the atomic truth primitive of the canonical architecture
-- (Master Audit BI13). One row per source-backed assertion about a canonical
-- entity: WHAT was asserted, by WHICH source, with WHAT standing, WHEN the
-- source observed it, WHEN we fetched it, under WHICH license, at WHAT cost.
--
-- WHY
-- ───
-- Before this table, provenance survived the fetch and died at the write.
-- `LookupResult` (server/services/providers/types.ts) already carried provider,
-- source, confidence, classification, fetchedAt and sourceAsOf — and
-- propertyEnrichment.savePropertyEnrichment() collapsed all of it into a single
-- `properties.enrichment_data` JSONB blob that OVERWROTE the previous one. No
-- per-field provenance, no observation history, no conflict representation, no
-- as-of reconstruction. Three canonical laws were unsatisfiable as a result:
-- evidence-known (2), unknown-is-valid (3) and decisions-immutable (6).
--
-- APPEND-ONLY BY CONTRACT
-- ───────────────────────
-- Re-observing a fact INSERTs a new row; nothing UPDATEs an old one. There is
-- deliberately no `updated_at` column — a row that can be updated is a row
-- whose history can be rewritten. Corrections arrive as newer claims that
-- out-rank older ones under the resolution policy in shared/evidence/claim.ts.
--
-- NOT A FOREIGN KEY ON subject_id
-- ───────────────────────────────
-- `subject_type` may be 'parcel', which has no table yet (Parcel is currently
-- conflated into `properties` — see CANONICAL_OBJECTS in
-- shared/architecture/canon.ts). Recording the parcel subject from day one
-- makes separating Parcel from Property later a BACKFILL rather than a
-- re-interpretation of history. `organization_id` IS a real FK with ON DELETE
-- CASCADE, so tenant deletion stays complete.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- `cost_cents` records what a lookup COST US, for cost-per-outcome attribution
-- (Law 13). Nothing here moves, holds, collects or charges a cent.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/evidence.ts. Registered in scripts/migrate.mjs (the
-- path that runs on deploy as the Fly release_command). Idempotent — every
-- statement is safe to re-run on every deploy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "evidence_claims" (
  "id"                  serial PRIMARY KEY,
  "organization_id"     integer NOT NULL
                          REFERENCES "organizations"("id") ON DELETE CASCADE,

  -- Subject: which canonical entity this claim is about.
  "subject_type"        text NOT NULL,
  "subject_id"          integer NOT NULL,

  -- Predicate: which fact, from the registered vocabulary in
  -- shared/evidence/claim.ts (PREDICATES).
  "predicate"           text NOT NULL,
  "value_kind"          text NOT NULL,

  -- Value: exactly one of these carries the assertion, per value_kind.
  -- ALL NULL means the source was ASKED and returned nothing — evidence of
  -- absence, which is itself decision-relevant.
  "value_text"          text,
  "value_number"        double precision,
  "value_bool"          boolean,

  -- Provenance.
  "provider"            text NOT NULL,
  "source"              text NOT NULL,
  "authority"           text NOT NULL,
  "observed_at"         timestamp,
  "fetched_at"          timestamp NOT NULL DEFAULT now(),
  "provider_confidence" integer,
  "license"             text,

  -- Economics.
  "cost_cents"          integer NOT NULL DEFAULT 0,

  -- The untouched provider payload fragment, so a normalisation bug can be
  -- re-run against the original bytes without re-paying for the lookup.
  "raw_fragment"        jsonb
);

-- Dominant read: "every claim about this subject, newest first".
-- Org-LEADING per the shard-readiness invariant
-- (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "evidence_claims_org_subject_idx"
  ON "evidence_claims" ("organization_id", "subject_type", "subject_id", "fetched_at");

-- Resolution reads one predicate at a time for one subject.
CREATE INDEX IF NOT EXISTS "evidence_claims_org_subject_predicate_idx"
  ON "evidence_claims" ("organization_id", "subject_type", "subject_id", "predicate", "fetched_at");

-- Source-health and cost-attribution rollups read by provider over time.
CREATE INDEX IF NOT EXISTS "evidence_claims_org_provider_idx"
  ON "evidence_claims" ("organization_id", "provider", "fetched_at");
