// @ts-nocheck
/**
 * T141 — Disposition Optimizer Routes
 *
 * GET  /api/disposition/:propertyId                — full recommendation
 * POST /api/disposition/:propertyId/refresh        — force-refresh recommendation
 * GET  /api/disposition/:propertyId/price          — optimal pricing
 * GET  /api/disposition/:propertyId/channels       — channel recommendations
 * GET  /api/disposition/:propertyId/timing         — timing analysis
 * GET  /api/disposition/:propertyId/roi            — ROI analysis
 * POST /api/disposition/:propertyId/compare        — compare strategies
 * GET  /api/disposition/ready                      — properties ready for disposition
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { dispositionOptimizerService } from "./services/dispositionOptimizer";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

// Full recommendation for a property
router.get("/:propertyId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const recommendation = await dispositionOptimizerService.getRecommendationsByProperty(propertyId);
    res.json({ recommendation: recommendation[0] ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Force-refresh recommendation
router.post("/:propertyId/refresh", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const recommendation = await dispositionOptimizerService.generateRecommendation(propertyId);
    res.json({ recommendation });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Optimal pricing
router.get("/:propertyId/price", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const pricing = await dispositionOptimizerService.calculateOptimalPrice(propertyId);
    res.json({ pricing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Channel recommendations
router.get("/:propertyId/channels", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const channels = await dispositionOptimizerService.recommendChannels(propertyId);
    res.json({ channels });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Timing analysis
router.get("/:propertyId/timing", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const timing = await dispositionOptimizerService.analyzeTimingFactors(propertyId);
    res.json({ timing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ROI analysis
router.get("/:propertyId/roi", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const salePrice = req.query.salePrice ? parseFloat(req.query.salePrice as string) : undefined;
    const roi = await dispositionOptimizerService.calculateROI(propertyId, salePrice);
    res.json({ roi });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Strategy comparison
router.post("/:propertyId/compare", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const { strategies } = req.body;
    const comparison = await dispositionOptimizerService.compareStrategies(propertyId, strategies);
    res.json({ comparison });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Properties ready for disposition
router.get("/ready", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const properties = await dispositionOptimizerService.getPropertiesReadyForDisposition(org.id);
    res.json({ properties });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
