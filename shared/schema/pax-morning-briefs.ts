// ============================================================================
// SHARED/SCHEMA/PAX-MORNING-BRIEFS.TS
// ----------------------------------------------------------------------------
// 0303 — E2 slice 1 (Pax core), leg 2 — the morning brief archive.
//
// One row per org per local day: the sectioned brief GET /api/today composed
// from real state (what changed / what needs you / what Pax prepared), kept so
// the user can dismiss today's card and reopen past briefs. `sections` is the
// composer's output verbatim (server/services/morningBriefSections.ts) — every
// item carries its count, its source table and its as-of. The content of a
// day's row is refreshed while that day lasts; dismissal is a stamp, never a
// deletion. Org-scoped; rows go with the org (CASCADE), like today_queue_state.
//
// Mirrors migrations/0303_pax_morning_briefs.sql + scripts/migrate.mjs.
// ============================================================================

import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "../schema";

export const paxMorningBriefs = pgTable("pax_morning_briefs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // The viewer's local calendar day, YYYY-MM-DD.
  briefDate: text("brief_date").notNull(),
  // The one-line headline (composeBrief / composeBriefWithPax), null when none.
  headline: text("headline"),
  sections: jsonb("sections").$type<Record<string, unknown>>().notNull(),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: text("dismissed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgDateIdx: uniqueIndex("pax_morning_briefs_org_date_idx").on(table.organizationId, table.briefDate),
}));

export type PaxMorningBrief = typeof paxMorningBriefs.$inferSelect;
