/**
 * note_events — V-Notes-1 N3 (migration 0293; the second of the
 * founder-approved +2 tables, 2026-10-27).
 *
 * HOOKS ONLY: outcome events (payment performance as a source reported it,
 * kept for V-Notes-2's calibration) and forward-calendar dates (next payment
 * due, maturity, balloon, rate adjustment) a source STATED — never derived.
 * Nothing alerts, schedules or sends from these rows in V1.
 *
 * Append-only by trigger; a row leaves only with its note (ON DELETE CASCADE).
 * Org-private: organization_id NOT NULL, no FK to organizations, every reader
 * filters on it. A later registration is a new row; the reader takes the latest.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { acquiredNotes } from "./notes-vertical";

const NOTE_OUTCOME_EVENT_TYPES = ["performance_reported"] as const;
export const NOTE_CALENDAR_EVENT_TYPES = ["payment_due", "maturity", "balloon", "rate_adjustment"] as const;
export type NoteEventCategory = "outcome" | "calendar";
export type NoteEventType = (typeof NOTE_OUTCOME_EVENT_TYPES)[number] | (typeof NOTE_CALENDAR_EVENT_TYPES)[number];

export const noteEvents = pgTable(
  "note_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => acquiredNotes.id, { onDelete: "cascade" }),
    category: text("category").$type<NoteEventCategory>().notNull(),
    eventType: text("event_type").$type<NoteEventType>().notNull(),
    eventDate: date("event_date").notNull(),
    recurrence: text("recurrence").$type<"monthly">(),
    recurrenceUntil: date("recurrence_until"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    source: text("source").$type<"note_tape" | "operator_correction">().notNull(),
    sourceRef: jsonb("source_ref").$type<Record<string, unknown>>().notNull(),
    importId: uuid("import_id"),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("note_events_org_note_idx").on(t.organizationId, t.noteId, t.category, t.recordedAt),
    index("note_events_org_calendar_idx").on(t.organizationId, t.eventDate).where(sql`category = 'calendar'`),
    check(
      "note_events_type_matches_category",
      sql`(category = 'outcome' AND event_type IN ('performance_reported')) OR (category = 'calendar' AND event_type IN ('payment_due', 'maturity', 'balloon', 'rate_adjustment'))`,
    ),
    check(
      "note_events_recurrence_shape",
      sql`(recurrence IS NULL AND recurrence_until IS NULL) OR (recurrence IS NOT NULL AND event_type = 'payment_due' AND recurrence_until IS NOT NULL AND recurrence_until >= event_date)`,
    ),
  ],
);

export type NoteEvent = typeof noteEvents.$inferSelect;
export type InsertNoteEvent = typeof noteEvents.$inferInsert;
