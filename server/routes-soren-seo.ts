/**
 * Soren (CGO) — SEO ranking founder read endpoint.
 *
 *   GET /api/founder/soren-seo/recent — last 30 days of /learn rankings
 *                                       (rows + grouped-by-page view).
 *
 * Auth: isAuthenticated + requireFounder. No customer-side surface.
 *
 * The endpoint is read-only; the underlying tracker runs on the cron
 * (server/jobs/runScheduledJobs.ts → startSorenSeoTrackerJob). Surfaced
 * in the morning brief context Solene consumes.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { getRecentRankings } from "./services/soren/seoTracker";
import { LEARN_SEO_TARGETS, LEARN_SEO_TOTAL_KEYWORDS } from "./services/soren/seoTargets";

const DEFAULT_DAYS = 30;

export function registerSorenSeoRoutes(app: Express): void {
  app.get(
    "/api/founder/soren-seo/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const daysRaw = req.query.days;
        const days =
          typeof daysRaw === "string"
            ? Math.min(Math.max(parseInt(daysRaw, 10) || DEFAULT_DAYS, 1), 365)
            : DEFAULT_DAYS;
        const data = await getRecentRankings(days);
        return res.json({
          days,
          totalRankings: data.rankings.length,
          trackedPages: LEARN_SEO_TARGETS.length,
          trackedKeywords: LEARN_SEO_TOTAL_KEYWORDS,
          rankings: data.rankings,
          byPage: data.byPage,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
