/**
 * Founder forecasting outlook (W4) — read-only, founder-only.
 *
 * Feeds the Outlook section of the Letter (/founder). It is a section behind
 * an existing founder door, not a new door. Customers have no route to any
 * forecast: the customer gate (shared/forecasting/scoring.ts) needs a live
 * scored record no engine has yet, and tests/unit/forecastingStaysFounderOnly
 * holds the population of importers.
 */
import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { composeForecastOutlook } from "./services/forecasting/outlook";

export function registerFounderForecastingRoutes(app: Express): void {
  app.get(
    "/api/founder/forecasting/outlook",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        return res.json(await composeForecastOutlook());
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );
}
