-- ============================================================================
-- 0237_opportunities.sql — the Reality Graph gets its Opportunity.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `opportunities` — a POTENTIAL investment / disposition / financing action
-- against a parcel, held by one organization, BEFORE commitment (BI11, BI12).
-- `deals` already owns the transaction process that begins AFTER commitment and
-- is already canonical; this is the half that had nowhere to live.
--
-- WHY
-- ───
-- `opportunity` is one of the canonical objects BI12 requires and canon.ts
-- recorded as ABSENT. Its absence is visible in live code, not just in prose:
--
--   · shared/economics/scenario.ts declares SCENARIO_SUBJECT_TYPES as
--     ["property", "opportunity", "deal"] and shared/decisions/snapshot.ts
--     declares DECISION_SUBJECT_TYPES as ["property", "deal", "opportunity"] —
--     so two canonical, already-landed tables accept a subject id that pointed
--     at no table at all.
--   · server/services/decisions/decisionStore.ts:102 resolves an `opportunity`
--     subjectId AS a `properties.id`
--       (`input.subjectType === "property" || input.subjectType === "opportunity"`
--        → resolveSubject(org, "property", input.subjectId, …)),
--     because there was no other id space it could belong to. The two subject
--     types were the same rows wearing different labels.
--
-- IDENTITY AND LIFECYCLE ONLY
-- ───────────────────────────
-- Layer 2 owns identity and relationships; it does not own economics. There is
-- no score, price, margin or ROI column here. `scenarios` owns the arithmetic
-- (layer 4), `decision_snapshots` the choice (layer 5), `outcomes` the result
-- (layer 7) — all three already canonical, all three already accepting an
-- `opportunity` subject. Duplicating any of them would give one number two
-- owners, which canonical law 8 forbids.
--
-- THE PARCEL REFERENCE IS THE NATURAL KEY
-- ───────────────────────────────────────
-- (parcel_state, parcel_county, parcel_apn) — the ParcelRef shape from
-- shared/parcel/parcelRef.ts, the one definition of "the same parcel" in this
-- repo. NOT a properties.id: that would re-conflate the identity the parcel
-- work separated, and an opportunity by definition precedes the commitment that
-- would create a property row. All three are NOT NULL because
-- `normalizeParcelRef` refuses a half-formed key rather than guessing — an
-- "opportunity" that cannot name the land it is about is a lead, and `leads`
-- already holds those.
--
-- NOT A SECOND HOME FOR AN EXISTING CONCEPT
-- ─────────────────────────────────────────
-- The `parcel` entry in shared/architecture/canon.ts records canon once
-- claiming parcel identity was ABSENT when it already had TWO owners; a third
-- table would have made it worse. The same check was run here against the code.
-- `opportunity_scores` is the closest existing table and is genuinely
-- opportunity-flavoured (org-scoped, `opportunity_type`, a lifecycle `status`,
-- keyed by apn/county/state) — but its writer,
-- AcquisitionRadar.saveOpportunityScore (server/services/acquisitionRadar.ts:827),
-- matches on (organization_id, apn, county, state) with NO opportunity_type in
-- the predicate and UPDATEs opportunity_type in place. One parcel gets exactly
-- ONE row whose kind is overwritten on each rescoring — the precise inability
-- BI93 names. Its vocabulary is acquisition-side signal only (undervalued /
-- motivated_seller / off_market / market_shift), its payload is score-shaped
-- (score, rank, score_factors, enrichment_data), and it keys on `parcel.apn || ''`
-- so every unknown-APN parcel in an org collides on the empty string.
-- CONSOLIDATION IS THE END STATE — opportunity_scores should become scoring
-- ABOUT an opportunity and shed its status/opportunity_type — but that rewrites
-- a live radar surface and is deliberately NOT attempted in this migration.
--
-- NO CONVENIENCE FOREIGN KEYS (BI184)
-- ───────────────────────────────────
-- No lead_id, no property_id, no deal_id. canon's `relationship` entry records
-- that expressing every new edge as a convenience FK is why role-specific
-- tables keep multiplying. The Opportunity→Party and Opportunity→Deal edges
-- belong to the Relationship object, which is still absent. `origin_type` /
-- `origin_ref` is PROVENANCE, not a relationship, and carries no FK for the
-- same reason scenarios.subject_id carries none: the record must outlive its
-- source. organization_id IS a real FK with ON DELETE CASCADE.
--
-- UNKNOWN IS FIRST-CLASS
-- ──────────────────────
-- `strategy` is nullable with NO default (NULL = not yet chosen; defaulting it
-- would fabricate an intent). `origin_type` is NOT NULL but its vocabulary
-- includes 'unknown', so a back-filled row says so instead of reading forever
-- as a human's deliberate act. `closed_at` NULL means still open.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/opportunity.ts. Idempotent.
--
-- REGISTERED IN scripts/migrate.mjs.
-- ──────────────────────────────────
-- That file is Fly's release_command, so a statement added there runs against
-- PRODUCTION on the next deploy — which is why 0236 immediately before it is
-- deliberately absent from it. The distinction is the VERB, not the proximity:
-- 0236 is `DROP TABLE`, destructive and irreversible; this is
-- `CREATE TABLE IF NOT EXISTS`, additive and idempotent, and reversible by
-- simply not writing to it. Every other additive migration in this repo is
-- registered (0235 is the most recent). Holding this one back would leave
-- shared/schema.ts exporting a table with no relation behind it — the
-- "schema without a migration" defect CLAUDE.md's wave-discipline notes name as
-- this codebase's most common, and one that 500s the first caller rather than
-- failing loudly at deploy time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "opportunities" (
  "id"              serial PRIMARY KEY,
  "organization_id" integer NOT NULL
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "shape_version"   integer NOT NULL DEFAULT 1,

  -- acquisition | disposition | financing  (OPPORTUNITY_KINDS)
  "kind"            text NOT NULL,

  -- Which strategy is being evaluated. NULL = not yet chosen. No default:
  -- this column is what makes two simultaneous evaluations of one parcel
  -- expressible (BI93), and a fabricated value would defeat that.
  "strategy"        text,

  -- The ParcelRef natural key (shared/parcel/parcelRef.ts). NOT a properties.id.
  "parcel_state"    text NOT NULL,   -- two-letter, UPPER
  "parcel_county"   text NOT NULL,   -- lower-case, whitespace collapsed
  "parcel_apn"      text NOT NULL,   -- UPPER, punctuation PRESERVED

  -- open | converted | closed  (OPPORTUNITY_STATUSES). "passed"/"won" are
  -- DECISIONS and live in decision_snapshots; restating them here would give
  -- one judgement two owners.
  "status"          text NOT NULL DEFAULT 'open',

  -- manual | lead | radar | tax-sale-list | inbound | import | unknown
  "origin_type"     text NOT NULL,
  "origin_ref"      text,

  "opened_at"       timestamp NOT NULL DEFAULT now(),
  "closed_at"       timestamp,
  "updated_at"      timestamp NOT NULL DEFAULT now()
);

-- "Every opportunity on this parcel" — the BI93 read: one parcel hosting
-- several simultaneous strategy evaluations. Org-LEADING per the
-- shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "opportunities_org_parcel_idx"
  ON "opportunities" ("organization_id", "parcel_state", "parcel_county", "parcel_apn");

-- "What am I currently considering, newest first" — the pipeline read.
CREATE INDEX IF NOT EXISTS "opportunities_org_status_idx"
  ON "opportunities" ("organization_id", "status", "opened_at");

-- NO UNIQUE CONSTRAINT, deliberately. (organization_id, parcel, kind, strategy)
-- looks like the natural uniqueness rule, but `strategy` is nullable and
-- Postgres treats NULLs as distinct, so the constraint would silently permit
-- exactly the duplicate it appears to forbid — two "strategy not yet chosen"
-- rows — while blocking the legitimate case. A false uniqueness claim is worse
-- than none. When strategy selection becomes mandatory at some lifecycle point,
-- the rule can be added as a partial unique index over the non-null rows.
