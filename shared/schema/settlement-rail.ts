/**
 * Settlement & Documents Rail — schema (migration 0311).
 *
 * Two tables, both org-scoped, both part of the ONE rail every vertical's
 * money moment runs on (conceptual-gap sweep (c) §8/§9):
 *
 *   money_events        — the common payment-event ledger shape (S-3) for
 *                         money that arrives OUTSIDE the note ledger: an
 *                         assignment fee, a tax redemption, flip proceeds,
 *                         lot proceeds. Before the rail, each of those was a
 *                         status flip over an operator-typed number; this is
 *                         the one received-record they all write instead.
 *                         The rail records money that moved elsewhere (the
 *                         user's own accounts, title/escrow, the county) —
 *                         it never custodies or moves funds itself.
 *
 *   recording_statuses  — the recording-status component (S-2): one status
 *                         workflow for every recordable instrument (lien
 *                         release, deed, partial release), so a vertical
 *                         never invents its own "was it recorded?" field.
 */
import { bigint, date, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createInsertSchema } from "../db/createInsertSchema";
import { organizations } from "../schema";
import { MONEY_EVENT_KINDS, RECORDING_STATUSES, RECORDING_SUBJECT_KINDS } from "../settlement-rail";

export const moneyEvents = pgTable(
  "money_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** What arrived — one vocabulary for every vertical (shared/settlement-rail.ts). */
    kind: text("kind").$type<(typeof MONEY_EVENT_KINDS)[number]>().notNull(),
    /** The vertical surface that recorded it (note_investor, land, tax, wholesale, fix_and_flip, subdivision, …). */
    vertical: text("vertical").notNull(),
    /** The record this money belongs to, in that vertical's own id space (text: the books mix integer and uuid ids). */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** The calendar day the money was received (the payer's day, not the recording instant). */
    receivedDate: date("received_date").notNull(),
    /** Where it came from, as the outside world named it (title company, county treasurer, servicer, buyer). */
    sourceName: text("source_name"),
    /** The outside world's own reference for the payment (check no., wire ref, county receipt, settlement ref). */
    sourceReference: text("source_reference"),
    /**
     * The figure this receipt reconciles against, when one exists in-product
     * (a computed redemption amount, a signed assignment fee, an asking
     * price): a typed pointer + the expected figure, so a short-pay is a
     * query, not an audit. Null when there is nothing to reconcile against.
     */
    reconcilesAgainstType: text("reconciles_against_type"),
    reconcilesAgainstId: text("reconciles_against_id"),
    expectedAmountCents: bigint("expected_amount_cents", { mode: "number" }),
    /** The proof document, when one is kept (a doc-store ref / uploaded_documents id / URL the operator recorded). */
    proofDocumentRef: text("proof_document_ref"),
    notes: text("notes"),
    recordedByUserId: varchar("recorded_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("money_events_org_received_idx").on(table.organizationId, table.receivedDate),
    index("money_events_org_subject_idx").on(table.organizationId, table.subjectType, table.subjectId),
  ],
);

const insertMoneyEventSchema = createInsertSchema(moneyEvents, {
  kind: z.enum(MONEY_EVENT_KINDS),
  amountCents: z.number().int().positive(),
  expectedAmountCents: z.number().int().nonnegative().nullable().optional(),
}).omit({ id: true, createdAt: true });
export type InsertMoneyEvent = z.infer<typeof insertMoneyEventSchema>;
export type MoneyEvent = typeof moneyEvents.$inferSelect;

export const recordingStatuses = pgTable(
  "recording_statuses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** The instrument this status tracks (lien_release, deed, partial_release, other_instrument). */
    subjectKind: text("subject_kind").$type<(typeof RECORDING_SUBJECT_KINDS)[number]>().notNull(),
    /** The record the instrument belongs to, in its own id space (text: the books mix integer and uuid ids). */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    status: text("status").$type<(typeof RECORDING_STATUSES)[number]>().notNull().default("prepared"),
    county: text("county"),
    state: text("state"),
    /** The recorder's instrument / document number — required before the status may read `recorded`. */
    instrumentNumber: text("instrument_number"),
    /** The filed copy, when one is kept (a doc-store ref the operator recorded). */
    documentRef: text("document_ref"),
    rejectionReason: text("rejection_reason"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdByUserId: varchar("created_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("recording_statuses_org_subject_idx").on(table.organizationId, table.subjectType, table.subjectId),
    index("recording_statuses_org_status_idx").on(table.organizationId, table.status),
  ],
);

const insertRecordingStatusSchema = createInsertSchema(recordingStatuses, {
  subjectKind: z.enum(RECORDING_SUBJECT_KINDS),
  status: z.enum(RECORDING_STATUSES).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecordingStatus = z.infer<typeof insertRecordingStatusSchema>;
export type RecordingStatusRow = typeof recordingStatuses.$inferSelect;
