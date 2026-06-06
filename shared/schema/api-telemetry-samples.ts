// ============================================================================
// SHARED/SCHEMA/API-TELEMETRY-SAMPLES.TS
// ----------------------------------------------------------------------------
// L14 — durable apiTelemetry samples.
//
// The in-process Map in server/middleware/apiTelemetry.ts is great for
// real-time observability but evaporates on every restart / suspend / Fly
// machine rotation. For a cost-aware substrate we need per-route counters
// to survive across boots so we can answer "what did this route cost over
// the last 30 days?" without an external APM.
//
// This table is the durable backing store. The middleware flushes the
// Map on a tick (interval OR threshold) into rows here, then resets the
// Map. The reader (/api/admin/telemetry, founder cost dashboard) reads
// this table for historical windows and UNIONs the current-tick Map for
// up-to-the-second numbers.
//
// Retention: open question. Default is no automatic purge — the table is
// small (one row per (route, bucket-minute)). A nightly purge job can be
// added once we have a year of data.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const apiTelemetrySamples = pgTable("api_telemetry_samples", {
  id: serial("id").primaryKey(),
  /** "GET /api/leads/:id" — same key as the in-process Map. */
  route: text("route").notNull(),
  /** Optional cost-class declared at route registration (L5b). */
  costClass: text("cost_class"),
  /** Start of the flushed window. Aligns with the tick boundary. */
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  /** End of the flushed window — set at flush time. */
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  /** Counters for the window. */
  count2xx: integer("count_2xx").notNull().default(0),
  count4xx: integer("count_4xx").notNull().default(0),
  count5xx: integer("count_5xx").notNull().default(0),
  /** Total wall-clock ms summed across all requests in the window. */
  totalMs: integer("total_ms").notNull().default(0),
  /** Latency percentile snapshots — sampled from the durations buffer. */
  p50Ms: integer("p50_ms").notNull().default(0),
  p95Ms: integer("p95_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("api_telemetry_samples_route_window_idx").on(table.route, table.windowStart),
  index("api_telemetry_samples_window_start_idx").on(table.windowStart),
]);

export type ApiTelemetrySample = typeof apiTelemetrySamples.$inferSelect;
export type InsertApiTelemetrySample = typeof apiTelemetrySamples.$inferInsert;
