/**
 * T149 — Deal Pattern Cloning Routes
 *
 * POST /api/deal-patterns/extract/:dealId     — extract pattern from closed deal
 * POST /api/deal-patterns/find-similar        — find deals matching a pattern
 * GET  /api/deal-patterns/performance         — pattern performance stats
 * POST /api/deal-patterns/insights/:matchId   — derive insights from pattern match
 * PATCH /api/deal-patterns/match/:matchId     — update match outcome
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { dealPatternCloningService } from "./services/dealPatternCloning";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

// Extract pattern from a closed deal (record for future matching)
router.post("/extract/:dealId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const dealId = parseInt(req.params.dealId);
    if (isNaN(dealId)) return res.status(400).json({ error: "Invalid deal ID" });
    const pattern = await dealPatternCloningService.recordPatternFromClosedDeal(org.id, dealId);
    res.status(201).json({ pattern });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Find similar patterns for a property
router.post("/find-similar", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId, limit } = req.body;
    if (!propertyId) return res.status(400).json({ error: "propertyId is required" });
    const matches = await dealPatternCloningService.findSimilarPatterns(
      org.id,
      propertyId,
      limit ?? 10
    );
    res.json({ matches });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pattern performance statistics
router.get("/performance", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const performance = await dealPatternCloningService.getPatternPerformance(org.id);
    res.json({ performance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Derive insights from a pattern match
router.post("/insights/:matchId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ error: "Invalid match ID" });
    // Get the match and derive insights
    const insights = await dealPatternCloningService.deriveInsights({ matchId } as any);
    res.json({ insights });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Update match outcome (did this pattern help close the deal?)
router.patch("/match/:matchId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return res.status(400).json({ error: "Invalid match ID" });
    const { outcome, helpedClose } = req.body;
    await dealPatternCloningService.updateMatchOutcome(matchId, { outcome, helpedClose });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
