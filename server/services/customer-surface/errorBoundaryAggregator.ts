/**
 * SOLENE — customer-surface ErrorBoundary trip aggregator.
 *
 * Reads the error_boundary_trips ledger and produces the two derived signals
 * the team uses to detect customer-surface regressions:
 *
 *   1. getRecentTripCounts(windowHours)
 *      → counts by route_path and by error_name over the window. Surfaces
 *        which surface is spiking and which error class drives it.
 *
 *   2. detectAndPageOnSpike()
 *      → cron-tickable. When >5 trips fire in 1h on a single route, escalates
 *        severity=urgent and pages Solene (POST /api/internal/solene/page via
 *        the in-process pagerService). One page per (route, hour) so a long
 *        spike doesn't loop-page.
 *
 *   3. getDailyPulseSegment()
 *      → formats the daily-pulse one-line extension:
 *        ` · error-boundary trips: X in 24h (Y unique routes)`
 *        Empty string when 0 trips — the pulse stays terse on calm days.
 *
 * THRESHOLDS — externalized so the per-environment knob is a single edit.
 *   SPIKE_TRIPS_PER_HOUR = 5    → above this on a single route = page
 *   PULSE_MIN_TRIPS      = 1    → below this, omit from pulse
 *   SPIKE_DEDUPE_HOURS   = 1    → don't re-page the same route within 1h
 *
 * Discipline: every page references the route + error_name + count so Tom
 * can triage from the lock-screen notification without opening the app.
 */

import { and, count, desc, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  errorBoundaryTrips,
  type ErrorBoundaryTrip,
} from "@shared/schema/error-boundary-trips";
import { solenePageEvents } from "@shared/schema/solene-page";
import { sendSolenePage } from "../solene/pagerService";
import { logger } from "../../utils/logger";

export const SPIKE_TRIPS_PER_HOUR = 5;
export const PULSE_MIN_TRIPS = 1;
export const SPIKE_DEDUPE_HOURS = 1;
const DEFAULT_PULSE_WINDOW_HOURS = 24;

export interface RouteTripCount {
  routePath: string;
  trips: number;
}

export interface ErrorNameTripCount {
  errorName: string;
  trips: number;
}

export interface RecentTripCounts {
  windowHours: number;
  totalTrips: number;
  byRoute: RouteTripCount[];
  byErrorName: ErrorNameTripCount[];
  uniqueRoutes: number;
}

/**
 * Count trips by route + by error_name within the window. Used by the
 * page-on-spike tick AND the founder-surface diagnostic. Both groupings
 * are returned in the same call so callers don't run two queries.
 */
export async function getRecentTripCounts(
  windowHours: number = 24,
): Promise<RecentTripCounts> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const byRoute = await db
    .select({
      routePath: errorBoundaryTrips.routePath,
      trips: count(errorBoundaryTrips.id),
    })
    .from(errorBoundaryTrips)
    .where(gte(errorBoundaryTrips.firedAt, cutoff))
    .groupBy(errorBoundaryTrips.routePath)
    .orderBy(desc(count(errorBoundaryTrips.id)));

  const byErrorName = await db
    .select({
      errorName: errorBoundaryTrips.errorName,
      trips: count(errorBoundaryTrips.id),
    })
    .from(errorBoundaryTrips)
    .where(gte(errorBoundaryTrips.firedAt, cutoff))
    .groupBy(errorBoundaryTrips.errorName)
    .orderBy(desc(count(errorBoundaryTrips.id)));

  const totalTrips = byRoute.reduce((sum, r) => sum + Number(r.trips), 0);

  return {
    windowHours,
    totalTrips,
    byRoute: byRoute.map((r) => ({
      routePath: r.routePath,
      trips: Number(r.trips),
    })),
    byErrorName: byErrorName.map((r) => ({
      errorName: r.errorName,
      trips: Number(r.trips),
    })),
    uniqueRoutes: byRoute.length,
  };
}

export interface SpikeDetectionResult {
  spikes: Array<{
    routePath: string;
    trips: number;
    paged: boolean;
    skipReason?: string;
  }>;
  pagedCount: number;
  examinedRoutes: number;
}

/**
 * Look for route-level spikes in the last hour and page Solene when found.
 * Dedupes against solene_page_events so a sustained spike pages once per
 * SPIKE_DEDUPE_HOURS window, not on every cron tick.
 */
export async function detectAndPageOnSpike(): Promise<SpikeDetectionResult> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recentByRoute = await db
    .select({
      routePath: errorBoundaryTrips.routePath,
      trips: count(errorBoundaryTrips.id),
    })
    .from(errorBoundaryTrips)
    .where(gte(errorBoundaryTrips.firedAt, oneHourAgo))
    .groupBy(errorBoundaryTrips.routePath)
    .orderBy(desc(count(errorBoundaryTrips.id)));

  const result: SpikeDetectionResult = {
    spikes: [],
    pagedCount: 0,
    examinedRoutes: recentByRoute.length,
  };

  for (const row of recentByRoute) {
    const trips = Number(row.trips);
    if (trips <= SPIKE_TRIPS_PER_HOUR) continue;

    // Dedupe: has a page already fired for this route in the last
    // SPIKE_DEDUPE_HOURS window? Match by subject substring.
    const dedupeCutoff = new Date(
      Date.now() - SPIKE_DEDUPE_HOURS * 60 * 60 * 1000,
    );
    const subjectMarker = `error-boundary spike: ${row.routePath}`;
    const existing = await db
      .select({ id: solenePageEvents.id })
      .from(solenePageEvents)
      .where(
        and(
          gte(solenePageEvents.firedAt, dedupeCutoff),
          sql`${solenePageEvents.subject} = ${subjectMarker}`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      result.spikes.push({
        routePath: row.routePath,
        trips,
        paged: false,
        skipReason: `already paged within ${SPIKE_DEDUPE_HOURS}h`,
      });
      continue;
    }

    try {
      await sendSolenePage({
        severity: "urgent",
        // Jarvis 2.2 explicit class mapping: a customer-surface regression is
        // customer harm — Class A (breaks through budget and quiet hours).
        interruptClass: "A",
        subject: subjectMarker,
        body: `Route ${row.routePath} fired ErrorBoundary ${trips} times in the last hour (threshold=${SPIKE_TRIPS_PER_HOUR}). Customer-surface regression suspected. See GET /api/founder/error-boundary-trips/recent.`,
      });
      result.spikes.push({ routePath: row.routePath, trips, paged: true });
      result.pagedCount += 1;
    } catch (err) {
      logger.error(
        "[errorBoundaryAggregator] page-on-spike failed",
        err instanceof Error ? err : undefined,
        { metadata: { routePath: row.routePath, trips } },
      );
      result.spikes.push({
        routePath: row.routePath,
        trips,
        paged: false,
        skipReason: "page send failed",
      });
    }
  }

  logger.info("[errorBoundaryAggregator] spike check complete", {
    metadata: {
      examinedRoutes: result.examinedRoutes,
      spikes: result.spikes.length,
      pagedCount: result.pagedCount,
    },
  });

  return result;
}

/**
 * Daily-pulse one-line extension. Mirrors the existing solene-capital
 * envelope segment shape so the pulse-composer YAML can curl this endpoint
 * with a 3s timeout and concatenate the segment.
 *
 * Returns empty string when totalTrips < PULSE_MIN_TRIPS so calm days
 * stay terse.
 */
export async function getDailyPulseSegment(
  windowHours: number = DEFAULT_PULSE_WINDOW_HOURS,
): Promise<string> {
  const counts = await getRecentTripCounts(windowHours);
  if (counts.totalTrips < PULSE_MIN_TRIPS) return "";
  return ` · error-boundary trips: ${counts.totalTrips} in ${windowHours}h (${counts.uniqueRoutes} unique routes)`;
}

/**
 * Convenience read for the founder endpoint — last N trips as raw rows.
 */
export async function getRecentTrips(
  windowDays: number = 7,
  limit: number = 500,
): Promise<ErrorBoundaryTrip[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(errorBoundaryTrips)
    .where(gte(errorBoundaryTrips.firedAt, cutoff))
    .orderBy(desc(errorBoundaryTrips.firedAt))
    .limit(limit);
}
