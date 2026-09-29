/**
 * routes-market-heat.ts — Map-door county market-heat surface (Tier 3F).
 *
 * Serves the privacy-preserving county rollups (county_market_rollups) to the
 * customer Map door. The read path is honest by construction: sub-k rollup
 * rows are never materialized by the aggregation job, so anything served
 * here already cleared its floors — since founder ruling 2026-09-29 #11,
 * opt-in data from at least five operators (DEFECT-0159). Two more rules:
 *  - a rollup computed before that rule took effect was built without
 *    consent and is never served (`CROSS_ORG_CONSENT_EFFECTIVE_AT`); rows are
 *    recomputed monthly, so an opt-out leaves the served figures at the next
 *    run;
 *  - a county BELOW the floor shows no count at all. It used to show how many
 *    parcels other operators had touched there (1–4) — itself a figure about
 *    other customers' activity with no floor behind it.
 *
 * Routes (org-scoped, customer-facing):
 *   GET /api/market-heat/my-counties — heat for the counties in the org's own
 *       inventory (rollup where one exists, honest progress count otherwise).
 *   GET /api/market-heat/browse?state=XX — every county in a state with a
 *       materialized rollup (latest period per county).
 */

import type { Express, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { countyMarketRollups, properties } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { MIN_COHORT_SIZE, MIN_DISTINCT_OPERATORS } from "./services/dataCoop/privacyRollup";
import { CROSS_ORG_CONSENT_EFFECTIVE_AT } from "./services/sophiePrivacyGuard";

/** Latest-period rollup for one county computed under the consent rule, or null. */
async function latestRollup(state: string, county: string) {
  const rows = await db
    .select()
    .from(countyMarketRollups)
    .where(
      and(
        eq(countyMarketRollups.state, state.toUpperCase()),
        eq(countyMarketRollups.county, county),
        gte(countyMarketRollups.computedAt, CROSS_ORG_CONSENT_EFFECTIVE_AT),
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
            // No count: how many parcels others touched is itself a figure
            // about them, and below the floor there is nothing to show.
            results.push({
              state,
              county,
              hasData: false,
              privacyFloor: MIN_DISTINCT_OPERATORS,
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
            AND computed_at >= ${CROSS_ORG_CONSENT_EFFECTIVE_AT}
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
