// ============================================================================
// SHARED/SCHEMA/ERROR-BOUNDARY-TRIPS.TS
// ----------------------------------------------------------------------------
// SOLENE — customer-surface ErrorBoundary trip ledger.
//
// One row per ErrorBoundary fire. The boundary at
// client/src/components/error-boundary.tsx already forwards to Sentry +
// clientLogger, but Sentry's surface isn't woven into Solene's morning
// brief or her proactive page channel — so trips silently piled up in
// Sentry without ever crossing Tom's awareness until he reported the
// surface himself.
//
// This ledger closes the gap. The endpoint at
// server/routes-error-boundary.ts inserts on every trip, the aggregator at
// server/services/customer-surface/errorBoundaryAggregator.ts polls for
// spikes (>5 trips on a single route in 1h = severity=urgent page), and the
// founder endpoint at GET /api/founder/error-boundary-trips/recent surfaces
// the 7-day window.
//
// PII discipline: the message / component-stack columns are
// length-capped (CONTENT_EXCERPT_CHARS = 500) and pass through the same
// PII redactor as server/utils/logger.ts when written. No raw user content
// or stack traces longer than the excerpt survive.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import { users } from "../models/auth";

export const ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS = 500;

export const errorBoundaryTrips = pgTable(
  "error_boundary_trips",
  {
    id: serial("id").primaryKey(),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Client-side correlation id (err_<ts>_<rand>) emitted by the boundary.
    // Lets engineering pivot from a Sentry event back to this row + vice versa.
    errorId: text("error_id").notNull(),
    errorName: text("error_name").notNull(),
    // Length-capped by the endpoint before insert — schema doesn't enforce
    // (Postgres text has no useful max) but the service does.
    errorMessageExcerpt: text("error_message_excerpt").notNull(),
    routePath: text("route_path").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    organizationId: integer("organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    componentStackExcerpt: text("component_stack_excerpt"),
    // Free-form client meta — viewport, user-agent, dpr, color-scheme, etc.
    // Aggregator reads { route, errorName } shape primarily; this is the
    // forensic surface for post-hoc investigation.
    clientMeta: jsonb("client_meta").$type<Record<string, unknown>>(),
    // info | warn | urgent | critical — the aggregator escalates urgent
    // when route+error spikes; per-trip writes default to "warn".
    severity: text("severity").notNull().default("warn"),
  },
  (t) => [
    index("error_boundary_trips_fired_idx").on(t.firedAt),
    index("error_boundary_trips_route_fired_idx").on(t.routePath, t.firedAt),
    index("error_boundary_trips_org_fired_idx").on(
      t.organizationId,
      t.firedAt,
    ),
  ],
);

export type ErrorBoundaryTrip = typeof errorBoundaryTrips.$inferSelect;
export type InsertErrorBoundaryTrip = typeof errorBoundaryTrips.$inferInsert;

export const ERROR_BOUNDARY_SEVERITIES = [
  "info",
  "warn",
  "urgent",
  "critical",
] as const;
export type ErrorBoundaryTripSeverity =
  (typeof ERROR_BOUNDARY_SEVERITIES)[number];
