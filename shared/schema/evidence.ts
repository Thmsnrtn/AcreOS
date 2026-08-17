// ============================================================================
// SHARED/SCHEMA/EVIDENCE.TS — the Evidence Fabric's one table.
// ----------------------------------------------------------------------------
// EvidenceClaim is the atomic truth primitive of the canonical architecture
// (Master Audit BI13). AcreOS does not store "the zoning" — it stores "source X
// observed zoning=R-1, effective T, under license L, fetched at F, costing C".
// The canonical resolved value is then a RECOMPUTABLE PROJECTION over these
// rows (BI14), produced by the deterministic policy in shared/evidence/claim.ts.
//
// WHY ONE TABLE AND NOT FIVE
// --------------------------
// scripts/ratchets/table-count.json is a strict down-only ratchet whose north
// star is a SMALLER schema (<=450 tables against today's 756). Every table added
// here has to earn itself. The Evidence Fabric therefore lands as exactly ONE
// new table:
//   - the SOURCE REGISTRY already exists as code, not rows
//     (server/services/providers/data-licenses.ts — DATA_LICENSE_REGISTER), so
//     no `evidence_sources` table is needed;
//   - the PREDICATE VOCABULARY is a typed registry in shared/evidence/claim.ts,
//     so no `evidence_predicates` table is needed;
//   - RESOLUTION is pure code over the claims, so no `resolved_values` table is
//     needed — a materialised projection can be added later IF measured need
//     appears (Law 11: infrastructure complexity must be earned).
//
// APPEND-ONLY BY CONTRACT
// -----------------------
// Re-observing a fact INSERTS a new claim; it never UPDATEs an old one. That is
// the whole mechanism behind as-of reconstruction and behind Law 6 (historical
// decisions preserve what was known at the time). There is deliberately no
// `updatedAt` column: a row that can be updated is a row whose history can be
// rewritten. Corrections arrive as newer claims that out-rank older ones under
// the resolution policy.
//
// TENANCY
// -------
// Claims are org-scoped even though many of them are about PUBLIC facts. That
// is deliberate: BI80 separates shared source caches (which already exist, in
// `provider_cache`) from a tenant's own evidence record. The shared cache
// prevents paying twice for the same lookup; this table records what THIS
// customer's decisions were based on, which must not silently change because
// another tenant refreshed a cache entry.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import type {
  EvidenceAuthority,
  EvidenceSubjectType,
  EvidenceValueKind,
} from "../evidence/claim";

export const evidenceClaims = pgTable(
  "evidence_claims",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    // ── Subject: which canonical entity this claim is about ──────────────
    /** "property" | "parcel" | "party" — see EVIDENCE_SUBJECT_TYPES. */
    subjectType: text("subject_type").$type<EvidenceSubjectType>().notNull(),
    /**
     * The subject's id. Deliberately NOT a foreign key: `parcel` claims are
     * accepted today even though Parcel has no table yet (it is conflated into
     * `properties` — see CANONICAL_OBJECTS in shared/architecture/canon.ts).
     * Recording the parcel subject from day one makes separating Parcel from
     * Property later a BACKFILL rather than a re-interpretation of history.
     */
    subjectId: integer("subject_id").notNull(),

    // ── Predicate: which fact ────────────────────────────────────────────
    /** A registered predicate id from PREDICATES, e.g. "property.zoning". */
    predicate: text("predicate").notNull(),
    /** Mirrors the predicate's declared kind, so a reader needs no registry. */
    valueKind: text("value_kind").$type<EvidenceValueKind>().notNull(),

    // ── Value: exactly one of these is set, per valueKind ────────────────
    /**
     * Canonical string form for string/enum predicates. Also the display form
     * for the others. NULL means the source was ASKED and returned nothing —
     * evidence of absence, which is itself decision-relevant (it stops a
     * workflow re-spending on the same lookup).
     */
    valueText: text("value_text"),
    valueNumber: doublePrecision("value_number"),
    valueBool: boolean("value_bool"),

    // ── Provenance ───────────────────────────────────────────────────────
    /** Machine routing name of the adapter, e.g. "open-data", "attom". */
    provider: text("provider").notNull(),
    /** Human-readable authoritative source, e.g. "FEMA NFHL". */
    source: text("source").notNull(),
    /** "authoritative" | "estimate" | "modeled" | "unknown". */
    authority: text("authority").$type<EvidenceAuthority>().notNull(),
    /**
     * When the SOURCE says the fact was current (FEMA effective date, county
     * tax year). NULL when the source exposes no such metadata — staleness is
     * then measured conservatively from `fetched_at`.
     */
    observedAt: timestamp("observed_at"),
    /** When WE pulled it. Always known; drives as-of visibility. */
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    /** 0–100 as reported by the adapter. Tie-break only — never displayed raw. */
    providerConfidence: integer("provider_confidence"),
    /** License id from DATA_LICENSE_REGISTER; NULL when the source is unregistered. */
    license: text("license"),

    // ── Economics (Law 13: variable cost must be attributable) ───────────
    /** What acquiring this claim cost. Zero for open data. */
    costCents: integer("cost_cents").notNull().default(0),

    /**
     * The untouched provider payload fragment this claim was normalised from,
     * when small enough to be worth keeping. Lets a normalisation bug be
     * re-run against the original bytes without re-paying for the lookup
     * (BI22: separate raw provider data from canonical facts).
     */
    rawFragment: jsonb("raw_fragment"),
  },
  (table) => [
    // The dominant read: "every claim about this subject, newest first" —
    // org-LEADING per the shard-readiness invariant
    // (scripts/check-org-leading-index.mjs).
    index("evidence_claims_org_subject_idx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.fetchedAt,
    ),
    // Resolution reads one predicate at a time for one subject.
    index("evidence_claims_org_subject_predicate_idx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.predicate,
      table.fetchedAt,
    ),
    // Source-health and cost-attribution rollups read by provider over time.
    index("evidence_claims_org_provider_idx").on(
      table.organizationId,
      table.provider,
      table.fetchedAt,
    ),
  ],
);

export type EvidenceClaimRow = typeof evidenceClaims.$inferSelect;
export type InsertEvidenceClaimRow = typeof evidenceClaims.$inferInsert;
