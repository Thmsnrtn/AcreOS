/**
 * Beatrice (CRO) — regulatory-news feed founder read endpoint.
 *
 *   GET /api/founder/beatrice-regwatch/recent — last 30 days of matched
 *                                               regulatory events + by-source
 *                                               counts + unreviewed count.
 *
 * Auth: isAuthenticated + requireFounder. No customer-side surface.
 *
 * The endpoint is read-only; the underlying ingest runs on the cron
 * (server/jobs/runScheduledJobs.ts → startBeatriceRegWatchJob). Beatrice's
 * 72h triage discipline (docs/legal/beatrice-regwatch-discipline.md)
 * uses the unreviewedCount as the SLA signal.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { getRecentRegEvents } from "./services/beatrice/regWatch";

const DEFAULT_DAYS = 30;

export function registerBeatriceRegWatchRoutes(app: Express): void {
  app.get(
    "/api/founder/beatrice-regwatch/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const daysRaw = req.query.days;
        const days =
          typeof daysRaw === "string"
            ? Math.min(Math.max(parseInt(daysRaw, 10) || DEFAULT_DAYS, 1), 365)
            : DEFAULT_DAYS;
        const data = await getRecentRegEvents(days);
        return res.json({
          days,
          totalEvents: data.events.length,
          unreviewedCount: data.unreviewedCount,
          bySource: data.bySource,
          events: data.events,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
