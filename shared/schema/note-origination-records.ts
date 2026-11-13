/**
 * note_origination_records — Notes V2 Leg 3 (migration 0307). PROVISIONAL:
 * Tom-approval pending (step0 §9.3, ruling R5).
 *
 * The append-only audit record of the seller-finance counter and the ATR
 * activation gate for the ORIGINATED book (`notes`). note_events cannot carry
 * these — its note_id FK is to acquired_notes. Five kinds:
 *   origination_facts         — the operator's stated origination facts
 *   rmlo_engagement           — a stated RMLO engagement (completeness only;
 *                               never a licence verification)
 *   activation_gate_passed    — the gate's full input snapshot at activation;
 *                               the activation fact the counter reads
 *   threshold_release         — a founder's recorded threshold release
 *   atr_determination_written — an audit copy of an ATR determination write
 * `detail` shapes are validated per kind in shared/notes/sellerFinanceGate.ts.
 *
 * Corrections are new rows that point at the row they supersede.
 * Org-private: organization_id NOT NULL, no FK to organizations, every reader
 * filters on it. RETENTION, NOT CASCADE: note_id is nullable and ON DELETE SET
 * NULL, so a hard-deleted activated note's records stay (§1026.25(c)(3)) and
 * stay attributable through note_id_at_record. Append-only by trigger: the one
 * UPDATE admitted is that FK action (note_id → NULL once the note is gone).
 */
import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { notes } from "../schema";

export const NOTE_ORIGINATION_RECORD_KINDS = [
  "origination_facts",
  "rmlo_engagement",
  "activation_gate_passed",
  "threshold_release",
  "atr_determination_written",
] as const;
export type NoteOriginationRecordKind = (typeof NOTE_ORIGINATION_RECORD_KINDS)[number];

export const noteOriginationRecords = pgTable(
  "note_origination_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    noteId: integer("note_id").references(() => notes.id, { onDelete: "set null" }),
    noteIdAtRecord: integer("note_id_at_record").notNull(),
    kind: text("kind").$type<NoteOriginationRecordKind>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => noteOriginationRecords.id),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("note_origination_records_org_kind_idx").on(table.organizationId, table.kind, table.recordedAt),
    index("note_origination_records_org_note_idx").on(table.organizationId, table.noteId),
    check(
      "note_origination_records_kind_check",
      sql`kind IN ('origination_facts', 'rmlo_engagement', 'activation_gate_passed', 'threshold_release', 'atr_determination_written')`,
    ),
    check("note_origination_records_recorded_by_check", sql`length(trim(recorded_by)) > 0`),
  ],
);

export type NoteOriginationRecord = typeof noteOriginationRecords.$inferSelect;
export type InsertNoteOriginationRecord = typeof noteOriginationRecords.$inferInsert;
