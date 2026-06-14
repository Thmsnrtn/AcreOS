/**
 * T227 — Buyer Matching Engine Routes
 *
 * POST /api/matching/run              — run matching algorithm
 * GET  /api/matching/top-matches      — get top matches for org
 * GET  /api/matching/:propertyId/buyers — matches for a property
 * GET  /api/matching/:buyerId/properties — matches for a buyer
 * POST /api/matching/:id/notify       — notify buyer of match
 * DELETE /api/matching/:id            — dismiss a match
 */

import { Router, type Request, type Response } from "express";
import { matchmaking } from "./services/matchmaking";
import { Errors, sendError } from "./utils/errors";

const router = Router();

// TODO(tsc): the matchmaking service exposes findMatchesForInvestor,
// findBuyersForListing, getRecommendations, notifyMatchedBuyers, and
// calculateSimilarity — NOT the runMatching/getTopMatches/getMatchesForProperty/
// notifyBuyer/dismissMatch API these routes were written against. The endpoints
// crashed at runtime previously (undefined methods). The two endpoints with a
// clear service equivalent are wired below; the rest return 501 until the
// service surface is reconciled.

router.post("/run", async (_req: Request, res: Response) => {
  sendError(res, 501, "NOT_IMPLEMENTED", "Match run endpoint not implemented");
});

router.get("/top-matches", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await matchmaking.getRecommendations(org.id);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/:propertyId/buyers", async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const matches = await matchmaking.findBuyersForListing(propertyId);
    res.json({ matches });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/:id/notify", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const notified = await matchmaking.notifyMatchedBuyers(id);
    res.json({ notified });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.delete("/:id", async (_req: Request, res: Response) => {
  sendError(res, 501, "NOT_IMPLEMENTED", "Dismiss match endpoint not implemented");
});

export default router;
