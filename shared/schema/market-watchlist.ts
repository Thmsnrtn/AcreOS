// ============================================================================
// SHARED/SCHEMA/MARKET-WATCHLIST.TS
// ----------------------------------------------------------------------------
// Market watchlist (T117) — watched counties + the alerts fired for them.
//
// DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
// this state previously lived in module-level Maps/arrays inside
// server/services/marketWatchlist.ts — per-process, `nextAlertId` collided
// across machines, and everything reset on deploy (deletion-ledger pin
// "Module-state residue", audit 2026-07-07: "DB tables + sequences").
// The serial PK on alerts replaces the colliding in-process counter.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";

// One watched county per row. The text PK keeps the service's historical
// natural key (`${orgId}:${state}:${county}`, lowercased) so existing
// client-held entry ids and the add-is-upsert semantics survive unchanged.
export const marketWatchlistEntries = pgTable("market_watchlist_entries", {
  id: text("id").primaryKey(), // `${orgId}:${state}:${county}` lowercased
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  state: text("state").notNull(), // uppercased 2-letter code
  county: text("county").notNull(),
  // Alert thresholds
  alertOnTaxDelinquent: boolean("alert_on_tax_delinquent").notNull().default(true),
  alertOnPriceDrop: boolean("alert_on_price_drop").notNull().default(true),
  priceDropThresholdPct: integer("price_drop_threshold_pct").notNull().default(10),
  alertOnDemandIncrease: boolean("alert_on_demand_increase").notNull().default(true),
  demandScoreThreshold: integer("demand_score_threshold").notNull().default(70),
  alertOnForeclosure: boolean("alert_on_foreclosure").notNull().default(true),
  // Notification channels
  emailAlert: boolean("email_alert").notNull().default(true),
  pushAlert: boolean("push_alert").notNull().default(true),
  // Status
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAlertAt: timestamp("last_alert_at"),
}, (table) => [
  index("market_watchlist_entries_org_created_idx").on(table.organizationId, table.createdAt),
]);

export type MarketWatchlistEntryRow = typeof marketWatchlistEntries.$inferSelect;
export type InsertMarketWatchlistEntryRow = typeof marketWatchlistEntries.$inferInsert;

// Alerts fired for a watched county. organization_id is denormalized from the
// entry so org-scoped reads (list / unread count / mark-read) are one probe.
export const marketWatchlistAlerts = pgTable("market_watchlist_alerts", {
  id: serial("id").primaryKey(),
  entryId: text("entry_id").references(() => marketWatchlistEntries.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),
  type: text("type").notNull(), // tax_delinquent | price_drop | demand_increase | foreclosure | opportunity
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  severity: text("severity").notNull(), // low | medium | high
  data: jsonb("data").$type<Record<string, any>>(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("market_watchlist_alerts_org_created_idx").on(table.organizationId, table.createdAt),
  index("market_watchlist_alerts_org_read_idx").on(table.organizationId, table.read),
  index("market_watchlist_alerts_entry_idx").on(table.entryId),
]);

export type MarketWatchlistAlertRow = typeof marketWatchlistAlerts.$inferSelect;
export type InsertMarketWatchlistAlertRow = typeof marketWatchlistAlerts.$inferInsert;
