// ============================================================================
// SHARED/SCHEMA/TRUST.TS — W5a trust and giving.
// ----------------------------------------------------------------------------
// Migration 0275. Mirrors scripts/migrate.mjs STATEMENTS.
//
// WHY FIVE NEW TABLES (table-count 730 -> 735, a conscious "yes we need this")
// ---------------------------------------------------------------------------
// Checked against code, not assumed:
//   - `email_suppressions` holds PLAINTEXT addresses and covers email only; an
//     owner opt-out must cover phone and mailing address too and keep only a
//     keyed hash (data-broker laws: store the minimum). `dnc_scrub_results` is
//     a vendor-scrub CACHE with a TTL — an opt-out never expires.
//     `leads.do_not_contact` is per-org: the request is platform-wide, across
//     every org, including leads not imported yet.
//   - The request itself has a statutory clock, a verification state and the
//     per-org deletion decisions; no existing table carries any of these.
//   - Giving: a pledge is computed from paid members (organizations), but the
//     food-bank mapping is the founder's hand entry, the monthly pledge is a
//     founder-approved amount, and a receipt is a record of money AcreOS paid
//     outside AcreOS. `platform_settings` holds the monthly cap (one value);
//     a per-county mapping and a ledger of receipts are collections, the thing
//     a table is.
// Nothing here holds customer money (AcreOS gives its OWN money) and nothing
// moves money: a receipt records a payment the founder made elsewhere.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { OwnerIdentifierKind } from "../trust/ownerIdentifiers";

// ── Owner opt-out / deletion requests ───────────────────────────────────────

export type OwnerOptOutStatus = "pending_verification" | "verified" | "completed" | "expired";

/** One org that held matching records when the request was verified. */
export interface OwnerOptOutOrgMatch {
  organizationId: number;
  leadIds: number[];
  notifiedAt: string | null;
  /** Deletion of org-held records is a founder-only hard stop. */
  deletion: {
    status: "awaiting_founder" | "executed" | "declined" | "not_requested";
    decidedAt: string | null;
    rowsErased: number | null;
    note: string | null;
  };
}

export const ownerOptOutRequests = pgTable(
  "owner_optout_requests",
  {
    id: serial("id").primaryKey(),
    /** Random reference the requester uses to check status. Not guessable. */
    publicRef: text("public_ref").notNull(),
    status: text("status").$type<OwnerOptOutStatus>().notNull().default("pending_verification"),
    verificationMethod: text("verification_method").$type<"email" | "mail_code">().notNull(),
    /** sha256 of the emailed token / mailed code. The token itself is never stored. */
    verificationSecretHash: text("verification_secret_hash").notNull(),
    verificationExpiresAt: timestamp("verification_expires_at").notNull(),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    /**
     * Mail-code only: the address the code must be mailed to, encrypted with
     * fieldEncryption, and CLEARED the moment the founder marks it mailed.
     */
    pendingMailAddressEnc: text("pending_mail_address_enc"),
    mailCodeMailedAt: timestamp("mail_code_mailed_at"),
    /** Keyed hashes of the identifiers given, applied as suppressions on verification. */
    identifierHashes: jsonb("identifier_hashes").$type<Array<{ kind: OwnerIdentifierKind; hash: string }>>().notNull(),
    wantsDeletion: boolean("wants_deletion").notNull().default(true),
    /** Self-declared state of residence (drives the statutory window). */
    residenceState: text("residence_state"),
    statutoryDays: integer("statutory_days").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    dueAt: timestamp("due_at").notNull(),
    verifiedAt: timestamp("verified_at"),
    completedAt: timestamp("completed_at"),
    deadlineAlertedAt: timestamp("deadline_alerted_at"),
    orgMatches: jsonb("org_matches").$type<OwnerOptOutOrgMatch[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("owner_optout_requests_public_ref_uk").on(table.publicRef),
    index("owner_optout_requests_status_due_idx").on(table.status, table.dueAt),
  ],
);
export type OwnerOptOutRequest = typeof ownerOptOutRequests.$inferSelect;

/**
 * The platform-wide suppression list: one keyed hash per identifier. Every send
 * path reads it (server/services/trust/ownerSuppression.ts). Never expires.
 */
export const ownerSuppressions = pgTable(
  "owner_suppressions",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").$type<OwnerIdentifierKind>().notNull(),
    identifierHash: text("identifier_hash").notNull(),
    requestId: integer("request_id").references(() => ownerOptOutRequests.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("owner_suppressions_kind_hash_uk").on(table.kind, table.identifierHash)],
);
export type OwnerSuppression = typeof ownerSuppressions.$inferSelect;

// ── Giving: $1 per paying member per month (founder decision 2026-10-09) ────

/** The founder's hand-entered county → food bank mapping. */
export const givingFoodBanks = pgTable(
  "giving_food_banks",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),
    /** Normalised county name without the word "County". */
    county: text("county").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    /** Where the mapping came from — always the founder's own entry today. */
    source: text("source").notNull().default("founder_entry"),
    enteredAt: timestamp("entered_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("giving_food_banks_state_county_uk").on(table.state, table.county)],
);
export type GivingFoodBank = typeof givingFoodBanks.$inferSelect;

export interface GivingPledgeLine {
  state: string;
  county: string;
  members: number;
  cents: number;
  foodBankId: number | null;
  foodBankName: string | null;
}

export const givingMonths = pgTable(
  "giving_months",
  {
    id: serial("id").primaryKey(),
    /** "YYYY-MM" — the month whose paid members were counted. */
    month: text("month").notNull(),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    payingMembers: integer("paying_members").notNull(),
    /** Members with no county on file — counted, never allocated by guess. */
    membersWithoutCounty: integer("members_without_county").notNull(),
    lines: jsonb("lines").$type<GivingPledgeLine[]>().notNull(),
    /** Sum of lines that HAVE a food bank (unmapped counties are not pledged). */
    pledgeCents: integer("pledge_cents").notNull(),
    status: text("status").$type<"awaiting_founder" | "approved" | "declined">().notNull().default("awaiting_founder"),
    approvedCents: integer("approved_cents"),
    capCentsAtApproval: integer("cap_cents_at_approval"),
    decidedAt: timestamp("decided_at"),
    decidedBy: text("decided_by"),
  },
  (table) => [uniqueIndex("giving_months_month_uk").on(table.month)],
);
export type GivingMonth = typeof givingMonths.$inferSelect;

/** A payment the founder made OUTSIDE AcreOS. Only these count as given. */
export const givingReceipts = pgTable(
  "giving_receipts",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    foodBankId: integer("food_bank_id").references(() => givingFoodBanks.id, { onDelete: "restrict" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Confirmation number / donation-platform reference the founder pasted. */
    reference: text("reference").notNull(),
    /** Optional link to the receipt document (the founder's own storage). */
    receiptUrl: text("receipt_url"),
    paidOn: date("paid_on").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    recordedBy: text("recorded_by").notNull(),
  },
  (table) => [index("giving_receipts_food_bank_idx").on(table.foodBankId, table.paidOn)],
);
export type GivingReceipt = typeof givingReceipts.$inferSelect;
