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
import { Errors } from "./utils/errors";

const router = Router();


router.post("/run", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, buyerId } = req.body;

    const result = await matchmaking.runMatching({
      organizationId: org.id,
      propertyId: propertyId ? parseInt(propertyId) : undefined,
      buyerId: buyerId ? parseInt(buyerId) : undefined,
    });
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/top-matches", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 50);

    const result = await matchmaking.getTopMatches(org.id, limit);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/:propertyId/buyers", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const matches = await matchmaking.getMatchesForProperty(propertyId, org.id);
    res.json({ matches });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/:id/notify", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const result = await matchmaking.notifyBuyer(id, org.id);
    res.json(result);
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    await matchmaking.dismissMatch(id, org.id);
    res.json({ success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

export default router;
