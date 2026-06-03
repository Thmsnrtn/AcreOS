/**
 * Iris (CTO) — perf-monitor founder read endpoint.
 *
 *   GET /api/founder/iris-perf/recent  — last 48h of perf samples + any
 *                                        in-flight regression flags.
 *
 * Auth: isAuthenticated + requireFounder. No customer-side surface.
 *
 * The endpoint is read-only; the underlying sampler runs on the cron
 * (server/jobs/runScheduledJobs.ts → startIrisPerfMonitorJob). The
 * regression-detection is fired live on each request so the founder sees
 * an honest current-state snapshot — cheap because the dataset is
 * bounded by IRIS_TRACKED_ENDPOINTS × baselineWindowHours.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import {
  detectRegression,
  getRecentSamples,
} from "./services/iris/perfMonitor";

const DEFAULT_RECENT_HOURS = 48;

export function registerIrisPerfRoutes(app: Express): void {
  app.get(
    "/api/founder/iris-perf/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const hoursRaw = req.query.hours;
        const hours =
          typeof hoursRaw === "string"
            ? Math.min(Math.max(parseInt(hoursRaw, 10) || DEFAULT_RECENT_HOURS, 1), 168)
            : DEFAULT_RECENT_HOURS;
        const [{ byEndpoint, totalSamples }, regression] = await Promise.all([
          getRecentSamples(hours),
          detectRegression(),
        ]);
        return res.json({
          hours,
          totalSamples,
          byEndpoint,
          regressions: regression.regressions,
          endpointsChecked: regression.endpointsChecked,
          endpointsSkippedNoBaseline: regression.endpointsSkippedNoBaseline,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
