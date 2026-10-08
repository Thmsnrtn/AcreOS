/**
 * Deal Feed Routes
 *
 * GET  /api/deal-feed           — today's feed (generates if not exists), marks viewed
 * POST /api/deal-feed/refresh   — force regenerate (rate limit: 1/hour)
 * POST /api/deal-feed/:opportunityId/action — record interaction
 */

import { Router, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { getTodaysFeed, generateDealFeed, recordInteraction } from "./services/dealFeedEngine";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";

const router = Router();

// Rate limit tracking for refresh — 1/hour per org
const refreshTimestamps = new Map<number, number>();

router.get("/", isAuthenticated, getOrCreateOrg, async (req, res: Response) => {
  try {
    const orgId = getOrganizationId(req as AuthenticatedRequest);
    const feed = await getTodaysFeed(orgId);
    res.json({ opportunities: feed, generatedAt: clock.now().toISOString() });
  } catch (err) {
    logger.error("deal feed fetch failed", { error: err instanceof Error ? err.message : String(err) });
    Errors.internal(res, err);
  }
});

router.post("/refresh", isAuthenticated, getOrCreateOrg, async (req, res: Response) => {
  try {
    const orgId = getOrganizationId(req as AuthenticatedRequest);

    // Rate limit: 1/hour
    const lastRefresh = refreshTimestamps.get(orgId) || 0;
    const hourAgo = clock.nowMs() - 60 * 60 * 1000;
    if (lastRefresh > hourAgo) {
      return Errors.limitExceeded(res, {
        message: "Feed can only be refreshed once per hour",
        retryAfter: Math.ceil((lastRefresh + 60 * 60 * 1000 - clock.nowMs()) / 1000),
      });
    }

    refreshTimestamps.set(orgId, clock.nowMs());
    const feed = await generateDealFeed(orgId);
    res.json({ opportunities: feed, generatedAt: clock.now().toISOString() });
  } catch (err) {
    logger.error("deal feed refresh failed", { error: err instanceof Error ? err.message : String(err) });
    Errors.internal(res, err);
  }
});

router.post("/:opportunityId/action", isAuthenticated, getOrCreateOrg, async (req, res: Response) => {
  try {
    const orgId = getOrganizationId(req as AuthenticatedRequest);
    const { opportunityId } = req.params;
    const { action, metadata } = req.body;

    if (!action || !["interested", "pass", "offer_sent", "deal_created"].includes(action)) {
      return Errors.badRequest(res, "action must be one of: interested, pass, offer_sent, deal_created");
    }

    await recordInteraction(orgId, opportunityId, action, metadata);
    res.json({ success: true, action });
  } catch (err) {
    logger.error("deal feed action failed", { error: err instanceof Error ? err.message : String(err) });
    Errors.internal(res, err);
  }
});

export default router;
