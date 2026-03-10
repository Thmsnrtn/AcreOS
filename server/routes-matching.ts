// @ts-nocheck
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

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

router.post("/run", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId, buyerId } = req.body;

    const result = await matchmaking.runMatching({
      organizationId: org.id,
      propertyId: propertyId ? parseInt(propertyId) : undefined,
      buyerId: buyerId ? parseInt(buyerId) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/top-matches", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 50);

    const result = await matchmaking.getTopMatches(org.id, limit);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:propertyId/buyers", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

    const matches = await matchmaking.getMatchesForProperty(propertyId, org.id);
    res.json({ matches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/notify", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const result = await matchmaking.notifyBuyer(id, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    await matchmaking.dismissMatch(id, org.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
