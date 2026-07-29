// ============================================================================
// SHARED/SCHEMA/OUTREACH-AB.TS
// ----------------------------------------------------------------------------
// T22 outreach A/B test engine — test registry + per-lead outcome events.
//
// DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
// this state previously lived in a module-level Map/array inside
// server/services/abTestEngine.ts — outcomes were recorded per-process, so
// on 2+ machines significance/conversion stats computed on a fraction of
// the data and everything reset on deploy (deletion-ledger pin
// "Module-state residue", audit 2026-07-07: "persist tests + outcomes,
// aggregate in SQL").
//
// Deliberately NOT the existing ab_tests / ab_test_variants tables: those
// carry the campaign split-testing feature (serial ids, campaign_id NOT
// NULL, counter columns, live via sequencesRepo). The outreach engine uses
// caller-supplied string test ids, weighted jsonb variants, and event-level
// outcomes with lead ids — a different shape and a different feature.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";

export const outreachAbTests = pgTable("outreach_ab_tests", {
  id: text("id").primaryKey(), // caller-supplied string id (e.g. "subject-test-q3")
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  variants: jsonb("variants").$type<Array<{
    id: string;
    name: string;
    description: string;
    weight: number; // 0-100, weights sum to 100
    templateId?: string;
    aiGenerated?: boolean;
  }>>().notNull(),
  metric: text("metric").notNull(), // open_rate | response_rate | conversion_rate
  status: text("status").notNull().default("active"), // active | paused | completed
  winnerId: text("winner_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => [
  index("outreach_ab_tests_org_status_idx").on(table.organizationId, table.status),
]);

export type OutreachAbTestRow = typeof outreachAbTests.$inferSelect;
export type InsertOutreachAbTestRow = typeof outreachAbTests.$inferInsert;

// One row per outcome event. Aggregation happens in SQL (GROUP BY variant,
// event) so results are computed over ALL machines' data, not one process's.
export const outreachAbOutcomes = pgTable("outreach_ab_outcomes", {
  id: serial("id").primaryKey(),
  testId: text("test_id").references(() => outreachAbTests.id, { onDelete: "cascade" }).notNull(),
  variantId: text("variant_id").notNull(),
  leadId: integer("lead_id").notNull(),
  event: text("event").notNull(), // sent | opened | replied | converted | unsubscribed
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => [
  index("outreach_ab_outcomes_test_variant_event_idx").on(table.testId, table.variantId, table.event),
]);

export type OutreachAbOutcomeRow = typeof outreachAbOutcomes.$inferSelect;
export type InsertOutreachAbOutcomeRow = typeof outreachAbOutcomes.$inferInsert;
