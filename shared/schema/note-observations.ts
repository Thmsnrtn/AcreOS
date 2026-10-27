/**
 * note_field_observations — V-Notes-1 N1 (migration 0292; founder-approved
 * +1 table 2026-10-27).
 *
 * Every value any source ever stated for an acquired note's field, with its
 * provenance, plus recorded absences (kind 'searched_none': a search that ran
 * and found nothing). Append-only by trigger; a row leaves only with its note
 * (ON DELETE CASCADE). Org-private: organization_id NOT NULL, no FK to
 * organizations, every reader filters on it.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { acquiredNotes } from "./notes-vertical";

const NOTE_OBSERVATION_KINDS = ["value", "searched_none"] as const;
export type NoteObservationKind = (typeof NOTE_OBSERVATION_KINDS)[number];
const NOTE_OBSERVATION_SOURCES = ["note_tape", "operator_correction", "warehouse"] as const;
export type NoteObservationSource = (typeof NOTE_OBSERVATION_SOURCES)[number];

export const noteFieldObservations = pgTable(
  "note_field_observations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => acquiredNotes.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    kind: text("kind").$type<NoteObservationKind>().notNull(),
    value: jsonb("value"),
    source: text("source").$type<NoteObservationSource>().notNull(),
    sourceRef: jsonb("source_ref").$type<Record<string, unknown>>().notNull(),
    asOf: date("as_of"),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    confidenceBasis: text("confidence_basis").notNull(),
    decayClass: text("decay_class").notNull(),
    importId: uuid("import_id"),
    recordedBy: text("recorded_by").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("note_field_observations_org_note_idx").on(t.organizationId, t.noteId, t.field, t.observedAt),
    check("note_field_observations_value_iff_kind", sql`(kind = 'value') = (value IS NOT NULL)`),
  ],
);

export type NoteFieldObservation = typeof noteFieldObservations.$inferSelect;
export type InsertNoteFieldObservation = typeof noteFieldObservations.$inferInsert;
