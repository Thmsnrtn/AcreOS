/**
 * /api/founder/coverage — county-GIS coverage ledger (FOUNDER-ONLY).
 *
 * Answers the question the open-data strategy hinges on: "what fraction of the
 * counties our customers actually touch have a working free parcel endpoint?"
 * — and surfaces the demand-ranked discovery queue (the crawl order) so the
 * founder can see coverage growing along real demand instead of alphabetically.
 *
 * Reads the ledger from getCoverageLedger() (left-joins distinct (state,county)
 * from properties + parcel_snapshots against active county_gis_endpoints) and a
 * snapshot of the live discovery queue.
 *
 * Pattern: isAuthenticated + getOrCreateOrg + requireFounder — same gate as
 * routes-founder-pulse.ts.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { dbForReads } from "./db-replica";
import { countyCoverageRequests, countyDiscoveryQueue, countyGisEndpoints } from "@shared/schema";
import { desc, sql } from "drizzle-orm";
import { getCoverageLedger } from "./services/coverageLedger";
import { clock } from "./utils/clock";

/** dbForReads().execute() resolves to the driver's result, whose rows ride
 *  on `.rows` under pg and ARE the result under some test doubles — the same
 *  dual shape coverageLedger's ledger read handles. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function registerFounderCoverageRoutes(app: Express) {
  app.get(
    "/api/founder/coverage",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const reader = await dbForReads("founder.coverage.ledger");

        const ledger = await getCoverageLedger();

        // Seeded-endpoint totals (independent of demand) so the founder sees
        // both "of the counties customers touch" AND "total seeded counties".
        const endpointTotals = await reader
          .select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) FILTER (WHERE ${countyGisEndpoints.isActive} = true)::int`,
            reviewRequired: sql<number>`count(*) FILTER (WHERE ${countyGisEndpoints.redistributable} = 'review-required')::int`,
          })
          .from(countyGisEndpoints);

        // Live discovery-queue snapshot (the demand-ranked crawl order).
        const queue = await reader
          .select({
            id: countyDiscoveryQueue.id,
            state: countyDiscoveryQueue.state,
            county: countyDiscoveryQueue.county,
            demandCount: countyDiscoveryQueue.demandCount,
            priority: countyDiscoveryQueue.priority,
            status: countyDiscoveryQueue.status,
            attempts: countyDiscoveryQueue.attempts,
            lastResult: countyDiscoveryQueue.lastResult,
            lastRefusalReason: countyDiscoveryQueue.lastRefusalReason,
            lastAttemptAt: countyDiscoveryQueue.lastAttemptAt,
          })
          .from(countyDiscoveryQueue)
          .orderBy(
            desc(countyDiscoveryQueue.priority),
            desc(countyDiscoveryQueue.demandCount),
          )
          .limit(100);

        const queueByStatus = queue.reduce<Record<string, number>>((acc, q) => {
          acc[q.status] = (acc[q.status] ?? 0) + 1;
          return acc;
        }, {});

        // ── P1-7 / A-2: refusal-sourced demand, separated ──────────────────
        // Until P1-7 a gate refusal wrote no distinguishable artefact, so
        // this view could not tell licence-gated demand from search demand.
        // Now the queue records the latest refusal reason per county and the
        // explicit requests carry surface+reason; this section is the feed
        // dossier targeting plans against (demand-ranked, refusal-first).
        const reasonAggRows = await reader.execute(sql`
          SELECT ${countyDiscoveryQueue.lastRefusalReason} AS reason,
                 COUNT(*)::int AS counties,
                 COALESCE(SUM(${countyDiscoveryQueue.demandCount}), 0)::int AS demand
          FROM ${countyDiscoveryQueue}
          GROUP BY ${countyDiscoveryQueue.lastRefusalReason}
        `);
        const reasonAgg = rowsOf<{ reason: string | null; counties: number; demand: number }>(reasonAggRows).map((r) => ({
          reason: r.reason ?? "unrecorded",
          counties: r.counties,
          demand: r.demand,
        }));

        const gatedQueue = await reader
          .select({
            id: countyDiscoveryQueue.id,
            state: countyDiscoveryQueue.state,
            county: countyDiscoveryQueue.county,
            demandCount: countyDiscoveryQueue.demandCount,
            priority: countyDiscoveryQueue.priority,
            status: countyDiscoveryQueue.status,
          })
          .from(countyDiscoveryQueue)
          .where(sql`${countyDiscoveryQueue.lastRefusalReason} = 'gated'`)
          .orderBy(desc(countyDiscoveryQueue.demandCount), desc(countyDiscoveryQueue.priority))
          .limit(100);

        const requestAggRows = await reader.execute(sql`
          SELECT ${countyCoverageRequests.state} AS state,
                 ${countyCoverageRequests.county} AS county,
                 COUNT(*)::int AS requests,
                 COUNT(DISTINCT ${countyCoverageRequests.organizationId})::int AS orgs
          FROM ${countyCoverageRequests}
          GROUP BY ${countyCoverageRequests.state}, ${countyCoverageRequests.county}
          ORDER BY requests DESC, orgs DESC
          LIMIT 100
        `);
        const requestByCounty = rowsOf<{ state: string; county: string; requests: number; orgs: number }>(requestAggRows);

        const requestReasonRows = await reader.execute(sql`
          SELECT ${countyCoverageRequests.reason} AS reason,
                 ${countyCoverageRequests.surface} AS surface,
                 COUNT(*)::int AS requests
          FROM ${countyCoverageRequests}
          GROUP BY ${countyCoverageRequests.reason}, ${countyCoverageRequests.surface}
        `);
        const requestByReasonSurface = rowsOf<{ reason: string | null; surface: string | null; requests: number }>(requestReasonRows).map((r) => ({
          reason: r.reason ?? "unrecorded",
          surface: r.surface ?? "unrecorded",
          requests: r.requests,
        }));

        logger.info("[founder-coverage] served", {
          metadata: {
            coveragePct: ledger.coveragePct,
            demandCounties: ledger.totalCounties,
            queueDepth: queue.length,
          },
        });

        return res.json({
          asOf: clock.now().toISOString(),
          // Coverage of the counties customers ACTUALLY touch (the metric that matters).
          demandCoverage: {
            totalCounties: ledger.totalCounties,
            coveredCounties: ledger.coveredCounties,
            coveragePct: ledger.coveragePct,
            counties: ledger.counties,
          },
          // Total seeded endpoints (have-it side, regardless of demand).
          endpoints: {
            total: endpointTotals[0]?.total ?? 0,
            active: endpointTotals[0]?.active ?? 0,
            reviewRequired: endpointTotals[0]?.reviewRequired ?? 0,
          },
          // The demand-ranked discovery queue — the crawl order.
          discoveryQueue: {
            depth: queue.length,
            byStatus: queueByStatus,
            items: queue,
          },
          // P1-7 / A-2: refusal-sourced demand ranked separately from
          // search-sourced demand — the dossier-targeting feed. `gatedQueue`
          // is the licence-gate worklist (counties customers hit that the
          // gate refused); `explicitRequests` is org-attributed demand from
          // the request affordance itself, deduplicated per org+county at
          // write time (one open request per org/county).
          refusalDemand: {
            queueByReason: reasonAgg,
            gatedQueue,
            explicitRequests: {
              byCounty: requestByCounty,
              byReasonSurface: requestByReasonSurface,
            },
          },
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
