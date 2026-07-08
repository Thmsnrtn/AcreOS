/**
 * routes-market-heat.ts — Map-door county market-heat surface (Tier 3F).
 *
 * Serves the privacy-preserving county rollups (county_market_rollups) to the
 * customer Map door. The read path is honest by construction: sub-k rollup
 * rows are never materialized by the aggregation job, so anything served
 * here already cleared the k>=5 contributing-parcel floor. For counties
 * BELOW the floor we return only a parcel COUNT (never values) so the UI can
 * say exactly how many more contributing parcels the network needs.
 *
 * Routes (org-scoped, customer-facing):
 *   GET /api/market-heat/my-counties — heat for the counties in the org's own
 *       inventory (rollup where one exists, honest progress count otherwise).
 *   GET /api/market-heat/browse?state=XX — every county in a state with a
 *       materialized rollup (latest period per county).
 */

import type { Express, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { countyMarketRollups, properties } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { MIN_COHORT_SIZE } from "./services/dataCoop/privacyRollup";

/** Distinct cross-org APNs observed in a county — a count, never values. */
async function countParcelsObserved(
  state: string,
  county: string,
): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT apn)::int AS n
    FROM parcel_observations
    WHERE UPPER(state) = ${state.toUpperCase()} AND county = ${county}
  `);
  const rows = ((result as unknown as { rows?: Array<{ n: number }> })?.rows ??
    []) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** Latest-period rollup for one county, or null. */
async function latestRollup(state: string, county: string) {
  const rows = await db
    .select()
    .from(countyMarketRollups)
    .where(
      and(
        eq(countyMarketRollups.state, state.toUpperCase()),
        eq(countyMarketRollups.county, county),
      ),
    )
    .orderBy(desc(countyMarketRollups.period))
    .limit(1);
  return rows[0] ?? null;
}

export function registerMarketHeatRoutes(app: Express): void {
  app.get(
    "/api/market-heat/my-counties",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);

        // The org's own counties (from its inventory). Org scoping applies
        // ONLY to picking which counties to show — the heat data itself is
        // the org-null network aggregate.
        const countyRows = await db
          .selectDistinct({
            county: properties.county,
            state: properties.state,
          })
          .from(properties)
          .where(eq(properties.organizationId, orgId));

        const counties = countyRows
          .filter((r) => r.county && r.state)
          .slice(0, 50); // inventory spread bound — keeps this endpoint cheap

        const results = [] as Array<Record<string, unknown>>;
        for (const c of counties) {
          const state = String(c.state).toUpperCase();
          const county = String(c.county);
          const rollup = await latestRollup(state, county);
          if (rollup) {
            results.push({
              state,
              county,
              hasData: true,
              period: rollup.period,
              cohortSize: rollup.cohortSize,
              metrics: rollup.metrics,
              computedAt: rollup.computedAt,
            });
          } else {
            const parcelsObserved = await countParcelsObserved(state, county);
            results.push({
              state,
              county,
              hasData: false,
              parcelsObserved,
              parcelsNeeded: Math.max(0, MIN_COHORT_SIZE - parcelsObserved),
              privacyFloor: MIN_COHORT_SIZE,
            });
          }
        }

        res.json({ counties: results, privacyFloor: MIN_COHORT_SIZE });
      } catch (err) {
        logger.error(
          "[market-heat] my-counties failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/market-heat/browse",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const state = String(req.query.state ?? "").trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(state)) {
          return Errors.badRequest(
            res,
            "Provide a two-letter state code, e.g. ?state=TX",
          );
        }

        // Latest period per county in the state. Only materialized (>= k)
        // rollups exist, so this never leaks a thin cohort.
        const result = await db.execute<Record<string, unknown>>(sql`
          SELECT DISTINCT ON (county)
            state, county, period, metrics, cohort_size AS "cohortSize",
            computed_at AS "computedAt"
          FROM county_market_rollups
          WHERE state = ${state}
          ORDER BY county, period DESC
        `);
        const rows = ((result as unknown as { rows?: unknown[] })?.rows ??
          []) as Array<Record<string, unknown>>;

        res.json({
          state,
          counties: rows,
          privacyFloor: MIN_COHORT_SIZE,
        });
      } catch (err) {
        logger.error(
          "[market-heat] browse failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
