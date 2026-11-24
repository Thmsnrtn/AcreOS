/**
 * Cause Giving — data foundation (CG-1; spec files/cause-giving-spec-2026-11.md §2).
 *
 * The program's only money is AcreOS's own: AcreOS donates 1% of quarterly
 * Net Operating Profit, allocated by the member tally. NO table here stores,
 * moves, or references member funds — member identity appears only on
 * tally-attribution rows (selections, selection events, nominations,
 * snapshot-attribution), never on a money row: allocations and disbursements
 * reference causes + quarters only.
 *
 * Status vocabularies live in shared/cause-giving/rules.ts and are mirrored
 * here as SQL CHECKs (the sibling convention — see uploaded-documents.ts).
 * Migration: migrations/0314_cause_giving_foundation.sql, mirrored statement
 * for statement in scripts/migrate.mjs. The whole feature sits behind the
 * `cause_giving` platform flag (seeded OFF); nothing here is reachable
 * while the flag is off.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import { users } from "../models/auth";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── Ballot structure ────────────────────────────────────────────────────────

export const causeCategories = pgTable(
  "cause_categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("cause_categories_key_unique").on(table.key),
    check("cause_categories_key_check", sql`length(trim(key)) > 0`),
  ],
);

export const causes = pgTable(
  "causes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name"),
    /** Federal EIN, unique — grants go to this EIN or nowhere (spec §8). */
    ein: text("ein").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => causeCategories.id),
    /** DRAFT-ruled copy only (spec §1.8 claims discipline). */
    displayBlurb: text("display_blurb"),
    status: text("status").notNull().default("candidate"),
    statusReason: text("status_reason"),
    /** §1.6 objective trigger code; required when status = 'removed'. */
    removalTriggerCode: text("removal_trigger_code"),
    agreementState: text("agreement_state").notNull().default("none"),
    addedVia: text("added_via").notNull().default("seed"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("causes_ein_unique").on(table.ein),
    index("causes_category_idx").on(table.categoryId),
    index("causes_status_idx").on(table.status),
    check(
      "causes_status_check",
      sql`status IN ('candidate', 'vetted', 'ballot', 'suspended', 'removed')`,
    ),
    check(
      "causes_agreement_state_check",
      sql`agreement_state IN ('none', 'sent', 'executed')`,
    ),
    check("causes_added_via_check", sql`added_via IN ('seed', 'nomination')`),
    check(
      "causes_removal_trigger_check",
      sql`removal_trigger_code IS NULL OR removal_trigger_code IN ('loss_of_tax_exempt_status', 'auto_revocation', 'fraud_finding', 'sanctions_listing')`,
    ),
  ],
);

/** Append-only vetting evidence (spec §1.6 / §3.2). Never updated, never deleted. */
export const causeVettingRecords = pgTable(
  "cause_vetting_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    causeId: uuid("cause_id")
      .notNull()
      .references(() => causes.id),
    teosCheckedAt: timestamp("teos_checked_at", { withTimezone: true }),
    teosResult: text("teos_result"),
    teosSnapshotRef: text("teos_snapshot_ref"),
    form990Period: text("form990_period"),
    form990ReviewedAt: timestamp("form990_reviewed_at", { withTimezone: true }),
    solicitationCheckResult: text("solicitation_check_result"),
    sanctionsCheckResult: text("sanctions_check_result"),
    reviewedBy: text("reviewed_by").notNull(),
    outcome: text("outcome").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [
    index("cause_vetting_records_cause_idx").on(table.causeId, table.createdAt),
    check(
      "cause_vetting_records_outcome_check",
      sql`outcome IN ('pass', 'fail', 'incomplete')`,
    ),
  ],
);

// ── Member tally attribution (the ONLY rows carrying member identity) ───────

export const memberCauseSelections = pgTable(
  "member_cause_selections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberUserId: text("member_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    causeId: uuid("cause_id")
      .notNull()
      .references(() => causes.id),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("member_cause_selections_member_unique").on(
      table.organizationId,
      table.memberUserId,
    ),
    index("member_cause_selections_cause_idx").on(table.causeId),
    index("member_cause_selections_org_cause_idx").on(
      table.organizationId,
      table.causeId,
    ),
  ],
);

/** Append-only history of every selection change — the audit trail behind any snapshot. */
export const memberCauseSelectionEvents = pgTable(
  "member_cause_selection_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain text, no FK: the audit trail must survive member deletion.
    memberUserId: text("member_user_id").notNull(),
    fromCauseId: uuid("from_cause_id").references(() => causes.id),
    toCauseId: uuid("to_cause_id").references(() => causes.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("member_cause_selection_events_member_idx").on(
      table.organizationId,
      table.memberUserId,
      table.createdAt,
    ),
  ],
);

export const causeNominations = pgTable(
  "cause_nominations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain text, no FK: attribution on a decision record, kept with the record.
    nominatorUserId: text("nominator_user_id").notNull(),
    charityLegalName: text("charity_legal_name").notNull(),
    ein: text("ein"),
    website: text("website"),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    declineReason: text("decline_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    resultingCauseId: uuid("resulting_cause_id").references(() => causes.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("cause_nominations_status_idx").on(table.status, table.createdAt),
    index("cause_nominations_org_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check(
      "cause_nominations_status_check",
      sql`status IN ('pending', 'approved', 'declined')`,
    ),
  ],
);

// ── Quarters, snapshots, allocations, disbursements (money rows: no member identity) ──

export const causeGivingQuarters = pgTable(
  "cause_giving_quarters",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    year: integer("year").notNull(),
    quarter: integer("quarter").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("open"),
    revenueCents: integer("revenue_cents"),
    expenseCents: integer("expense_cents"),
    /** Profit-definition version applied (spec §1.2 — changes are prospective only). */
    definitionVersion: text("definition_version"),
    /** FC-CG-1 treatment marker: Schedule C basis as-is, no notional owner salary. */
    founderCallTreatment: text("founder_call_treatment"),
    computedBaseCents: integer("computed_base_cents"),
    poolCents: integer("pool_cents"),
    snapshotTakenAt: timestamp("snapshot_taken_at", { withTimezone: true }),
    payingMembersAtSnapshot: integer("paying_members_at_snapshot"),
    membersWithSelectionAtSnapshot: integer("members_with_selection_at_snapshot"),
    publishedEntryId: uuid("published_entry_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("cause_giving_quarters_period_unique").on(table.year, table.quarter),
    check("cause_giving_quarters_quarter_check", sql`quarter BETWEEN 1 AND 4`),
    check(
      "cause_giving_quarters_status_check",
      sql`status IN ('open', 'snapshotted', 'allocated', 'disbursing', 'reported')`,
    ),
    check(
      "cause_giving_quarters_base_check",
      sql`computed_base_cents IS NULL OR computed_base_cents >= 0`,
    ),
    check(
      "cause_giving_quarters_pool_check",
      sql`pool_cents IS NULL OR pool_cents >= 0`,
    ),
  ],
);

/** Frozen tally — written once by the snapshot command; immutable thereafter (spec §1.3). */
export const causeQuarterSnapshots = pgTable(
  "cause_quarter_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => causeGivingQuarters.id),
    causeId: uuid("cause_id")
      .notNull()
      .references(() => causes.id),
    votes: integer("votes").notNull(),
    /** Share of the total vote as a percentage, 4dp — reproducible from votes forever. */
    sharePct: numeric("share_pct", { precision: 7, scale: 4 }).notNull().default("0"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("cause_quarter_snapshots_quarter_cause_unique").on(
      table.quarterId,
      table.causeId,
    ),
    check("cause_quarter_snapshots_votes_check", sql`votes >= 0`),
  ],
);

export const causeAllocations = pgTable(
  "cause_allocations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => causeGivingQuarters.id),
    causeId: uuid("cause_id")
      .notNull()
      .references(() => causes.id),
    allocatedCents: integer("allocated_cents").notNull().default(0),
    carryforwardInCents: integer("carryforward_in_cents").notNull().default(0),
    disbursableCents: integer("disbursable_cents").notNull().default(0),
    carryforwardOutCents: integer("carryforward_out_cents").notNull().default(0),
    disposition: text("disposition"),
    redistributionFromCauseIds: jsonb("redistribution_from_cause_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    redistributionToCauseIds: jsonb("redistribution_to_cause_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("cause_allocations_quarter_cause_unique").on(
      table.quarterId,
      table.causeId,
    ),
    index("cause_allocations_cause_idx").on(table.causeId),
    check(
      "cause_allocations_disposition_check",
      sql`disposition IS NULL OR disposition IN ('disbursed', 'rolled', 'redistributed-out', 'redistributed-in', 'unpayable-held')`,
    ),
    check(
      "cause_allocations_amounts_check",
      sql`allocated_cents >= 0 AND carryforward_in_cents >= 0 AND disbursable_cents >= 0 AND carryforward_out_cents >= 0`,
    ),
  ],
);

export const causeDisbursements = pgTable(
  "cause_disbursements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => causeAllocations.id),
    amountCents: integer("amount_cents").notNull(),
    disbursedOn: date("disbursed_on").notNull(),
    method: text("method").notNull(),
    externalRef: text("external_ref"),
    ackState: text("ack_state").notNull().default("pending"),
    ackDocumentRef: text("ack_document_ref"),
    /** §1.5 unpayable-attempt log (two written attempts across ≥30 days) where applicable. */
    unpayableAttemptLog: jsonb("unpayable_attempt_log"),
    /**
     * Reference to the matching append-only money-ledger event (kind
     * `donation_disbursement`). The ledger pairing completes in CG-4, whose
     * engine owns the financial_ledger bucket semantics; until then the
     * command layer stamps this only when a ledger writer is wired in.
     */
    ledgerEventRef: text("ledger_event_ref"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("cause_disbursements_allocation_idx").on(table.allocationId),
    check("cause_disbursements_amount_check", sql`amount_cents > 0`),
    check(
      "cause_disbursements_method_check",
      sql`method IN ('ach', 'check', 'dafy-grant')`,
    ),
    check(
      "cause_disbursements_ack_check",
      sql`ack_state IN ('pending', 'received')`,
    ),
  ],
);

// ── The living report (spec §3.4) ───────────────────────────────────────────

/** Published quarterly entries — immutable after publication. */
export const causeReportEntries = pgTable(
  "cause_report_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    quarterId: uuid("quarter_id")
      .notNull()
      .references(() => causeGivingQuarters.id),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: text("published_by").notNull(),
    /** The full §3.4 content as structured fields (pool, tally, allocations, cumulative). */
    content: jsonb("content").notNull(),
    renderedBody: text("rendered_body").notNull(),
    definitionVersion: text("definition_version").notNull(),
    disclosureVersion: text("disclosure_version").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("cause_report_entries_quarter_idx").on(table.quarterId),
  ],
);

/** Appended corrections — rendered beneath the original entry, never merged into it. */
export const causeReportCorrections = pgTable(
  "cause_report_corrections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => causeReportEntries.id),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: text("published_by").notNull(),
    text: text("text").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("cause_report_corrections_entry_idx").on(table.entryId),
  ],
);

// ── Types ───────────────────────────────────────────────────────────────────

export type CauseCategory = typeof causeCategories.$inferSelect;
export type InsertCauseCategory = typeof causeCategories.$inferInsert;
export type Cause = typeof causes.$inferSelect;
export type InsertCause = typeof causes.$inferInsert;
export type CauseVettingRecord = typeof causeVettingRecords.$inferSelect;
export type InsertCauseVettingRecord = typeof causeVettingRecords.$inferInsert;
export type MemberCauseSelection = typeof memberCauseSelections.$inferSelect;
export type InsertMemberCauseSelection = typeof memberCauseSelections.$inferInsert;
export type MemberCauseSelectionEvent = typeof memberCauseSelectionEvents.$inferSelect;
export type InsertMemberCauseSelectionEvent =
  typeof memberCauseSelectionEvents.$inferInsert;
export type CauseNomination = typeof causeNominations.$inferSelect;
export type InsertCauseNomination = typeof causeNominations.$inferInsert;
export type CauseGivingQuarter = typeof causeGivingQuarters.$inferSelect;
export type InsertCauseGivingQuarter = typeof causeGivingQuarters.$inferInsert;
export type CauseQuarterSnapshot = typeof causeQuarterSnapshots.$inferSelect;
export type InsertCauseQuarterSnapshot = typeof causeQuarterSnapshots.$inferInsert;
export type CauseAllocation = typeof causeAllocations.$inferSelect;
export type InsertCauseAllocation = typeof causeAllocations.$inferInsert;
export type CauseDisbursement = typeof causeDisbursements.$inferSelect;
export type InsertCauseDisbursement = typeof causeDisbursements.$inferInsert;
export type CauseReportEntry = typeof causeReportEntries.$inferSelect;
export type InsertCauseReportEntry = typeof causeReportEntries.$inferInsert;
export type CauseReportCorrection = typeof causeReportCorrections.$inferSelect;
export type InsertCauseReportCorrection = typeof causeReportCorrections.$inferInsert;
