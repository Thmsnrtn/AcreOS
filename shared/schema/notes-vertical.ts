// ============================================================================
// SHARED/SCHEMA/NOTES-VERTICAL.TS
// ----------------------------------------------------------------------------
// Note Investor vertical — acquired notes, payments, acquisitions, assignments,
// ownership splits, loss-mit cases, tax certificates, tax jurisdiction rules,
// auction bid logs, and quiet-title cases.
//
// Extracted from shared/schema.ts as part of the schema-inventory split.
// Cross-references (organizations, properties, leads, taxSaleListings) are
// imported back from the main schema barrel.
// ============================================================================

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  date,
  real,
  numeric,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, properties, leads, taxSaleListings } from "../schema";


// ============================================
// NOTE INVESTOR VERTICAL — Phase 5 §5 (Q4 2026)
// ============================================
//
// Note investors are land investors who hold paper (notes) instead of dirt.
// We share the same brand, persona registry, and tax/1099 plumbing as the
// land flow — these tables capture the *acquired note* world (notes the org
// has purchased from somewhere else, where the org is now the lender of
// record). Distinct from the existing `notes` table, which models notes the
// org *originated* during a seller-financed land sale.
//
// The two worlds intentionally live side-by-side: an org with
// `investorType = 'both'` will have rows in both tables and our 1099-INT
// generator aggregates interest income from each. See server/services/
// form1099Batch.ts for the union read.

export const acquiredNotes = pgTable(
  "acquired_notes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Underlying collateral (the land that secures the note). Optional for
    // notes that are pre-import (we don't yet have a property row) — the
    // user can attach a property later from the note detail surface.
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),
    // The borrower-of-record. We reuse the leads table (which already carries
    // borrower fields + encrypted TIN) rather than fork a parallel
    // note_borrowers table. Optional for the same reason as propertyId.
    borrowerId: integer("borrower_id").references(() => leads.id, { onDelete: "set null" }),
    // Org-scoped internal identifier (uniqueness enforced via the index below
    // in combination with org_id).
    noteNumber: text("note_number").notNull(),
    // Amounts — bigint cents to match the rest of AcreOS's money handling.
    originalPrincipalCents: bigint("original_principal_cents", { mode: "number" }).notNull(),
    currentBalanceCents: bigint("current_balance_cents", { mode: "number" }).notNull(),
    // Running unapplied funds — money the borrower has sent that hasn't
    // applied to any specific period yet (e.g. partial payment that
    // didn't make P&I whole). Denormalized from SUM(note_payments.
    // unappliedCents) for fast reads on the detail page.
    unappliedBalanceCents: bigint("unapplied_balance_cents", { mode: "number" }).notNull().default(0),
    // Interest rate in basis points — 800 = 8.00%. Matches the convention used
    // in `notes.interestRateBps` (originated notes).
    interestRateBps: integer("interest_rate_bps").notNull(),
    termMonths: integer("term_months").notNull(),
    paymentAmountCents: bigint("payment_amount_cents", { mode: "number" }).notNull(),
    paymentDueDay: integer("payment_due_day").notNull(), // 1-31 (clamped on render for short months)
    originationDate: date("origination_date").notNull(),
    maturityDate: date("maturity_date").notNull(),
    // The day WE bought the note. Can differ (and usually does) from
    // origination — the note may have been originated years before we
    // acquired it from the previous holder.
    acquisitionDate: date("acquisition_date").notNull(),
    acquisitionPriceCents: bigint("acquisition_price_cents", { mode: "number" }).notNull(),
    // ── Aging: when money is actually due ────────────────────────────────
    // Before these columns the book knew `paymentDueDay` (a number 1-31) and
    // `maturityDate` and NOTHING about which period is outstanding. Every
    // consequence of that is a real defect, not a missing nicety: the
    // Reg-Z §1026.41 periodic statement printed "the 1st of next month" for
    // every borrower on the book regardless of how many periods they were
    // behind; nothing could answer "what is due this week"; delinquency was
    // a status someone typed rather than something derived; and the
    // loss-mit case file's `daysPastDueAtOpen` had no source to read from.
    //
    // The anchor for the schedule. Acquired notes are imported mid-life —
    // origination is routinely years before we bought the paper, and the
    // note may have been modified or re-amortized since. Deriving the
    // schedule from `originationDate` alone puts the first period in the
    // past and every subsequent period off by the modification. Nullable
    // because most imports genuinely do not carry it; the schedule service
    // falls back to origination and says so rather than guessing a date.
    firstPaymentDate: date("first_payment_date"),
    // Server-side truth for "when is the next payment due". This used to be
    // recomputed in the browser from paymentDueDay on each render, so the
    // date on the statement, the date in the reminder email and the date on
    // the detail page could all disagree — and none of them survived a
    // page reload. Written by the aging job from real facts (payments
    // posted, paid-through, maturity cap, month-end clamp), never by a UI.
    nextPaymentDate: date("next_payment_date"),
    // The last period FULLY satisfied. Distinct from "date of last payment":
    // a borrower who sends half a payment has paid recently and is still a
    // period behind. Without this, a partial payment silently resets the
    // clock and a note that is three periods down reads as current.
    paidThroughDate: date("paid_through_date"),
    // Contractual grace before a payment is late. Aging without it calls a
    // borrower delinquent on the day after the due date, which is wrong on
    // the face of nearly every note instrument and turns a normal payer
    // into a dunning target. Default 10 matches the seller-finance book
    // (`notes.gracePeriodDays`, shared/schema.ts:1404) so the two books do
    // not disagree about the same borrower's standing.
    gracePeriodDays: integer("grace_period_days").notNull().default(10),
    // CONFIG ONLY — the late-fee amount the note instrument states. NO code
    // path in this build assesses, accrues, invoices or collects it: founder
    // ruling #15 keeps AcreOS out of customer money movement, so lateness is
    // surfaced to the operator as an advisory and any fee is charged by the
    // operator on their own rails. It is stored because a payoff quote or a
    // periodic statement that omits the borrower's stated fee terms is an
    // incomplete disclosure. 0 = the note carries no late fee.
    lateFeeCents: bigint("late_fee_cents", { mode: "number" }).notNull().default(0),
    // Derived aging depth, recomputed daily. Stored rather than computed per
    // read so "everything 60+ days down" is one indexed org query instead of
    // a full-book scan re-deriving dates per row — and so the number on the
    // loss-mit case, the dunning ladder and the Letter are the same number.
    daysDelinquent: integer("days_delinquent").notNull().default(0),
    // Bucket over daysDelinquent. Deliberately the SAME vocabulary as
    // `notes.delinquencyStatus` (shared/schema.ts:1469) — current /
    // early_delinquent / delinquent / seriously_delinquent /
    // default_candidate — because an org holding both originated and
    // acquired paper reads one delinquency list, and two spellings of "60
    // days down" would split that list into two half-truths.
    delinquencyStatus: text("delinquency_status").notNull().default("current"),
    // Status lifecycle. The note diligence + servicer-feedback loops update
    // this; for the foundation PR we expose the field but don't auto-flip it.
    status: text("status").notNull().default("performing"), // performing | late | default | paid_off | sold
    // Payer (borrower-side) snapshot. Mirrors the lead row so the 1099-INT
    // generator can read either source without a join chain when the lead
    // record is incomplete (e.g. CSV-imported note with partial borrower
    // data).
    payerName: text("payer_name").notNull(),
    payerAddress: jsonb("payer_address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
      phone?: string;
    }>(),
    // Encrypted TIN (SSN/EIN/ITIN) via fieldEncryption.encrypt(). Tax ID type
    // mirrors the convention used elsewhere in AcreOS — 'SSN' | 'EIN' | 'ITIN'.
    payerEncryptedTin: text("payer_encrypted_tin"),
    payerTinType: text("payer_tin_type"), // 'SSN' | 'EIN' | 'ITIN'
    // Provenance — who held the note before us. Useful for the diligence
    // workflow and for tracking servicer-of-record across an assignment.
    originalLender: text("original_lender"),
    // S3 key of the assignment paperwork (allonge / assignment of mortgage /
    // assignment of beneficial interest depending on jurisdiction). The
    // e-sign template work for note assignments is tracked as a follow-up
    // (see docs/archive/exhaustive-completion/note-investor-followups.md).
    assignmentDocS3Key: text("assignment_doc_s3_key"),
    // ── Compliance: hazard insurance ─────────────────────────────────────
    // Linnea: "When a borrower lets their hazard policy lapse, I have to
    // force-place coverage and add the premium to escrow. The consequences
    // of getting it wrong are five figures of uninsured loss."
    // Status: 'verified' | 'expiring_soon' | 'lapsed' | 'force_placed'.
    insuranceStatus: text("insurance_status").notNull().default("verified"),
    insuranceCarrier: text("insurance_carrier"),
    insurancePolicyNumber: text("insurance_policy_number"),
    insuranceExpiresAt: date("insurance_expires_at"),
    insuranceAnnualPremiumCents: bigint("insurance_annual_premium_cents", { mode: "number" }),
    // ── Compliance: property-tax escrow ──────────────────────────────────
    // Linnea: "Half my notes collect tax escrow. Twice a year I have to
    // disburse to the county. Without [a disbursement-due workflow] I
    // miss a tax payment and lose lien priority."
    taxEscrowEnabled: boolean("tax_escrow_enabled").notNull().default(false),
    taxEscrowBalanceCents: bigint("tax_escrow_balance_cents", { mode: "number" }).notNull().default(0),
    // The next disbursement: amount due + due date + the authority that
    // gets paid. When a disbursement is recorded, the user advances these
    // to the next cycle (most counties are semi-annual or annual).
    taxDisbursementDueDate: date("tax_disbursement_due_date"),
    taxDisbursementAmountCents: bigint("tax_disbursement_amount_cents", { mode: "number" }),
    taxAuthorityName: text("tax_authority_name"),
    // ── Reperforming progress (Pillar K, Geena persona) ──────────────────
    // Tracks consecutive on-time payments for notes that were acquired
    // non-performing and are being walked back to performing. Bumped by
    // the `payment.received` workflow; reset by `payment.missed`.
    // `reperformingThresholdMet` flips to true once
    // `consecutiveOnTimePayments` reaches the org's configured threshold
    // (default 12, founder-configurable via org settings) and triggers
    // the `note.reperforming_threshold` workflow event so the operator
    // can decide whether to reclassify or reprice.
    consecutiveOnTimePayments: integer("consecutive_on_time_payments").notNull().default(0),
    reperformingThresholdMet: boolean("reperforming_threshold_met").notNull().default(false),
    // ── Compliance posture cache (Pillar K, Catalina/Jacques/Kit) ───────
    // Optional cached output from `shared/regulatory/rmloAdvisor.ts` so
    // surfaces don't re-derive it on every render. Recomputed when
    // attributes that affect the advisory change (rate, state,
    // collateral type, originating vs. acquired). Stored as jsonb so
    // future advisor versions can expand without a migration.
    compliancePostureJson: jsonb("compliance_posture_json").$type<{
      rmloLikelyRequired: boolean;
      regZTimingApplicable: boolean;
      stateUsuryCapBps: number | null;
      postureSummary: string;
      computedAt: string;
      advisorVersion: string;
    }>(),
    // ── Reg-Z §1026.41 servicer-scope gates (Beatrice ruling 2026-06-02) ─
    // See docs/legal/acquired-notes-1026-41-ruling.md. The periodic-statement
    // generator (and the §1026.36(c) / §1024.39 piggyback obligations) only
    // attaches when ALL THREE of these read true AND an active
    // note_ownership_of_record row names this org. Defaults are conservative
    // ("don't generate") because §1026.41 attaches to the SERVICER, not the
    // holder — backfilling a missed statement is cheap; sending one we
    // weren't legally allowed to send creates a different category of risk.
    // Backfill required from assignment documents — Beatrice quarterly audit.
    isConsumerPurpose: boolean("is_consumer_purpose").notNull().default(false),
    collateralIsDwelling: boolean("collateral_is_dwelling").notNull().default(false),
    // 'self_serviced'  = AcreOS org services notes it also holds — duty attaches.
    // 'sub_serviced'   = third-party sub-servicer is the §1024.2 servicer.
    // 'seller_retained'= seller-servicer continues under sub-servicing back-arrangement.
    // 'passive_holder' = AcreOS holds paper only, no servicing role.
    servicingArrangement: text("servicing_arrangement").notNull().default("passive_holder"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Pipeline / "what needs servicing" reads.
    index("acquired_notes_org_status_maturity_idx").on(
      table.organizationId,
      table.status,
      table.maturityDate,
    ),
    // Annual / monthly acquisition reporting.
    index("acquired_notes_org_acquisition_idx").on(table.organizationId, table.acquisitionDate),
    // "What is due / what is late" — the daily aging job's read, and the
    // upcoming-payments list behind it. Org-LEADING (L3 shard-readiness,
    // scripts/check-org-leading-index.mjs).
    index("acquired_notes_org_next_payment_idx").on(table.organizationId, table.nextPaymentDate),
    // Reverse lookup from a property — "what notes are secured by this parcel?"
    index("acquired_notes_property_idx").on(table.propertyId),
    // Org-scoped uniqueness on note number — multiple orgs can use the same
    // internal number; one org cannot reuse a number.
    uniqueIndex("acquired_notes_org_number_uk").on(table.organizationId, table.noteNumber),
  ],
);

export type AcquiredNote = typeof acquiredNotes.$inferSelect;
export type InsertAcquiredNote = typeof acquiredNotes.$inferInsert;

/**
 * Book discriminators for the two note ledgers.
 *
 * These are NOT cosmetic. The books differ in money representation
 * (`acquired_notes` is integer cents; `notes` is decimal dollar STRINGS), in id
 * type (uuid vs serial integer), and in authorization (the acquired book is
 * owner/admin-gated because it carries borrower TINs). A response that says
 * which book it came from lets a consumer that arrived by accident fail loudly
 * instead of silently misreading dollars as cents.
 *
 * The two lists live on separate paths for exactly that reason — see the
 * ONE PATH, ONE OWNER note in server/routes-notes.ts. They used to collide on
 * GET /api/notes, and because the earlier handler returned a bare array without
 * calling next(), the acquired list never ran and its page rendered empty for
 * every org.
 */
export const ACQUIRED_BOOK_ID = "acquired" as const;
export const SELLER_FINANCE_BOOK_ID = "seller_finance" as const;
export type NoteBookId = typeof ACQUIRED_BOOK_ID | typeof SELLER_FINANCE_BOOK_ID;

// Per-payment ledger for acquired notes. Drives the 1099-INT yearly
// aggregation (sum interestCents per payerName per tax year) and the
// per-note amortization variance reporting.
export const notePayments = pgTable(
  "note_payments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    noteId: varchar("note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }).notNull(),
    // Denormalized for query speed on the yearly 1099 aggregation — we
    // want to filter by org + year without joining every time.
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    paymentDate: date("payment_date").notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull().default(0),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull().default(0),
    escrowCents: bigint("escrow_cents", { mode: "number" }).notNull().default(0),
    lateFeeCents: bigint("late_fee_cents", { mode: "number" }).notNull().default(0),
    // Payment type — drives ledger discipline per the Linnea persona spec.
    //   'regular'         — standard P&I payment, splits per amort schedule.
    //   'partial'         — borrower sent less than P&I; deposits to
    //                       unappliedCents instead of reducing principal.
    //   'extra_principal' — earmarked principal-only curtailment; no interest
    //                       split, doesn't advance the next-payment date.
    //   'payoff'          — final settle. Zeroes balance, sets status='paid_off'.
    //   'nsf_reversal'    — back out a bounced payment; references
    //                       originalPaymentId. Negative values restore balance.
    //   'unapplied_apply' — apply previously held unapplied funds to a
    //                       regular payment. unappliedCents is negative.
    paymentType: text("payment_type").notNull().default("regular"),
    // Money received this transaction that didn't apply to anything yet.
    // Signed: positive when funds enter unapplied; negative when consumed
    // (paymentType='unapplied_apply' or 'nsf_reversal' against an unapplied
    // deposit). Running balance = SUM(unapplied_cents) per note.
    unappliedCents: bigint("unapplied_cents", { mode: "number" }).notNull().default(0),
    // For NSF reversals: points at the original payment row being reversed.
    // Null on every other type. Self-FK so cascade-deletes follow the note.
    originalPaymentId: varchar("original_payment_id"),
    paymentMethod: text("payment_method").notNull().default("ach"), // ach | check | wire | cash | other
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_payments_note_date_idx").on(table.noteId, table.paymentDate),
    // 1099-INT aggregation read path.
    index("note_payments_org_date_idx").on(table.organizationId, table.paymentDate),
    // Ledger UI typically shows newest-first; this index supports it.
    index("note_payments_note_created_idx").on(table.noteId, table.createdAt),
  ],
);

export type NotePayment = typeof notePayments.$inferSelect;
export type InsertNotePayment = typeof notePayments.$inferInsert;

// ============================================================================
// NOTE ACQUISITIONS — pre-book diligence pipeline
// ----------------------------------------------------------------------------
// Tracks notes the user is *considering* acquiring, before they enter the
// servicing book at acquired_notes. Linnea's persona walkthrough: "When I'm
// considering buying a note, I order a BPO from a local agent for $75-150,
// attach it to the deal, and the BPO valuation gates my offer." Parcel
// /pipeline doesn't fit — note acquisition stages are different.
//
// On funding, a row is "promoted" — promotedToNoteId points at the resulting
// acquired_notes row, the stage flips to 'on_book', and downstream surfaces
// (the regular notes list, the 1099 batch, the basis schedule) take over.
// ============================================================================

export const NOTE_ACQUISITION_STAGES = [
  "sourcing",       // Found the note; no diligence yet
  "bpo_ordered",    // BPO requested, not received
  "bpo_received",   // BPO valuation in
  "diligence",      // Title pull, payment history, borrower verify
  "offer_made",     // Offer extended to seller
  "accepted",       // Seller accepted, drafting docs
  "escrow",         // In escrow with title company
  "funded",         // Wired; assignment recorded
  "on_book",        // Promoted to acquired_notes; pipeline row archived
  "passed",         // Decided not to buy; archive
] as const;
export type NoteAcquisitionStage = typeof NOTE_ACQUISITION_STAGES[number];

export const noteAcquisitions = pgTable(
  "note_acquisitions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Eventual borrower / payer name. Free text at sourcing time —
    // borrower may not yet be located. Promoted to acquiredNotes.payerName
    // on funding.
    payerName: text("payer_name").notNull(),
    propertyAddress: jsonb("property_address").$type<{
      line1?: string;
      city?: string;
      state?: string;
      zip?: string;
    }>(),
    sourcedFrom: text("sourced_from"), // 'broker' | 'individual' | 'tape' | etc.
    // What we know at the time of sourcing — refined as diligence progresses.
    proposedFaceValueCents: bigint("proposed_face_value_cents", { mode: "number" }),
    proposedAcquisitionPriceCents: bigint("proposed_acquisition_price_cents", { mode: "number" }),
    bpoValueCents: bigint("bpo_value_cents", { mode: "number" }),
    bpoOrderedAt: timestamp("bpo_ordered_at", { withTimezone: true }),
    bpoReceivedAt: timestamp("bpo_received_at", { withTimezone: true }),
    interestRateBps: integer("interest_rate_bps"),
    termMonths: integer("term_months"),
    // Per-stage checklist completion. Schema-flexible; the UI walks the
    // standard items but free-form keys are accepted.
    diligenceChecklist: jsonb("diligence_checklist").$type<{
      noteCopy?: { done?: boolean; note?: string };
      mortgageOrDot?: { done?: boolean; note?: string };
      paymentHistory?: { done?: boolean; note?: string };
      titleCommitment?: { done?: boolean; note?: string };
      priorAssignments?: { done?: boolean; note?: string };
      borrowerVerified?: { done?: boolean; note?: string };
      lienPosition?: { done?: boolean; note?: string };
    }>(),
    stage: text("stage").$type<NoteAcquisitionStage>().notNull().default("sourcing"),
    // Free text — the user's running notes (offer rationale, seller comments).
    internalNotes: text("internal_notes"),
    // Rachel (LP-fund persona): "Every note I acquire is funded by one of
    // three LP pools, plus my own bridge capital. Without a funding-source
    // tag on each acquisition the per-LP P&L roll-up is a spreadsheet job
    // forever." Free-form string by design — the broader Pool entity is
    // deferred (see Lens 16 / fund-pool follow-ups). When the Pool entity
    // ships, this column will be migrated to a foreign key; until then
    // it carries the user's chosen label ("Fund I", "Bridge", "JV-Henderson").
    fundingPoolId: text("funding_pool_id"),
    // Set on promotion; links the pipeline row to the funded acquired_note.
    promotedToNoteId: varchar("promoted_to_note_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_acquisitions_org_stage_idx").on(table.organizationId, table.stage),
    index("note_acquisitions_org_updated_idx").on(table.organizationId, table.updatedAt),
  ],
);

export type NoteAcquisition = typeof noteAcquisitions.$inferSelect;
export type InsertNoteAcquisition = typeof noteAcquisitions.$inferInsert;

// ============================================================================
// NOTE ASSIGNMENTS — paperwork for note sales / transfers
// ----------------------------------------------------------------------------
// Linnea: "When I sell a note I need an Allonge + Assignment of Mortgage/
// Deed of Trust generated and trackable." Captures the metadata for the
// paperwork; PDF renders to S3 (or inline base64 in the response for small
// orgs); future PRs will route through the native e-sign rail.
//
// Two document types ship per assignment:
//   - allonge: amends the note itself (endorsed in favor of the new holder)
//   - assignment: assigns the security instrument (mortgage / deed of trust /
//                 deed-to-secure-debt depending on state)
// Both are produced as a single combined PDF with the original note's
// material terms reproduced. State-specific recordable forms ride a
// separate workstream with legal counsel per jurisdiction.
// ============================================================================

export const noteAssignments = pgTable(
  "note_assignments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    noteId: varchar("note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }).notNull(),
    // The party we are ASSIGNING to (the buyer of the note).
    assigneeName: text("assignee_name").notNull(),
    assigneeAddress: jsonb("assignee_address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
    }>(),
    // The state whose form template is in use (informational; the generic
    // template carries the right-shape language for all states but is NOT
    // automatically county-recordable).
    state: text("state"), // 2-letter; nullable when generic-only
    templateVariant: text("template_variant").notNull().default("generic"), // 'generic' | future per-state codes
    // Sale price — what the assignee paid the assignor for the note.
    salePriceCents: bigint("sale_price_cents", { mode: "number" }),
    saleDate: date("sale_date"),
    // S3 key of the generated combined PDF (allonge + assignment).
    pdfS3Key: text("pdf_s3_key"),
    // Status lifecycle. Recording chain is owner-tracked (we don't yet talk
    // to county recorders directly).
    status: text("status").notNull().default("generated"), // 'generated' | 'signed' | 'recorded' | 'voided'
    signedAt: timestamp("signed_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    recordingNumber: text("recording_number"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_assignments_org_note_idx").on(table.organizationId, table.noteId),
    index("note_assignments_org_status_idx").on(table.organizationId, table.status),
  ],
);

export type NoteAssignment = typeof noteAssignments.$inferSelect;
export type InsertNoteAssignment = typeof noteAssignments.$inferInsert;

// ============================================================================
// NOTE OWNERSHIP SPLITS — pool / fractional ownership
// ----------------------------------------------------------------------------
// Linnea: "Three of my LP investors share a $180K commercial note 50/30/20.
// Does AcreOS support fractional ownership of a single note? I see no
// 'investors' relation on notes. This is a pool tracker problem and it's
// where a lot of small note shops live. Without it I'm back in the
// spreadsheet for those four pool notes immediately."
//
// One row per investor per note. percentageBps is in basis points
// (0-10000); the rows for a given note must sum to <= 10000. The 'role'
// distinguishes the org-itself row (when the org holds part of its own
// note) from external LP investors. investorLeadId references the leads
// table (which we already use as the borrower-side identity store) when
// the LP investor has a profile in the system; otherwise the free-form
// investorName + investorEmail keep things workable for one-off LPs.
// ============================================================================

export const noteOwnershipSplits = pgTable(
  "note_ownership_splits",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    noteId: varchar("note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }).notNull(),
    // Either ref a lead row (preferred — TIN, address, contact info live
    // there) or supply free-form name/email for one-off LPs.
    investorLeadId: integer("investor_lead_id").references(() => leads.id, { onDelete: "set null" }),
    investorName: text("investor_name").notNull(),
    investorEmail: text("investor_email"),
    // 'org' = the holding org's own slice (when self-funded). 'lp' = an
    // external limited partner. We don't model 'co_owner' separately;
    // the role plus percentageBps captures the relationship.
    role: text("role").notNull().default("lp"), // 'org' | 'lp'
    percentageBps: integer("percentage_bps").notNull(), // 0-10000 (100% = 10000)
    // Optional date the LP joined / left. Closed-end LP rotations track
    // both timestamps; open-ended pools just set effectiveFrom.
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_splits_org_note_idx").on(table.organizationId, table.noteId),
    index("note_splits_org_investor_idx").on(table.organizationId, table.investorLeadId),
  ],
);

export type NoteOwnershipSplit = typeof noteOwnershipSplits.$inferSelect;
export type InsertNoteOwnershipSplit = typeof noteOwnershipSplits.$inferInsert;

// ============================================================================
// LOSS-MIT CASE FILES — default workflow
// ----------------------------------------------------------------------------
// Linnea bonus #7: "When a borrower goes 60+ days late, I have a sequence:
// outreach call, demand letter, loss-mit options (forbearance, modification,
// deed-in-lieu, short sale, foreclosure). Each step has paperwork and
// timeline requirements that vary by state."
//
// One open case per delinquent note (uniqueIndex on (noteId) WHERE
// status='open'). Closes with one of several outcomes that map to how the
// case resolved.
// ============================================================================

export const LOSS_MIT_STATUS = [
  "open",
  "closed_cured",          // Borrower brought current
  "closed_modified",       // Note modification (rate / term / forbearance)
  "closed_dil",            // Deed-in-lieu of foreclosure
  "closed_short_sale",     // Short sale closed
  "closed_foreclosed",     // Foreclosure completed
  "closed_charged_off",    // Written off
] as const;
export type LossMitStatus = typeof LOSS_MIT_STATUS[number];

export const noteLossMitCases = pgTable(
  "note_loss_mit_cases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    noteId: varchar("note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }).notNull(),
    status: text("status").$type<LossMitStatus>().notNull().default("open"),
    state: text("state"), // US 2-letter — drives timeline rules per jurisdiction
    daysPastDueAtOpen: integer("days_past_due_at_open"),
    // SCRA check — required before foreclosure can proceed under federal law.
    scraCheckedAt: timestamp("scra_checked_at", { withTimezone: true }),
    scraActiveDuty: boolean("scra_active_duty"), // true if SCRA-protected
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("loss_mit_org_status_idx").on(table.organizationId, table.status),
    index("loss_mit_org_note_idx").on(table.organizationId, table.noteId),
  ],
);

export const LOSS_MIT_ACTION_TYPES = [
  "outreach_call",
  "outreach_email",
  "outreach_letter",
  "demand_letter_sent",
  "scra_checked",
  "borrower_response_received",
  "modification_offered",
  "modification_accepted",
  "forbearance_started",
  "short_sale_listed",
  "dil_offered",
  "dil_signed",
  "foreclosure_filed",
  "bpo_refresh_ordered",
  "note", // freeform note
] as const;
export type LossMitActionType = typeof LOSS_MIT_ACTION_TYPES[number];

export const noteLossMitActions = pgTable(
  "note_loss_mit_actions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: varchar("case_id").references(() => noteLossMitCases.id, { onDelete: "cascade" }).notNull(),
    actionType: text("action_type").$type<LossMitActionType>().notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
    performedByUserId: text("performed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("loss_mit_actions_case_idx").on(table.caseId, table.performedAt),
    index("loss_mit_actions_org_type_idx").on(table.organizationId, table.actionType),
  ],
);

export type NoteLossMitCase = typeof noteLossMitCases.$inferSelect;
export type InsertNoteLossMitCase = typeof noteLossMitCases.$inferInsert;
export type NoteLossMitAction = typeof noteLossMitActions.$inferSelect;
export type InsertNoteLossMitAction = typeof noteLossMitActions.$inferInsert;

// ============================================================================
// TAX CERTIFICATES — the redemption-clock surface
// ----------------------------------------------------------------------------
// Marcus's deal-killer: "If AcreOS tells me 'redemption window closes
// 2027-05-01' and the actual statutory deadline was 2027-04-15 because
// Alabama counts from the *first Monday after the sale* and not the sale
// date, I lose a $40,000 property. Once. Not twice. Once and I'm gone."
//
// Captures every certificate / deed acquired at a tax sale, with the
// per-state interest model + redemption math driven by tax_jurisdiction_rules
// (TD-3). The dashboard at /redemption-clock sorts by days-remaining
// ascending so the closest-to-expiry items lead.
// ============================================================================

export const TAX_CERT_SALE_TYPES = ["lien", "deed", "redeemable_deed"] as const;
export type TaxCertSaleType = typeof TAX_CERT_SALE_TYPES[number];

export const TAX_CERT_STATUSES = [
  "active",          // pre-redemption; redeemer can still pay us off
  "redeemed",        // owner redeemed; we got principal + interest
  "expired_to_deed", // FL/AZ etc — redemption window closed; we apply for deed
  "deed_obtained",   // we now own the parcel outright
  "cancelled",       // certificate cancelled (county error, refund issued)
] as const;
export type TaxCertStatus = typeof TAX_CERT_STATUSES[number];

export const taxCertificates = pgTable(
  "tax_certificates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Optional FK to the auction/listing that produced this certificate
    // (when bought via the in-platform auction worksheet — TD-4). Null
    // when the cert was hand-entered (most users today).
    listingId: integer("listing_id").references(() => taxSaleListings.id, { onDelete: "set null" }),
    // Optional FK to the underlying parcel — set when the user has
    // attached the property record to the certificate.
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),

    // Identification.
    state: text("state").notNull(),           // 2-letter
    county: text("county").notNull(),
    apn: text("apn").notNull(),
    certificateNumber: text("certificate_number"), // county's reference

    // Sale details.
    saleType: text("sale_type").$type<TaxCertSaleType>().notNull(),
    saleDate: date("sale_date").notNull(),
    // What we PAID at sale. For deeds, this is the bid amount; for liens,
    // the principal we advanced (back-tax + penalties + fees).
    purchaseAmountCents: bigint("purchase_amount_cents", { mode: "number" }).notNull(),
    // Florida bid-down: the interest rate we won at (in bps). For
    // non-bid-down states, falls back to the state default from
    // tax_jurisdiction_rules. Example: 14.25% won = 1425 bps.
    bidDownRateBps: integer("bid_down_rate_bps"),

    // Owner-of-record at sale (for outreach + statutory notice).
    ownerName: text("owner_name"),
    ownerAddress: jsonb("owner_address").$type<{
      line1?: string;
      city?: string;
      state?: string;
      zip?: string;
    }>(),

    // Redemption math.
    // The deadline is computed at insert time per the state's rule
    // (sale_date + period, with adjustments for first-Monday-after-sale,
    // recordation-date counting, etc). Stored to avoid recomputing on
    // every page load and to support backfill when rule attorney-review
    // dates shift.
    redemptionDeadline: date("redemption_deadline").notNull(),
    // Owner-occupied vs vacant: Marcus: "TX uses 6mo / 24mo redemption
    // depending on owner-occupied + agricultural; AL counts SCRA-tolling".
    ownerOccupiedAtSale: boolean("owner_occupied_at_sale"),
    // SCRA tolling — borrower active-duty extends redemption per federal
    // Servicemembers Civil Relief Act.
    scraTollingApplied: boolean("scra_tolling_applied"),

    // Resolution.
    status: text("status").$type<TaxCertStatus>().notNull().default("active"),
    redeemedAt: date("redeemed_at"),
    redeemedAmountCents: bigint("redeemed_amount_cents", { mode: "number" }),

    // Notes / clerk-flagged anomalies.
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Org-wide redemption-clock list, sorted by deadline. The dashboard
    // hits this index every page load.
    index("tax_certificates_org_status_deadline_idx").on(
      table.organizationId,
      table.status,
      table.redemptionDeadline,
    ),
    // Per-county view (Marcus: "the county is the fundamental unit").
    index("tax_certificates_org_state_county_idx").on(
      table.organizationId,
      table.state,
      table.county,
    ),
    // Composite uniqueness on the natural key — one cert per
    // (state, county, apn, sale_date) combination.
    uniqueIndex("tax_certificates_natural_key_uk").on(
      table.organizationId,
      table.state,
      table.county,
      table.apn,
      table.saleDate,
    ),
  ],
);

export type TaxCertificate = typeof taxCertificates.$inferSelect;
export type InsertTaxCertificate = typeof taxCertificates.$inferInsert;

// ============================================================================
// TAX JURISDICTION RULES — per-state redemption + statutory data
// ----------------------------------------------------------------------------
// Marcus's review §3: "I want a /state-rules/AL page that says: redemption
// period 3 years, super-priority lien on year 4, foreclosure procedure
// under §40-10-180 et seq, sample notice-to-redeem template, sample
// quiet-title petition. That single resource is a real product."
//
// One row per state. Updates without code deploys (paralegal-friendly).
// The redemption-clock service reads from this table; falls back to the
// in-memory STATE_REDEMPTION_RULES const for states the DB doesn't have
// yet. attorneyReviewedAt is null until counsel signs off on a state;
// the UI surfaces the gap explicitly.
// ============================================================================

export const taxJurisdictionRules = pgTable(
  "tax_jurisdiction_rules",
  {
    state: text("state").primaryKey(), // 2-letter
    saleType: text("sale_type").$type<TaxCertSaleType>().notNull(),
    interestModel: text("interest_model").notNull(),
    redemptionPeriodMonths: integer("redemption_period_months").notNull(),
    redemptionPeriodMonthsOwnerOccupied: integer("redemption_period_months_owner_occupied"),
    defaultRateBps: integer("default_rate_bps").notNull(),
    firstPeriodMonths: integer("first_period_months"),
    firstPeriodRateBps: integer("first_period_rate_bps"),
    secondPeriodRateBps: integer("second_period_rate_bps"),
    yearlyAddOnBps: integer("yearly_add_on_bps"),
    deadlineAnchor: text("deadline_anchor").notNull().default("sale_date"),
    citation: text("citation"),
    // Statutory-notice template references — what notice the certificate
    // holder must serve before quiet-title can proceed. Free text for
    // now; TD-6 attaches actual templates.
    noticeRequirements: text("notice_requirements"),
    quietTitleProcedure: text("quiet_title_procedure"),
    foreclosureProcedure: text("foreclosure_procedure"),
    // Review stamps. These are the crux of Marcus's deal-killer test.
    attorneyReviewedAt: timestamp("attorney_reviewed_at", { withTimezone: true }),
    attorneyReviewedBy: text("attorney_reviewed_by"),
    // Free text for paralegal notes / per-county quirks the rule entry
    // should remember.
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export type TaxJurisdictionRule = typeof taxJurisdictionRules.$inferSelect;
export type InsertTaxJurisdictionRule = typeof taxJurisdictionRules.$inferInsert;

// ============================================================================
// AUCTION BID LOG — day-of mobile-friendly bid tracking
// ----------------------------------------------------------------------------
// Marcus: "I write it on a clipboard. I would pay $20/mo just for that
// screen, on its own, if it synced back to AcreOS." Per-listing chronological
// log of what happened at the auction (passed / bid / won / outbid).
//
// max_bid_cents + walk_away_condition + partner_split live on
// tax_sale_listings (added via migrate.mjs ALTER) — they're per-listing
// pre-auction worksheet fields. Mid-auction action log is here.
// ============================================================================

export const AUCTION_BID_ACTIONS = [
  "passed",     // skipped — didn't bid
  "bid",        // bid placed (intermediate)
  "won",        // we won — terminal for this listing
  "outbid",     // outbid by someone else — terminal for this listing
  "no_show",    // listing didn't sell at auction (sometimes happens)
] as const;
export type AuctionBidAction = typeof AUCTION_BID_ACTIONS[number];

export const auctionBidLog = pgTable(
  "auction_bid_log",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    listingId: integer("listing_id").references(() => taxSaleListings.id, { onDelete: "cascade" }).notNull(),
    action: text("action").$type<AuctionBidAction>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow().notNull(),
    performedByUserId: text("performed_by_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auction_bid_log_listing_idx").on(table.listingId, table.performedAt),
    index("auction_bid_log_org_idx").on(table.organizationId, table.performedAt),
  ],
);

export type AuctionBidLogEntry = typeof auctionBidLog.$inferSelect;
export type InsertAuctionBidLogEntry = typeof auctionBidLog.$inferInsert;

// ============================================================================
// QUIET-TITLE CASES — post-deed legal workflow
// ----------------------------------------------------------------------------
// Marcus: "A tax-deed buyer's quiet-title workflow is: notify all interested
// parties of record (heirs, lienholders, neighbors with adverse-possession
// claims), publish notice, wait the statutory period, file petition, get
// judgment, record. That's six tracked stages with deadlines on each.
// AcreOS could be the first platform to actually run that workflow."
//
// One case per acquired tax certificate / deed (FK → tax_certificates).
// The action log captures each stage transition + document attachments.
// Per-state deadline math comes from tax_jurisdiction_rules (TD-3).
// ============================================================================

export const QUIET_TITLE_STATUS = [
  "open",
  "notice_phase",       // sending notices
  "publication_phase",  // statutory publication waiting period
  "petition_phase",     // drafting / filing petition
  "hearing_pending",    // hearing scheduled
  "judgment_pending",   // hearing held, awaiting judgment
  "completed",          // judgment recorded
  "abandoned",          // dropped (rare)
] as const;
export type QuietTitleStatus = typeof QUIET_TITLE_STATUS[number];

export const noteQuietTitleCases = pgTable(
  "quiet_title_cases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // FK target uses uuid because tax_certificates.id is uuid in prod.
    certificateId: varchar("certificate_id").notNull(),
    state: text("state").notNull(),
    county: text("county").notNull(),
    apn: text("apn").notNull(),
    status: text("status").$type<QuietTitleStatus>().notNull().default("open"),
    deedRecordationDate: date("deed_recordation_date"),
    // Attorney handling the case (free text for now).
    attorneyName: text("attorney_name"),
    attorneyContact: text("attorney_contact"),
    // Petition + hearing context.
    petitionFiledAt: date("petition_filed_at"),
    courtCaseNumber: text("court_case_number"),
    hearingScheduledAt: timestamp("hearing_scheduled_at", { withTimezone: true }),
    judgmentEnteredAt: date("judgment_entered_at"),
    judgmentRecordedAt: date("judgment_recorded_at"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("quiet_title_org_status_idx").on(table.organizationId, table.status),
    index("quiet_title_org_cert_idx").on(table.organizationId, table.certificateId),
  ],
);

export const QUIET_TITLE_STEP_KEYS = [
  "notice_to_lienholders",
  "notice_to_heirs",
  "notice_publication",
  "statutory_waiting_period",
  "petition_drafted",
  "petition_filed",
  "hearing_scheduled",
  "hearing_held",
  "judgment_entered",
  "judgment_recorded",
] as const;
export type QuietTitleStepKey = typeof QUIET_TITLE_STEP_KEYS[number];

export const quietTitleSteps = pgTable(
  "quiet_title_steps",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: varchar("case_id").notNull(),
    stepKey: text("step_key").$type<QuietTitleStepKey>().notNull(),
    requiredByDate: date("required_by_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: text("completed_by_user_id"),
    documentS3Key: text("document_s3_key"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("quiet_title_steps_case_step_uk").on(table.caseId, table.stepKey),
    index("quiet_title_steps_org_idx").on(table.organizationId, table.requiredByDate),
  ],
);

export type NoteQuietTitleCase = typeof noteQuietTitleCases.$inferSelect;
export type InsertNoteQuietTitleCase = typeof noteQuietTitleCases.$inferInsert;
export type QuietTitleStep = typeof quietTitleSteps.$inferSelect;
export type InsertQuietTitleStep = typeof quietTitleSteps.$inferInsert;

// ============================================================================
// NOTE SERVICER (Pillar K — Ursa persona) — foundation
// ----------------------------------------------------------------------------
// A note servicer collects and posts payments on notes owned by OTHERS (fund
// LPs, IRA holders, family offices, trusts), remits net proceeds per period,
// files informational tax forms on behalf of the owner, and holds Reg AB-
// style licensing obligations per state.
//
// Three tables ship in this foundation PR:
//   - note_ownership_of_record — third-party legal owner per note.
//                                 DISTINCT from noteOwnershipSplits which
//                                 models INTERNAL fractional ownership.
//   - servicer_remittances     — monthly per-owner sub-ledger.
//   - servicer_licenses        — per-state Reg AB licensing posture.
//
// 1099-INT-on-behalf-of-owner and Reg AB reporting are deferred (state-by-
// state filing requirements need counsel; Reg AB report is fund-admin-grade
// work). See Lens 16 follow-ups.
// ============================================================================

export const NOTE_OWNER_OF_RECORD_TYPES = [
  "org",
  "lp",
  "ira_custodian",
  "trust",
] as const;
export type NoteOwnerOfRecordType = typeof NOTE_OWNER_OF_RECORD_TYPES[number];

export const noteOwnershipOfRecord = pgTable(
  "note_ownership_of_record",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    // The SERVICING org — the one doing the collection / remittance work.
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    noteId: varchar("note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }).notNull(),
    // The BENEFICIAL owner organization. May be the servicing org itself
    // (for self-serviced notes), an LP fund, an IRA custodian, or a trust.
    // Restrict-on-delete so a remittance history isn't orphaned by an
    // owner-org delete.
    ownerOrgId: integer("owner_org_id").references(() => organizations.id, { onDelete: "restrict" }).notNull(),
    ownerType: text("owner_type").$type<NoteOwnerOfRecordType>().notNull(),
    // Percent of the note's cashflow this owner is entitled to. Sum across
    // active rows for a given (org, note) should equal 100.00; the API
    // doesn't enforce it on write (history rows mean the rule is "active
    // rows sum to 100"), but the UI surfaces a warning if not.
    basisPercentage: numeric("basis_percentage", { precision: 5, scale: 2 }).notNull().default("100.00"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
    // When this owner-of-record row was superseded by a new one (e.g.
    // ownership reassigned). Null = currently active.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_owner_of_record_org_note_idx").on(table.organizationId, table.noteId),
    index("note_owner_of_record_owner_idx").on(table.ownerOrgId, table.supersededAt),
  ],
);

export type NoteOwnershipOfRecord = typeof noteOwnershipOfRecord.$inferSelect;
export type InsertNoteOwnershipOfRecord = typeof noteOwnershipOfRecord.$inferInsert;

export const SERVICER_REMITTANCE_STATUSES = ["draft", "sent", "paid"] as const;
export type ServicerRemittanceStatus = typeof SERVICER_REMITTANCE_STATUSES[number];

export const servicerRemittances = pgTable(
  "servicer_remittances",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    // The SERVICER org — the one writing the remittance.
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // The BENEFICIAL owner the remittance is going to.
    ownerOrgId: integer("owner_org_id").references(() => organizations.id, { onDelete: "restrict" }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
    servicerFeeCents: bigint("servicer_fee_cents", { mode: "number" }).notNull().default(0),
    netCents: bigint("net_cents", { mode: "number" }).notNull().default(0),
    status: text("status").$type<ServicerRemittanceStatus>().notNull().default("draft"),
    pdfS3Key: text("pdf_s3_key"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("servicer_remit_org_owner_period_idx").on(table.organizationId, table.ownerOrgId, table.periodEnd),
    index("servicer_remit_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("servicer_remit_uniq_period_uk").on(
      table.organizationId,
      table.ownerOrgId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export type ServicerRemittance = typeof servicerRemittances.$inferSelect;
export type InsertServicerRemittance = typeof servicerRemittances.$inferInsert;

export const SERVICER_LICENSE_TYPES = [
  "sub_servicer",
  "master_servicer",
  "rmlo",
  "none_required",
] as const;
export type ServicerLicenseType = typeof SERVICER_LICENSE_TYPES[number];

export const servicerLicenses = pgTable(
  "servicer_licenses",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    state: text("state").notNull(), // 2-letter US state code
    licenseType: text("license_type").$type<ServicerLicenseType>().notNull(),
    licenseNumber: text("license_number"),
    expiresAt: date("expires_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("servicer_licenses_org_state_idx").on(table.organizationId, table.state),
    index("servicer_licenses_org_expiring_idx").on(table.organizationId, table.expiresAt),
    uniqueIndex("servicer_licenses_state_uk").on(table.organizationId, table.state, table.licenseType),
  ],
);

export type ServicerLicense = typeof servicerLicenses.$inferSelect;
export type InsertServicerLicense = typeof servicerLicenses.$inferInsert;

// ============================================================================
// PAYOFF QUOTE LEDGER — Wave C "Money moves" (agent C3)
// ----------------------------------------------------------------------------
// Payoff quotes were computed and handed to borrowers, closers, and title
// companies, and then forgotten. Nothing recorded WHAT was quoted, WHEN, to
// what date, or FROM WHICH INPUTS — so when a closer wires the quoted figure
// and the ledger disagrees, there is no way to prove which side moved. That
// is a legal exposure, not a reporting gap: a payoff statement is a
// representation the holder is bound by.
//
// One row per quote issued, storing the full engine input snapshot alongside
// the output. Immutable by convention — quotes are never updated, only
// superseded by a newer quote.
//
// Deliberately spans BOTH note books (see the cents↔decimal boundary note in
// server/services/notePaymentMath.ts): `note_system` + `note_ref` identify
// either an acquired_notes row (uuid) or a notes row (integer id, stored as
// text). There is no FK to either book on purpose — an audit artifact must
// outlive the row it describes; deleting a note must never destroy the
// evidence of what was quoted on it.
//
// RELATIONSHIP TO THE LEGACY `payoff_quotes` TABLE (shared/schema.ts ~9468):
// `payoff_quotes` predates this and is NOT a substitute. It stores OUTPUTS
// ONLY (principal / interest / fees / total as decimal strings) with no
// record of the accrual start, day count, rate, convention, per-diem, or
// engine that produced them — so a row there cannot be recomputed or
// defended — and POST /api/payoff-quotes writes whatever numbers the CALLER
// supplies (`...req.body`), so those rows are not necessarily engine-derived
// at all. It is also `note_id integer NOT NULL REFERENCES notes(id)`, so it
// structurally cannot hold a quote on an acquired note (uuid-keyed), which is
// why extending it was not an option for Wave C.
// CONSOLIDATION DEBT, deliberately recorded: migrating the legacy writers
// (server/routes-va-engine.ts payoff-quote CRUD, server/services/agent-skills.ts
// "calculate payoff" skill) onto this engine + table and dropping
// `payoff_quotes` is the follow-up that LOWERS the table-count baseline back.
// ============================================================================

export const PAYOFF_QUOTE_NOTE_SYSTEMS = ["acquired_note", "serviced_note"] as const;
export type PayoffQuoteNoteSystem = typeof PAYOFF_QUOTE_NOTE_SYSTEMS[number];

export const PAYOFF_QUOTE_CHANNELS = ["operator_api", "borrower_portal", "servicer_batch"] as const;
export type PayoffQuoteChannel = typeof PAYOFF_QUOTE_CHANNELS[number];

export const notePayoffQuotes = pgTable(
  "note_payoff_quotes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    // Which book the quoted note lives in, and its key there.
    noteSystem: text("note_system").$type<PayoffQuoteNoteSystem>().notNull(),
    noteRef: text("note_ref").notNull(),
    // Snapshot of the human-facing identifiers at quote time.
    noteNumber: text("note_number"),
    payerName: text("payer_name"),
    // Provenance.
    quotedByUserId: text("quoted_by_user_id"),
    channel: text("channel").$type<PayoffQuoteChannel>().notNull().default("operator_api"),
    quotedAt: timestamp("quoted_at", { withTimezone: true }).defaultNow().notNull(),
    // ── The inputs the number was computed FROM ────────────────────────────
    // As-of date the payoff was computed to. `good_through_date` is the last
    // date the quoted total is valid: the engine accrues interest THROUGH the
    // payoff date, so a quote is only good through that date. Extending it
    // costs `per_diem_interest_cents` per additional day.
    payoffDate: date("payoff_date").notNull(),
    goodThroughDate: date("good_through_date").notNull(),
    principalBalanceCents: bigint("principal_balance_cents", { mode: "number" }).notNull(),
    // Rate in HUNDREDTHS of a basis point — exact for rates finer than 1 bp
    // (9.875% = 987.5 bps = 98750 hundredths), which the decimal servicing
    // book can express and an integer bps column cannot.
    annualRateBpsHundredths: integer("annual_rate_bps_hundredths").notNull(),
    accrualStartDate: date("accrual_start_date").notNull(),
    daysAccrued: integer("days_accrued").notNull(),
    dayCountConvention: text("day_count_convention").notNull(),
    // ── The outputs ───────────────────────────────────────────────────────
    perDiemInterestCents: bigint("per_diem_interest_cents", { mode: "number" }).notNull(),
    accruedInterestCents: bigint("accrued_interest_cents", { mode: "number" }).notNull(),
    unappliedCreditCents: bigint("unapplied_credit_cents", { mode: "number" }).notNull().default(0),
    lateFeesOutstandingCents: bigint("late_fees_outstanding_cents", { mode: "number" }).notNull().default(0),
    payoffFeeCents: bigint("payoff_fee_cents", { mode: "number" }).notNull().default(0),
    totalPayoffCents: bigint("total_payoff_cents", { mode: "number" }).notNull(),
    // Which engine produced it, plus the verbatim input snapshot so the
    // number can be recomputed and defended years later.
    engineVersion: text("engine_version").notNull(),
    engineInputJson: jsonb("engine_input_json").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // "show me every quote issued on this note, newest first"
    index("note_payoff_quotes_note_quoted_idx").on(table.noteSystem, table.noteRef, table.quotedAt),
    // Org-scoped audit read.
    index("note_payoff_quotes_org_quoted_idx").on(table.organizationId, table.quotedAt),
  ],
);

export type NotePayoffQuote = typeof notePayoffQuotes.$inferSelect;
export type InsertNotePayoffQuote = typeof notePayoffQuotes.$inferInsert;
