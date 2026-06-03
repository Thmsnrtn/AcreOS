// ============================================================================
// SHARED/SCHEMA/SOLENE-PAGE.TS
// ----------------------------------------------------------------------------
// Solene (COO) — proactive page-event ledger.
//
// Records every page Solene fires to Tom between sessions (urgent | critical).
// Per docs/internal/solene-page-discipline.md, page-worthy is a NARROW set:
// production 5xx spike, AWS production-access decision, LLC formation status
// change, customer-facing constitutional violation, active exploitation
// attempt. Routine work landing / agent completions / daily-pulse-eligible
// items are NOT page-worthy.
//
// Persistence purpose: post-hoc audit. Solene reviews "how often did I page
// Tom this week, and was each page justified" during the weekly retro pass.
// A pattern of paging on non-page-worthy items is a discipline failure
// surfaced via her own self-audit framework.
//
// One table: solene_page_events. Writes happen inside the page endpoint
// handler so any failure of the ntfy fan-out is still ledger'd with
// delivery_status='failed' for retro review.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const solenePageEvents = pgTable(
  "solene_page_events",
  {
    id: serial("id").primaryKey(),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    severity: text("severity").notNull(), // urgent | critical
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    deliveryStatus: text("delivery_status").notNull(), // delivered | failed | skipped
    deliveryDetail: text("delivery_detail"), // failure reason or ntfy response code
  },
  (t) => [
    index("solene_page_events_fired_idx").on(t.firedAt),
    index("solene_page_events_severity_idx").on(t.severity, t.firedAt),
  ],
);

export type SolenePageEvent = typeof solenePageEvents.$inferSelect;
export type InsertSolenePageEvent = typeof solenePageEvents.$inferInsert;

export const SOLENE_PAGE_SEVERITIES = ["urgent", "critical"] as const;
export type SolenePageSeverity = (typeof SOLENE_PAGE_SEVERITIES)[number];

export const SOLENE_PAGE_DELIVERY_STATUSES = [
  "delivered",
  "failed",
  "skipped",
] as const;
export type SolenePageDeliveryStatus =
  (typeof SOLENE_PAGE_DELIVERY_STATUSES)[number];
