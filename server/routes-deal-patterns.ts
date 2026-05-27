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
import { Errors } from "./utils/errors";

const router = Router();


// Extract pattern from a closed deal (record for future matching)
router.post("/extract/:dealId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const dealId = parseInt(req.params.dealId);
    if (isNaN(dealId)) return Errors.badRequest(res, "Invalid deal ID");
    const pattern = await dealPatternCloningService.recordPatternFromClosedDeal(org.id, dealId);
    res.status(201).json({ pattern });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// Find similar patterns for a property
router.post("/find-similar", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, limit } = req.body;
    if (!propertyId) return Errors.badRequest(res, "propertyId is required");
    const matches = await dealPatternCloningService.findSimilarPatterns(
      org.id,
      propertyId,
      limit ?? 10
    );
    res.json({ matches });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// Pattern performance statistics
router.get("/performance", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const performance = await dealPatternCloningService.getPatternPerformance(org.id);
    res.json({ performance });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Derive insights from a pattern match
router.post("/insights/:matchId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return Errors.badRequest(res, "Invalid match ID");
    // Get the match and derive insights
    const insights = await dealPatternCloningService.deriveInsights({ matchId } as any);
    res.json({ insights });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// Update match outcome (did this pattern help close the deal?)
router.patch("/match/:matchId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId);
    if (isNaN(matchId)) return Errors.badRequest(res, "Invalid match ID");
    const { outcome, helpedClose } = req.body;
    await dealPatternCloningService.updateMatchOutcome(matchId, { outcome, helpedClose });
    res.json({ success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

export default router;
