// ============================================================================
// SHARED/SCHEMA/OPPORTUNITY.TS — the Reality Graph's home for Opportunity.
// ----------------------------------------------------------------------------
// An Opportunity is a POTENTIAL investment / disposition / financing action
// against a parcel, held by one organization, BEFORE commitment (BI11, BI12).
// A Deal is the transaction process that begins AFTER commitment; `deals`
// already owns that and is already canonical. This table owns the half that had
// nowhere to live.
//
// WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------
// Layer 2 (Canonical Reality Graph) owns "property, parcel, party,
// relationship, opportunity, deal, holding, instrument, document references"
// and explicitly does NOT own source claims as truth. So this table carries
// IDENTITY and LIFECYCLE only:
//
//   owns      — which org, which parcel, which kind of action, which strategy
//               is being evaluated, whether it is still open.
//   does NOT  — any economics. No score, no price, no margin, no ROI. The
//               arithmetic belongs to `scenarios` (layer 4), the choice to
//               `decision_snapshots` (layer 5), the result to `outcomes`
//               (layer 7). All three are already canonical and all three
//               already accept `subjectType: "opportunity"` — see
//               SCENARIO_SUBJECT_TYPES in shared/economics/scenario.ts and
//               DECISION_SUBJECT_TYPES in shared/decisions/snapshot.ts.
//               Duplicating any of it here would give one number two owners,
//               which canonical law 8 forbids.
//
// THE BUG THIS CLOSES TODAY
// -------------------------
// server/services/decisions/decisionStore.ts:102 reads
//
//     if (input.subjectType === "property" || input.subjectType === "opportunity") {
//       resolveSubject(organizationId, "property", input.subjectId, ...)
//
// i.e. an `opportunity` subjectId is resolved AS A `properties.id`, because
// until now there was no other kind of id it could be. The two subject types
// were the same rows wearing different labels. With this table they stop being
// the same id space, and that call site becomes a real branch rather than a
// synonym. (It is NOT changed here — this change is schema + registry only;
// see the report accompanying it.)
//
// WHY THIS IS NOT THE PARCEL MISTAKE (a second home for an existing concept)
// -------------------------------------------------------------------------
// The `parcel` entry in shared/architecture/canon.ts records a correction worth
// not repeating: canon once claimed parcel identity was ABSENT when in fact it
// had TWO owners already, and building a third table would have made it worse.
// So the same question was asked here, against the code, before writing a line:
//
//   `opportunity_scores` (shared/schema.ts) — the closest existing thing, and
//     genuinely opportunity-flavoured: it is org-scoped, carries an
//     `opportunityType` and a lifecycle `status` (new / reviewed / contacted /
//     in_progress / acquired / passed / expired), and is keyed by
//     (apn, county, state). It is nonetheless NOT an Opportunity identity:
//       · Its writer, `AcquisitionRadar.saveOpportunityScore`
//         (server/services/acquisitionRadar.ts:827), matches an existing row on
//         (organizationId, apn, county, state) with NO opportunityType in the
//         predicate, and UPDATEs `opportunityType` in place. One parcel
//         therefore has exactly ONE row, whose kind is overwritten on every
//         rescoring — the precise inability BI93 names ("one Property cannot
//         host several simultaneous strategy evaluations").
//       · Its `opportunityType` vocabulary (undervalued / motivated_seller /
//         off_market / market_shift) is acquisition-side SIGNAL. There is no
//         way to express a disposition or a financing opportunity at all.
//       · It is score-shaped: score, previousScore, scoreChange, rank,
//         scoreFactors, dataSources, enrichmentData. That is layer 3/4 output
//         ABOUT a subject, not the subject.
//       · Its keying is unnormalised — `parcel.apn || ''` at the call site, so a
//         parcel with no APN is stored under the empty string and silently
//         collides with every other unknown-APN parcel in the org. That is the
//         "default to a plausible value rather than admit unknown" failure
//         layer-3 doctrine forbids.
//     CONSOLIDATION, NOT COEXISTENCE, IS THE END STATE: `opportunity_scores`
//     should become scoring ABOUT an opportunity (opportunity_id + score) and
//     shed its `status`/`opportunityType`. That migration is deliberately NOT
//     attempted here — it rewrites a live radar surface — but it is the reason
//     this table takes the noun `opportunities` and leaves the score table its
//     score.
//
//   `properties.status = 'prospect'` — the pipeline state living on the
//     economic object. One property, one status, so a parcel being evaluated as
//     both a flip and a seller-financed hold is inexpressible. canon's
//     `property` entry already calls `properties` a god table.
//   `leads` — canon's `party` entry is explicit: `leads` is the de-facto PERSON
//     table and a lead is a STATE/ROLE, not an opportunity (BI10).
//   `tax_sale_listings` — external county inventory (org nullable), i.e. a
//     SOURCE an opportunity may originate from, not the org's intent.
//   `buyer_reservations` — post-commitment and money-bearing
//     (reservationAmount, stripePaymentIntentId). Past the BI11 line.
//
// THE PARCEL REFERENCE IS THE NATURAL KEY, NOT A properties.id
// ------------------------------------------------------------
// (state, county, apn) — the `ParcelRef` shape from shared/parcel/parcelRef.ts,
// which is the one definition of "the same parcel" in this repo. Pointing at a
// `properties.id` instead would re-conflate the identity the parcel work
// separated, and would make an opportunity on a parcel the org has never
// created a property row for unrepresentable — which is most of them, since an
// opportunity by definition precedes commitment.
//
// All three parts are NOT NULL, deliberately. `normalizeParcelRef` REFUSES a
// half-formed key rather than guessing, so a NOT NULL here is a constraint a
// writer cannot satisfy by inventing a value. An "opportunity" that cannot name
// the land it is about is a lead, and `leads` already holds those.
//
// UNKNOWN IS FIRST-CLASS (layer 3 doctrine, applied to layer 2)
// ------------------------------------------------------------
//   · `strategy` is nullable with NO default. Null means "not yet chosen" —
//     a real and common state early in evaluation. Defaulting it to the
//     org's most common strategy would fabricate an intent.
//   · `originType` is NOT NULL but its closed vocabulary INCLUDES "unknown",
//     so an imported historical row says so instead of being recorded as
//     "manual". Representable, not coerced.
//   · `closedAt` null means still open — an absence, not an unknown.
//
// WHY THIS TABLE HAS AN updatedAt WHEN THE OTHER CANONICAL TABLES DO NOT
// ----------------------------------------------------------------------
// `evidence_claims`, `scenarios`, `decision_snapshots` and `outcomes` are all
// append-only by contract, because each is a RECORD OF THE PAST and a mutable
// one could rewrite history. An Opportunity is not a record of the past; it is
// a live Reality Graph object whose CURRENT state is the point. Its history is
// not lost by mutating it — the decisions taken along the way are in
// `decision_snapshots`, which freezes what was believed at the time.
//
// NO CONVENIENCE FOREIGN KEYS (BI184)
// -----------------------------------
// No leadId, no propertyId, no dealId. canon's `relationship` entry records
// that "every new investor profile has been expressed by adding convenience
// foreign keys instead (BI184 forbids), which is why role-specific person
// tables keep multiplying". The Opportunity→Party and Opportunity→Deal edges
// are typed relationships and belong to the Relationship object, which is still
// absent. `originType`/`originRef` is provenance (where this came from), not a
// relationship, and carries no FK for the same reason `scenarios.subjectId`
// carries none: the record must survive its source.
//
// MONEY POSTURE (founder ruling "be the rail, not the provider")
// -------------------------------------------------------------
// Nothing here moves, holds, collects or charges a cent. An opportunity is an
// intention about a piece of land.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import type { ParcelRef } from "../parcel/parcelRef";

/** Bump when the OPPORTUNITY row shape changes in a way readers must notice. */
export const OPPORTUNITY_SHAPE_VERSION = 1 as const;

// ── Vocabulary ────────────────────────────────────────────────────────────

/**
 * The three kinds of potential action, straight from the canonical object's
 * purpose: "potential investment/disposition/financing action" (BI12).
 *
 * Closed, for the reason DECISION_KINDS is closed: an open string lets every
 * feature invent its own kind and the object stops being comparable across
 * time, which is the whole source of its value.
 */
export const OPPORTUNITY_KINDS = ["acquisition", "disposition", "financing"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

/**
 * The lifecycle. Three states, because the object only has three.
 *
 *   open      — under evaluation. Pre-commitment, by definition (BI11).
 *   converted — commitment was crossed; a Deal now carries it forward.
 *   closed    — no longer being pursued.
 *
 * WHY NOT "passed" / "won" / "lost": those are DECISIONS, and Decision Memory
 * owns decisions. `decision_snapshots` already records `pursue` and `pass`
 * against an `opportunity` subject, with the rationale, the authority, the
 * evidence as it stood and the economics that justified it. Restating that
 * verdict here would give one judgement two owners and let them disagree.
 */
export const OPPORTUNITY_STATUSES = ["open", "converted", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * How the opportunity entered the org's world.
 *
 * "unknown" is a member on purpose (layer-3 doctrine): a back-filled row must
 * be able to say it does not know, rather than be recorded as "manual" and read
 * forever as a human's deliberate act.
 */
export const OPPORTUNITY_ORIGINS = [
  "manual", // a person entered it
  "lead", // arrived through the lead/party pipeline
  "radar", // the acquisition radar surfaced it
  "tax-sale-list", // county tax sale / delinquent inventory
  "inbound", // a counterparty approached the org
  "import", // bulk list import
  "unknown", // genuinely not known — say so rather than guess
] as const;
export type OpportunityOrigin = (typeof OPPORTUNITY_ORIGINS)[number];

// ── The table ─────────────────────────────────────────────────────────────

export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    /** Row-shape version — distinct from anything the economics layer versions. */
    shapeVersion: integer("shape_version").notNull().default(OPPORTUNITY_SHAPE_VERSION),

    kind: text("kind").$type<OpportunityKind>().notNull(),

    /**
     * WHICH strategy is being evaluated — "flip", "seller-finance", "subdivide".
     * Free text on purpose: Strategy Packs are a registry that ships with the
     * code, and pinning their ids into a database enum would make adding one a
     * migration. NULL means not yet chosen; there is no default.
     *
     * This column is what makes BI93 expressible: two rows on the same parcel,
     * same org, differing only here, are two simultaneous evaluations.
     */
    strategy: text("strategy"),

    // ── Parcel identity: the ParcelRef natural key, never a properties.id ──
    /** Two-letter state code, UPPER — `ParcelRef.state`. */
    parcelState: text("parcel_state").notNull(),
    /** County, lower-case, whitespace collapsed — `ParcelRef.county`. */
    parcelCounty: text("parcel_county").notNull(),
    /** APN, UPPER, punctuation PRESERVED — `ParcelRef.apn`. */
    parcelApn: text("parcel_apn").notNull(),

    status: text("status").$type<OpportunityStatus>().notNull().default("open"),

    originType: text("origin_type").$type<OpportunityOrigin>().notNull(),
    /**
     * The source's own identifier, as text because sources disagree about the
     * shape of theirs (a lead id, a tax-sale listing id, a radar config id, a
     * filename). No foreign key: the opportunity must outlive its source.
     */
    originRef: text("origin_ref"),

    openedAt: timestamp("opened_at").notNull().defaultNow(),
    /** NULL means still open. An absence, not an unknown. */
    closedAt: timestamp("closed_at"),

    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // "Every opportunity on this parcel" — the BI93 read: one parcel hosting
    // several simultaneous strategy evaluations. Org-LEADING per the
    // shard-readiness invariant (scripts/check-org-leading-index.mjs).
    index("opportunities_org_parcel_idx").on(
      table.organizationId,
      table.parcelState,
      table.parcelCounty,
      table.parcelApn,
    ),
    // "What am I currently considering, newest first" — the pipeline read.
    index("opportunities_org_status_idx").on(
      table.organizationId,
      table.status,
      table.openedAt,
    ),
  ],
);

export type OpportunityRow = typeof opportunities.$inferSelect;
export type InsertOpportunityRow = typeof opportunities.$inferInsert;

// ── ParcelRef bridge ──────────────────────────────────────────────────────

/**
 * Read a row's parcel identity back as a `ParcelRef`.
 *
 * The three columns ARE a ParcelRef — already normalised, because the only
 * supported way to obtain one is `normalizeParcelRef`, which refuses rather
 * than guessing. This function is the typed door so call sites compare parcels
 * with `sameParcel`/`parcelKey` instead of re-deriving a fourth normalisation,
 * which is exactly the drift shared/parcel/parcelRef.ts was written to end.
 */
export function opportunityParcelRef(row: {
  parcelState: string;
  parcelCounty: string;
  parcelApn: string;
}): ParcelRef {
  return {
    state: row.parcelState,
    county: row.parcelCounty,
    apn: row.parcelApn,
  };
}

/**
 * The column triple to write for a normalised ref.
 *
 * Takes a `ParcelRef`, not three strings, so a caller cannot reach this table
 * without having gone through `normalizeParcelRef` first — the type is the
 * enforcement.
 */
export function parcelRefColumns(ref: ParcelRef): {
  parcelState: string;
  parcelCounty: string;
  parcelApn: string;
} {
  return {
    parcelState: ref.state,
    parcelCounty: ref.county,
    parcelApn: ref.apn,
  };
}
