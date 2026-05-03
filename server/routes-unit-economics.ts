/**
 * routes-unit-economics — Founder-only per-customer profit-margin endpoint.
 *
 * GET /api/founder/unit-economics
 *   Returns the latest snapshot per org plus aggregate totals and a 90-day
 *   trend series for /founder/unit-economics. Sorted by margin ASC so the
 *   page can split top-10-unprofitable from top-10-profitable client-side
 *   without re-sorting.
 *
 * POST /api/founder/unit-economics/recompute
 *   Triggers an out-of-band recompute. Intended for the manual "refresh now"
 *   button on the dashboard. Synchronous; on a 50-org cluster this returns
 *   in ~1-2s. We return after persisting all snapshots so the next GET sees
 *   the fresh data.
 *
 * Both endpoints are gated behind `isFounder` — non-founder orgs get 403.
 */

import type { Express, Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { computeAllOrgs, readUnitEconomicsRollup } from "./services/unitEconomics";

export function registerUnitEconomicsRoutes(app: Express): void {
  app.get(
    "/api/founder/unit-economics",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Unit economics dashboard is restricted to founders");
        }
        const data = await readUnitEconomicsRollup();
        return res.json(data);
      } catch (err) {
        logger.error("[unit-economics] read failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/unit-economics/recompute",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Unit economics recompute is restricted to founders");
        }
        const processed = await computeAllOrgs();
        const data = await readUnitEconomicsRollup();
        return res.json({ processed, ...data });
      } catch (err) {
        logger.error("[unit-economics] recompute failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
