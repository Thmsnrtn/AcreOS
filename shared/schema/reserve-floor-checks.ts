// ============================================================================
// SHARED/SCHEMA/RESERVE-FLOOR-CHECKS.TS
// ----------------------------------------------------------------------------
// Tahoe L6 — reserve floor compliance log.
//
// Cron-scheduled service writes one row per check (nightly). System-wide
// aggregate, not org-scoped (the reserve floor is a platform-level constraint
// per the constitutional capital ladder, not a per-customer one).
//
// belowFloor is a denormalised boolean so dashboards can `SELECT ... WHERE
// below_floor = true ORDER BY checked_at DESC` cheaply without recomputing
// from numerator+denominator on every read.
//
// Rule reference: shared/finance/reserve-floor.ts (RESERVE_FLOOR_RULE).
// ============================================================================

import {
  pgTable,
  serial,
  bigint,
  boolean,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";

export const reserveFloorChecks = pgTable("reserve_floor_check", {
  id: serial("id").primaryKey(),
  /** Combined balance of tax_reserve + refund_reserve + profit_reserve at check time. */
  reservesTotalCents: bigint("reserves_total_cents", { mode: "number" }).notNull(),
  /** Sum of category='revenue' rows over the trailing-window-days at check time. */
  trailingRevenueCents: bigint("trailing_revenue_cents", { mode: "number" }).notNull(),
  /** Computed floor (= trailingRevenue × RESERVE_FLOOR_RULE.minFraction). */
  floorCents: bigint("floor_cents", { mode: "number" }).notNull(),
  /** reservesTotal - floor — positive means headroom, negative means breach. */
  headroomCents: bigint("headroom_cents", { mode: "number" }).notNull(),
  /** Denormalised for cheap WHERE clauses on dashboards. */
  belowFloor: boolean("below_floor").notNull().default(false),
  /** Window in days used for the trailing-revenue denominator. */
  trailingWindowDays: bigint("trailing_window_days", { mode: "number" }).notNull(),
  /** Free-form context — e.g. "scheduled" | "manual:<founder-id>" | "test". */
  source: text("source").notNull().default("scheduled"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("reserve_floor_check_checked_at_idx").on(table.checkedAt),
  index("reserve_floor_check_below_floor_idx").on(table.belowFloor, table.checkedAt),
]);

export type ReserveFloorCheckRow = typeof reserveFloorChecks.$inferSelect;
export type InsertReserveFloorCheckRow = typeof reserveFloorChecks.$inferInsert;
