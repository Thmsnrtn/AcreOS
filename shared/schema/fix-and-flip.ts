// ============================================================================
// SHARED/SCHEMA/FIX-AND-FLIP.TS
// ----------------------------------------------------------------------------
// Fix-and-flip vertical — rehabs, rehab line items, contractors, contractor
// bids, draws, photo evidence.
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  numeric,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  date,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, properties, users } from "../schema";

// ============================================================================
// FIX-AND-FLIP VERTICAL — FF-1 schema foundation (Devon)
// ----------------------------------------------------------------------------
// Devon's deal-killer (devon-fix-flipper.md §7): "The persona panel makes a
// promise the database can't keep. […] There is no rehab budget. There is
// no contractor management. The dashboard widget for my persona reads from
// a hardcoded mock array. The most-promised features for my type are
// vapor."
//
// FF-1 ships eight tables that back the rehab + contractor stack:
//   1. rehabs                  — one row per active flip project
//   2. rehab_line_items        — categorized scope w/ vendor + budget/spent
//   3. contractors             — sub bench
//   4. contractor_w9_documents — W-9 storage (Devon §4: "no W-9 storage")
//   5. contractor_payments     — running YTD totals for 1099-NEC at Jan
//   6. construction_draws      — lender draw schedule (3.5K view)
//   7. bid_estimates           — contractor bids per rehab (compare 3 subs)
//   8. arv_calculations        — purpose-built post-rehab valuation,
//                                 distinct from the AVM enrichment value
//                                 (Devon §2.9: "An AVM is not an ARV.")
// ============================================================================

export const REHAB_STATUSES = [
  "planning",      // bidding subs, scope not finalized
  "demo",
  "framing",
  "rough_ins",     // electrical / plumbing / HVAC rough-ins
  "drywall",
  "finishes",
  "punch_list",
  "listed",
  "under_contract",
  "closed",
  "on_hold",
] as const;
export type RehabStatus = typeof REHAB_STATUSES[number];

export const rehabs = pgTable(
  "rehabs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),

    name: text("name").notNull(),                  // "1247 Cherokee Pl"
    status: text("status").$type<RehabStatus>().notNull().default("planning"),
    startedAt: date("started_at"),
    plannedListingDate: date("planned_listing_date"),
    actualListingDate: date("actual_listing_date"),
    closedAt: date("closed_at"),

    // Financial summary — Devon §4: "Real basis = purchase + closing +
    // materials + labor + permits + holding (utilities/taxes/insurance/
    // interest) + selling. None of that is itemized in a basis schedule
    // view." These columns hold rolled-up totals; line-item table below
    // holds the breakdown.
    purchasePriceCents: bigint("purchase_price_cents", { mode: "number" }),
    purchaseClosingCents: bigint("purchase_closing_cents", { mode: "number" }),
    budgetTotalCents: bigint("budget_total_cents", { mode: "number" }),
    spentTotalCents: bigint("spent_total_cents", { mode: "number" }).default(0),
    holdingCostMonthlyCents: bigint("holding_cost_monthly_cents", { mode: "number" }),
    arvCents: bigint("arv_cents", { mode: "number" }),
    targetMarginCents: bigint("target_margin_cents", { mode: "number" }),

    // Lender (FF-6 will populate construction_draws referencing this)
    lenderName: text("lender_name"),
    lenderLoanCents: bigint("lender_loan_cents", { mode: "number" }),
    lenderRateBps: integer("lender_rate_bps"),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rehabs_property_uk").on(table.organizationId, table.propertyId),
    index("rehabs_org_status_idx").on(table.organizationId, table.status),
  ],
);

export type Rehab = typeof rehabs.$inferSelect;
export type InsertRehab = typeof rehabs.$inferInsert;

// Line items — Devon §5.1: "category, scope, vendor, budgeted, committed,
// spent, variance, photos. Templated scopes — kitchen mid-grade, bath gut,
// roof tear-off & replace, exterior paint."
export const REHAB_LINE_CATEGORIES = [
  "demolition",
  "framing",
  "roof",
  "siding",
  "windows",
  "exterior_paint",
  "interior_paint",
  "flooring",
  "kitchen",
  "bathroom",
  "hvac",
  "plumbing",
  "electrical",
  "drywall",
  "trim_doors",
  "appliances",
  "landscaping",
  "permits",
  "dumpster",
  "cleaning",
  "punch_list",
  "contingency",
  "other",
] as const;
export type RehabLineCategory = typeof REHAB_LINE_CATEGORIES[number];

export const rehabLineItems = pgTable(
  "rehab_line_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Hard FK — migrations/0081_devon_ff_fk_alignment.sql installs the
    // matching ON DELETE CASCADE constraint on any drifted env (prod already
    // has it via scripts/migrate.mjs §808). Soft-FK orphan-row hazard for
    // the 1099-NEC roll-up — see Devon's Lens 20 notes.
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "cascade" }).notNull(),

    sequence: integer("sequence").notNull().default(0),
    category: text("category").$type<RehabLineCategory>().notNull(),
    scope: text("scope").notNull(),                 // "Kitchen — mid-grade gut"
    contractorId: varchar("contractor_id"),         // FK to contractors. Soft (intentional — line item survives a contractor swap).

    budgetCents: bigint("budget_cents", { mode: "number" }).notNull().default(0),
    committedCents: bigint("committed_cents", { mode: "number" }).notNull().default(0),
    spentCents: bigint("spent_cents", { mode: "number" }).notNull().default(0),

    startedAt: date("started_at"),
    completedAt: date("completed_at"),
    photoCount: integer("photo_count").notNull().default(0),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("rehab_line_items_rehab_idx").on(table.rehabId, table.sequence),
    index("rehab_line_items_org_category_idx").on(table.organizationId, table.category),
  ],
);

export type RehabLineItem = typeof rehabLineItems.$inferSelect;
export type InsertRehabLineItem = typeof rehabLineItems.$inferInsert;

// ----------------------------------------------------------------------------
// CONTRACTORS — Devon §4: "1099-NEC for every sub I paid >$600 — Fail. No
// contractor entity, no W-9 storage, no YTD totals, no form generator."
// ----------------------------------------------------------------------------

export const contractors = pgTable(
  "contractors",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),

    name: text("name").notNull(),
    businessName: text("business_name"),  // "Marcus Construction LLC"
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address").$type<{
      line1?: string; line2?: string; city?: string; state?: string; zip?: string;
    }>(),
    licenseNumber: text("license_number"),
    licenseExpiresAt: date("license_expires_at"),
    insuranceExpiresAt: date("insurance_expires_at"),
    trades: jsonb("trades").$type<string[]>().default([]),  // ["framing","drywall"]

    // Tax identity for 1099-NEC
    taxIdEncrypted: text("tax_id_encrypted"),  // EIN or SSN, encrypted at rest
    taxIdType: text("tax_id_type"),            // 'ein' | 'ssn'
    legalEntityName: text("legal_entity_name"),  // "Marcus Construction LLC" (1099 line 1)
    w9DocumentId: varchar("w9_document_id"),

    // Running YTD totals — denormalized for cheap reads. Recomputed by
    // contractor_payments triggers (or on each payment insert).
    ytdPaidCents: bigint("ytd_paid_cents", { mode: "number" }).notNull().default(0),
    lifetimePaidCents: bigint("lifetime_paid_cents", { mode: "number" }).notNull().default(0),

    activeStatus: text("active_status").notNull().default("active"),  // active | inactive | flagged
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contractors_org_idx").on(table.organizationId, table.activeStatus),
    index("contractors_org_name_idx").on(table.organizationId, table.name),
  ],
);

export type Contractor = typeof contractors.$inferSelect;
export type InsertContractor = typeof contractors.$inferInsert;

export const contractorW9Documents = pgTable(
  "contractor_w9_documents",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Hard FK — wave-3 fixup (migrations/0088). CASCADE: the W-9 is meaningless
    // once its contractor subject is gone.
    contractorId: varchar("contractor_id").references((): any => contractors.id, { onDelete: "cascade" }).notNull(),
    storagePath: text("storage_path").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    mimeType: text("mime_type"),
    uploadedBy: text("uploaded_by"),
    receivedAt: date("received_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contractor_w9_org_contractor_idx").on(table.organizationId, table.contractorId),
  ],
);

export type ContractorW9Document = typeof contractorW9Documents.$inferSelect;
export type InsertContractorW9Document = typeof contractorW9Documents.$inferInsert;

export const contractorPayments = pgTable(
  "contractor_payments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // RESTRICT — wave-3 fixup (migrations/0088). A payment row IS the 1099-NEC
    // evidence; CASCADE on a contractor delete would silently destroy IRS-
    // reportable receipts for that tax year. RESTRICT forces the operator to
    // confront payment history before destroying the contractor (the right
    // answer in practice is to set activeStatus='inactive' instead of delete).
    contractorId: varchar("contractor_id").references((): any => contractors.id, { onDelete: "restrict" }).notNull(),
    // SET NULL — a payment may be for non-rehab work, and a payment row
    // outlives the rehab it originally referenced. Without SET NULL, prior
    // rehab deletes would block, or worse, orphan rows that still summed
    // into the 1099-NEC total.
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "set null" }),
    rehabLineItemId: varchar("rehab_line_item_id"),  // optional, intentionally soft

    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidAt: date("paid_at").notNull(),
    method: text("method"),                       // 'check' | 'ach' | 'wire' | 'cash' | 'card'
    referenceNumber: text("reference_number"),
    memo: text("memo"),
    taxYear: integer("tax_year").notNull(),       // for 1099-NEC bucketing
    excludedFrom1099: boolean("excluded_from_1099").notNull().default(false),
    qboTransactionId: text("qbo_transaction_id"), // QuickBooks reconciliation

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contractor_payments_org_year_idx").on(table.organizationId, table.taxYear),
    index("contractor_payments_contractor_year_idx").on(table.contractorId, table.taxYear),
    index("contractor_payments_rehab_idx").on(table.rehabId),
  ],
);

export type ContractorPayment = typeof contractorPayments.$inferSelect;
export type InsertContractorPayment = typeof contractorPayments.$inferInsert;

// ----------------------------------------------------------------------------
// CONSTRUCTION DRAWS — Devon §3.5: "I'm two months into 1247 Maple. My
// private lender funds in three draws: 25% / 50% / 25%, each gated on
// inspection. I need a draw schedule view showing draws taken, draws
// remaining, inspection dates, lender contact, % complete per draw."
// ----------------------------------------------------------------------------

export const DRAW_STATUSES = [
  "planned",
  "requested",
  "inspected",
  "funded",
  "rejected",
] as const;
export type DrawStatus = typeof DRAW_STATUSES[number];

export const constructionDraws = pgTable(
  "construction_draws",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Hard FK — draws cascade with the rehab. Migrations/0081 installs it
    // on drifted envs.
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "cascade" }).notNull(),

    sequence: integer("sequence").notNull(),
    label: text("label").notNull(),               // "Draw 1 (25%)"
    pctOfLoan: numeric("pct_of_loan").notNull(),  // 0.25 = 25%
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: text("status").$type<DrawStatus>().notNull().default("planned"),

    requestedAt: date("requested_at"),
    inspectionAt: date("inspection_at"),
    fundedAt: date("funded_at"),
    inspectorName: text("inspector_name"),
    inspectorContact: text("inspector_contact"),
    rejectionReason: text("rejection_reason"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("construction_draws_rehab_seq_uk").on(table.rehabId, table.sequence),
    index("construction_draws_org_status_idx").on(table.organizationId, table.status),
  ],
);

export type ConstructionDraw = typeof constructionDraws.$inferSelect;
export type InsertConstructionDraw = typeof constructionDraws.$inferInsert;

// ----------------------------------------------------------------------------
// BID ESTIMATES — Devon §2.2: "Two of my three GCs sent bids on Cherokee
// yesterday — $58K, $71K, $63K — for the same scope. I want to put them
// side-by-side: line by line. AcreOS has no bid-comparison surface."
// ----------------------------------------------------------------------------

export const bidEstimates = pgTable(
  "bid_estimates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    // Hard FKs — wave-3 fixup (migrations/0088).
    //   rehab    → CASCADE   (bids belong to a single scope of work).
    //   contractor → SET NULL (bid history is post-mortem material: "why we
    //     picked GC A over GC B" must outlive the losing GC's row).
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "cascade" }).notNull(),
    contractorId: varchar("contractor_id").references((): any => contractors.id, { onDelete: "set null" }),

    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    submittedAt: date("submitted_at"),
    validUntil: date("valid_until"),

    // Per-category breakdown — { category: cents }. Source of truth for the
    // side-by-side comparison.
    categoryBreakdown: jsonb("category_breakdown").$type<Record<string, number>>().notNull().default({}),
    // Optional uploaded estimate PDF or document path.
    documentPath: text("document_path"),
    notes: text("notes"),

    isAccepted: boolean("is_accepted").notNull().default(false),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bid_estimates_rehab_idx").on(table.rehabId),
    index("bid_estimates_org_idx").on(table.organizationId, table.isAccepted),
  ],
);

export type BidEstimate = typeof bidEstimates.$inferSelect;
export type InsertBidEstimate = typeof bidEstimates.$inferInsert;

// ----------------------------------------------------------------------------
// ARV CALCULATIONS — Devon §2.9: "An AVM is not an ARV. […] AcreOS conflates
// them silently. […] ARV needs a workflow: pick three sold comps within
// 0.5 mi in the last 6 months, adjust per square foot, apply your
// contractor's scope of work, output an ARV with a confidence band."
// ----------------------------------------------------------------------------

export const arvCalculations = pgTable(
  "arv_calculations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
    // SET NULL — an ARV survives the rehab being deleted (operator may
    // want to keep the comp record around for historical pricing).
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "set null" }),

    // Comps used — array of { mlsId/address, soldPrice, soldDate, sqft,
    // distanceMiles, conditionRating, adjustments: {key: cents}, finalAdjusted: cents }
    compsUsed: jsonb("comps_used").$type<Array<{
      address?: string;
      mlsId?: string;
      soldPriceCents: number;
      soldDate?: string;
      sqft?: number;
      distanceMiles?: number;
      conditionRating?: number;       // 1-5
      adjustments?: Record<string, number>;
      finalAdjustedCents: number;
    }>>().notNull().default([]),

    subjectSqft: integer("subject_sqft"),
    pricePerSqftLowCents: bigint("price_per_sqft_low_cents", { mode: "number" }),
    pricePerSqftMidCents: bigint("price_per_sqft_mid_cents", { mode: "number" }),
    pricePerSqftHighCents: bigint("price_per_sqft_high_cents", { mode: "number" }),

    arvLowCents: bigint("arv_low_cents", { mode: "number" }).notNull(),
    arvMidCents: bigint("arv_mid_cents", { mode: "number" }).notNull(),
    arvHighCents: bigint("arv_high_cents", { mode: "number" }).notNull(),

    confidence: text("confidence"),              // 'low' | 'medium' | 'high'
    methodology: text("methodology"),            // free text
    isCurrent: boolean("is_current").notNull().default(true),

    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("arv_calculations_property_idx").on(table.propertyId, table.isCurrent),
    index("arv_calculations_org_idx").on(table.organizationId),
  ],
);

export type ArvCalculation = typeof arvCalculations.$inferSelect;
export type InsertArvCalculation = typeof arvCalculations.$inferInsert;

// ----------------------------------------------------------------------------
// REHAB PHOTOS — Devon §5.1: line items track "category, scope, vendor,
// budgeted, committed, spent, variance, photos." Everything except photos
// is tracked. This is the photo evidence table that backs four use cases:
//
//   1. before / during / after — jobsite proof
//   2. defect                 — warranty / dispute evidence
//   3. lender_draw            — required photo set for construction draws
//   4. tax                    — basis evidence for §1.263A capitalization
//
// Tag is constrained DB-side because the lender_draw + tax surfaces depend
// on the tag being one of a known set. The CHECK constraint is installed by
// migrations/0089_rehab_photos.sql.
// ----------------------------------------------------------------------------

export const REHAB_PHOTO_TAGS = [
  "before",
  "during",
  "after",
  "defect",
  "lender_draw",
  "tax",
] as const;
export type RehabPhotoTag = typeof REHAB_PHOTO_TAGS[number];

export const rehabPhotos = pgTable(
  "rehab_photos",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    rehabId: varchar("rehab_id").references((): any => rehabs.id, { onDelete: "cascade" }).notNull(),
    // SET NULL — if a line item is deleted (scope swap), the photo evidence
    // still belongs to the rehab and the auditor still wants to see it.
    lineItemId: varchar("line_item_id").references((): any => rehabLineItems.id, { onDelete: "set null" }),

    // Blob-storage pointer. We don't sign URLs at the DB layer; the read
    // route signs at fetch time so the column survives URL-schema changes.
    s3Key: text("s3_key").notNull(),
    caption: text("caption"),
    tag: text("tag").$type<RehabPhotoTag>(),

    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow(),
    // SET NULL — auditor wants the photo to outlive the captor's user row.
    // users.id is varchar(uuid) in this codebase (see shared/models/auth.ts);
    // the spec line read "int FK → users" but we follow Drizzle types.
    capturedBy: varchar("captured_by").references(() => users.id, { onDelete: "set null" }),

    lat: numeric("lat"),
    lng: numeric("lng"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    // Hot path — gallery view sorted by recency.
    index("rehab_photos_org_rehab_captured_idx").on(
      table.organizationId,
      table.rehabId,
      table.capturedAt.desc(),
    ),
    // Tag filter — lender_draw / tax bundling needs cheap point lookups.
    index("rehab_photos_rehab_tag_idx").on(table.rehabId, table.tag),
  ],
);

export type RehabPhoto = typeof rehabPhotos.$inferSelect;
export type InsertRehabPhoto = typeof rehabPhotos.$inferInsert;

