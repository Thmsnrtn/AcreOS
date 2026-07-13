/**
 * Syndication channel routes (founder decision D7, 2026-07-11).
 *
 * The /syndication customer page (listing-syndication.tsx) contract:
 *   GET   /api/syndication/status                → SyndicationSummaryView
 *   POST  /api/syndication/sync-all              → sync every enabled channel
 *   PATCH /api/syndication/channels/:channelId   → { enabled } toggle
 *   POST  /api/syndication/channels/:channelId/sync → sync one channel
 *
 * The legacy per-listing endpoints (/api/syndication/platforms,
 * /api/listings/:id/syndicate, /api/syndication/take-down) stay in
 * routes-elite-features.ts; this file owns the channel model.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import {
  getSyndicationSummary,
  setChannelEnabled,
  syncChannels,
  isKnownChannel,
} from "./services/syndicationChannels";

const auth = [isAuthenticated, getOrCreateOrg];

const toggleSchema = z.object({ enabled: z.boolean() });

export function registerSyndicationRoutes(app: Express): void {
  app.get("/api/syndication/status", ...auth, async (req, res: Response) => {
    try {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      res.json(await getSyndicationSummary(orgId));
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/syndication/sync-all", ...auth, async (req, res: Response) => {
    try {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const outcomes = await syncChannels(orgId);
      res.json({ outcomes });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.patch("/api/syndication/channels/:channelId", ...auth, async (req, res: Response) => {
    try {
      const { channelId } = req.params;
      if (!isKnownChannel(channelId)) return Errors.notFound(res, "Syndication channel");

      const parsed = toggleSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const orgId = getOrganizationId(req as AuthenticatedRequest);
      await setChannelEnabled(orgId, channelId, parsed.data.enabled);
      res.json({ channelId, enabled: parsed.data.enabled });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/syndication/channels/:channelId/sync", ...auth, async (req, res: Response) => {
    try {
      const { channelId } = req.params;
      if (!isKnownChannel(channelId)) return Errors.notFound(res, "Syndication channel");

      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const outcomes = await syncChannels(orgId, [channelId]);
      if (outcomes.length === 0) {
        return Errors.badRequest(res, "Channel is not enabled — turn it on before syncing.");
      }
      res.json({ outcomes });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });
}
