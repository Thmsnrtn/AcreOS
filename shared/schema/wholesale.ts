// ============================================================================
// SHARED/SCHEMA/WHOLESALE.TS
// ----------------------------------------------------------------------------
// Wholesaler vertical — state rules, earnest-money holds, double-close deals,
// buyer blasts. Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  varchar,
  index,
  uniqueIndex,
  date,
  real,
  check,
  primaryKey,
  serial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, properties, buyerProfiles } from "../schema";

// ============================================================================
// WHOLESALER STATE RULES — assignment legality by jurisdiction
// ----------------------------------------------------------------------------
// Trey's deal-killer §7: "If AcreOS lets me generate and send an assignment-
// of-contract document in a regulated state without a warning, and I get
// caught, the platform is materially complicit in my legal exposure. […]
// The fix is small: a JSON file of state rules, a check in the assignment-
// template generator, and a warning banner."
//
// This table is the JSON-file replacement — paralegal-updateable without
// code deploys. Same shape as tax_jurisdiction_rules (TD-3) — review
// stamps + citation + recommendation.
// ============================================================================

export const WHOLESALER_RULE_STATUSES = [
  "unrestricted",            // assignment-for-fee fine
  "license_required",        // need a real-estate license to assign for a fee
  "advertising_restricted",  // can't market property you don't own
  "pending_legislation",     // bill in flight; behavior may change
] as const;
export type WholesalerRuleStatus = typeof WHOLESALER_RULE_STATUSES[number];

export const wholesalerStateRules = pgTable(
  "wholesaler_state_rules",
  {
    state: text("state").primaryKey(), // 2-letter
    status: text("status").$type<WholesalerRuleStatus>().notNull(),
    licenseRequired: boolean("license_required").notNull().default(false),
    advertisingRestricted: boolean("advertising_restricted").notNull().default(false),
    // Recommendation surfaced to the operator: 'unrestricted' | 'double_close_only'
    // | 'license_required' | 'consult_counsel'.
    recommendation: text("recommendation").notNull().default("unrestricted"),
    citation: text("citation"),
    summary: text("summary"),       // 1-2 sentence what's restricted
    detail: text("detail"),         // long-form notes
    attorneyReviewedAt: timestamp("attorney_reviewed_at", { withTimezone: true }),
    attorneyReviewedBy: text("attorney_reviewed_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export type WholesalerStateRule = typeof wholesalerStateRules.$inferSelect;
export type InsertWholesalerStateRule = typeof wholesalerStateRules.$inferInsert;

// ============================================================================
// EARNEST MONEY HOLDS — wholesaler EMD inspection-period state machine (W-2)
// ----------------------------------------------------------------------------
// Trey: "EMD goes to the title company on Day 0, sits in escrow during the
// inspection period (typically 7–10 days), is refundable to me until
// inspection-period expiration, then becomes non-refundable. […] My biggest
// financial risk on a wholesale deal is forgetting I'm past inspection and
// can't get my $1,000 EMD back. Saves me $1,000 per blown deal."
//
// One row per (deal, deposit). Most deals have one EMD; some have multiple
// when an additional deposit lands at inspection-period end to lock the
// deal beyond cancellation. Status flips:
//   pending  →  held (in escrow, refundable)  →  non_refundable
//                                            →  released_to_seller
//                                            →  refunded_to_buyer
//                                            →  forfeited
// ============================================================================

export const EARNEST_MONEY_STATUSES = [
  "pending",            // recorded but not yet at title
  "held",               // in escrow, refundable (within inspection period)
  "non_refundable",     // inspection period expired, EMD no longer refundable
  "released_to_seller", // closing happened, EMD applied to purchase
  "refunded_to_buyer",  // we backed out within inspection period
  "forfeited",          // we backed out after inspection — lost it
] as const;
export type EarnestMoneyStatus = typeof EARNEST_MONEY_STATUSES[number];

export const earnestMoneyHolds = pgTable(
  "earnest_money_holds",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    dealId: integer("deal_id"),  // FK ref omitted — deals.id type inferred at insert; soft FK
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),

    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    titleCompany: text("title_company"),
    referenceNumber: text("reference_number"),  // wire/check ref from title

    // The two timestamps that drive the state machine.
    depositedAt: date("deposited_at").notNull(),
    inspectionPeriodDays: integer("inspection_period_days").notNull().default(7),
    // refundableUntilAt = depositedAt + inspectionPeriodDays. Stored
    // explicitly so contract-amendment extensions / shortenings persist.
    refundableUntilAt: date("refundable_until_at").notNull(),

    status: text("status").$type<EarnestMoneyStatus>().notNull().default("pending"),
    // Filled when status transitions to a terminal state.
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    // For released_to_seller / refunded_to_buyer / forfeited.
    finalDispositionAmountCents: bigint("final_disposition_amount_cents", { mode: "number" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Drives the org-level "EMD at risk" view + per-deal lookup.
    index("emd_org_status_refundable_idx").on(table.organizationId, table.status, table.refundableUntilAt),
    index("emd_org_deal_idx").on(table.organizationId, table.dealId),
  ],
);

export type EarnestMoneyHold = typeof earnestMoneyHolds.$inferSelect;
export type InsertEarnestMoneyHold = typeof earnestMoneyHolds.$inferInsert;

// ============================================================================
// DOUBLE-CLOSE DEALS — A→B + B→C linked structure (W-3)
// ----------------------------------------------------------------------------
// Trey: "Some deals you can't legally assign (FHA-financed seller, IL/OK/SC,
// MLS-listed property where the seller agent flagged the contract non-
// assignable). I have to buy at 9 AM and sell at 9:01 AM through a
// transactional funder. AcreOS doesn't have a double-close flow. […]
// Double-close needs A-B contract + B-C contract + transactional funding
// tracking. That's a missing primitive."
//
// One row per double-close transaction. Models the two-contract structure
// directly so the UI can show both legs side-by-side and compute the
// wholesaler's net (B-C price minus A-B price minus transactional funder fee).
// ============================================================================

export const DOUBLE_CLOSE_STATUSES = [
  "planned",                // wholesaler considering double-close path
  "a_side_under_contract",  // A-B contract executed; B-C in flight
  "bc_side_under_contract", // both contracts executed
  "a_side_closed",          // wholesaler took title; B-C still pending
  "both_closed",            // double-close complete
  "dead",                   // deal collapsed
] as const;
export type DoubleCloseStatus = typeof DOUBLE_CLOSE_STATUSES[number];

export const doubleCloseDeals = pgTable(
  "double_close_deals",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),

    // Why this is double-close (instead of assignment) — drives compliance
    // narrative; useful for audit trail when the wholesaler is asked
    // "why didn't you assign?"
    reason: text("reason").$type<"state_restriction" | "non_assignable_contract" | "fha_financed" | "operator_choice" | "other">().notNull().default("operator_choice"),

    // ── A side (seller → wholesaler) ─────────────────────────────────────
    aSellerName: text("a_seller_name").notNull(),
    aSidePurchasePriceCents: bigint("a_side_purchase_price_cents", { mode: "number" }).notNull(),
    aSideContractDate: date("a_side_contract_date"),
    aSideClosingDate: date("a_side_closing_date"),
    aSideTitleCompany: text("a_side_title_company"),

    // ── B-C side (wholesaler → end buyer) ────────────────────────────────
    bcBuyerName: text("bc_buyer_name"),
    bcSidePurchasePriceCents: bigint("bc_side_purchase_price_cents", { mode: "number" }),
    bcSideContractDate: date("bc_side_contract_date"),
    bcSideClosingDate: date("bc_side_closing_date"),
    bcSideTitleCompany: text("bc_side_title_company"),

    // ── Transactional funding ────────────────────────────────────────────
    transactionalFunderName: text("transactional_funder_name"),
    transactionalFunderFeeCents: bigint("transactional_funder_fee_cents", { mode: "number" }),
    transactionalFunderRateBps: integer("transactional_funder_rate_bps"),

    status: text("status").$type<DoubleCloseStatus>().notNull().default("planned"),
    state: text("state"),    // 2-letter — for surfacing the W-1 rule that triggered this path
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("double_close_org_status_idx").on(table.organizationId, table.status),
    index("double_close_org_property_idx").on(table.organizationId, table.propertyId),
  ],
);

export type DoubleCloseDeal = typeof doubleCloseDeals.$inferSelect;
export type InsertDoubleCloseDeal = typeof doubleCloseDeals.$inferInsert;

// ============================================================================
// BUYER BLASTS — push-to-buyer-list (W-4)
// ----------------------------------------------------------------------------
// Trey: "Hit a button, AcreOS pulls matched cash buyers from
// buyer_property_matches, sends an email + SMS with property card and
// photos, tracks who opens, who replies, who books a walkthrough. […]
// This is the single feature that flips me from $20 trial to $49/mo paying."
//
// One blast row per (property, push). Recipient rows track per-buyer
// delivery + response. Channel is 'email' for now — SMS rides a follow-up
// that hooks into the existing TCPA-aware send infrastructure.
// ============================================================================

export const BUYER_BLAST_STATUSES = [
  "queued",       // recipients selected; sends in flight
  "sent",         // all recipient sends attempted
  "completed",    // sent + at least one response logged
  "cancelled",    // user aborted before send completion
] as const;
export type BuyerBlastStatus = typeof BUYER_BLAST_STATUSES[number];

export const buyerBlasts = pgTable(
  "buyer_blasts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
    subject: text("subject").notNull(),
    bodySnapshot: text("body_snapshot"),
    // What we sent: 'email' for now; future expansion: 'sms', 'mixed'.
    channel: text("channel").notNull().default("email"),
    status: text("status").$type<BuyerBlastStatus>().notNull().default("queued"),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    repliedCount: integer("replied_count").notNull().default(0),
    sentByUserId: text("sent_by_user_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("buyer_blasts_org_idx").on(table.organizationId, table.createdAt),
    index("buyer_blasts_property_idx").on(table.propertyId),
  ],
);

export const BUYER_BLAST_RECIPIENT_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "opened",
  "replied_interested",
  "replied_not_interested",
  "bounced",
  "failed",
] as const;
export type BuyerBlastRecipientStatus = typeof BUYER_BLAST_RECIPIENT_STATUSES[number];

export const buyerBlastRecipients = pgTable(
  "buyer_blast_recipients",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    blastId: varchar("blast_id").references(() => buyerBlasts.id, { onDelete: "cascade" }).notNull(),
    buyerProfileId: integer("buyer_profile_id").references(() => buyerProfiles.id, { onDelete: "cascade" }).notNull(),
    matchScore: integer("match_score"), // copy from buyer_property_matches at send time
    email: text("email"),
    status: text("status").$type<BuyerBlastRecipientStatus>().notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    responseNotes: text("response_notes"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("buyer_blast_recipients_blast_buyer_uk").on(table.blastId, table.buyerProfileId),
    index("buyer_blast_recipients_status_idx").on(table.organizationId, table.status),
  ],
);

export type BuyerBlast = typeof buyerBlasts.$inferSelect;
export type InsertBuyerBlast = typeof buyerBlasts.$inferInsert;
export type BuyerBlastRecipient = typeof buyerBlastRecipients.$inferSelect;
export type InsertBuyerBlastRecipient = typeof buyerBlastRecipients.$inferInsert;


// ============================================================================
// CONTRACT ASSIGNMENTS — the wholesaler's defining mechanic (roadmap W6.1)
// ----------------------------------------------------------------------------
// The vertical had state rules, EMD, double-close, and buyer blasts — but no
// record of the actual assignment: original contract → end buyer → fee →
// signed assignment doc. The wholesaler dashboard was forced to proxy
// assignment revenue with analysisResults.netProfit. This table is the real
// thing; fee is INTEGER CENTS per the W3.3 money rule.
// ============================================================================

export const CONTRACT_ASSIGNMENT_STATUSES = [
  "draft",              // assignment record created, no document yet
  "doc_generated",      // assignment contract generated from the template
  "sent_for_signature", // signing links issued to assignor/assignee
  "signed",             // fully executed
  "cancelled",
] as const;
export type ContractAssignmentStatus = typeof CONTRACT_ASSIGNMENT_STATUSES[number];

export const contractAssignments = pgTable(
  "contract_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    dealId: integer("deal_id").notNull(), // deals.id (FK enforced in migration; deals lives in ../schema)
    // End buyer: a buyer profile when one exists, else free-text name.
    endBuyerProfileId: integer("end_buyer_profile_id").references(() => buyerProfiles.id, { onDelete: "set null" }),
    endBuyerName: text("end_buyer_name"),
    assignmentFeeCents: bigint("assignment_fee_cents", { mode: "number" }).notNull().default(0),
    originalContractDate: date("original_contract_date"),
    // generated_documents.id once the assignment contract is generated.
    generatedDocumentId: integer("generated_document_id"),
    status: text("status").$type<ContractAssignmentStatus>().notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contract_assignments_org_deal_idx").on(table.organizationId, table.dealId),
    index("contract_assignments_status_idx").on(table.organizationId, table.status),
  ],
);

export type ContractAssignment = typeof contractAssignments.$inferSelect;
export type InsertContractAssignment = typeof contractAssignments.$inferInsert;
