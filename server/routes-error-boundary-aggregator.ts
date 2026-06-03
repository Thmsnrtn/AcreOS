/**
 * SOLENE — customer-surface ErrorBoundary aggregator endpoints.
 *
 *   GET /api/founder/error-boundary-trips/counts?windowHours=24
 *     Auth: isAuthenticated + requireFounder
 *     Returns counts grouped by route_path AND by error_name over the
 *     window. Used by the diagnostic panel + morning brief composition.
 *
 *   GET /api/internal/error-boundary-trips/pulse-segment?windowHours=24
 *     Auth: open (mirrors the existing solene-capital envelope pattern
 *           the daily-pulse cron consumes — payload is non-sensitive,
 *           counts-only).
 *     Returns the one-line pulse extension string.
 *
 * The per-trip POST + the recent-list founder GET live in
 * server/routes-error-boundary.ts. Split apart so the schema + write
 * endpoint can ship in one commit and the aggregator-read endpoints in the
 * follow-up — the deploy ordering stays bisectable.
 */

import type { Express, Request, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import {
  getRecentTripCounts,
  getDailyPulseSegment,
} from "./services/customer-surface/errorBoundaryAggregator";

export function registerErrorBoundaryAggregatorRoutes(app: Express): void {
  app.get(
    "/api/founder/error-boundary-trips/counts",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const windowHours = Math.min(
          Math.max(Number(req.query.windowHours ?? 24) || 24, 1),
          24 * 30,
        );
        const counts = await getRecentTripCounts(windowHours);
        return res.json(counts);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/internal/error-boundary-trips/pulse-segment",
    async (req: Request, res: Response) => {
      try {
        const windowHours = Math.min(
          Math.max(Number(req.query.windowHours ?? 24) || 24, 1),
          24 * 7,
        );
        const segment = await getDailyPulseSegment(windowHours);
        return res.json({ segment, windowHours });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
