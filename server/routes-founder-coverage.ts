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
import { countyDiscoveryQueue, countyGisEndpoints } from "@shared/schema";
import { desc, sql } from "drizzle-orm";
import { getCoverageLedger } from "./services/coverageLedger";

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

        logger.info("[founder-coverage] served", {
          metadata: {
            coveragePct: ledger.coveragePct,
            demandCounties: ledger.totalCounties,
            queueDepth: queue.length,
          },
        });

        return res.json({
          asOf: new Date().toISOString(),
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
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
