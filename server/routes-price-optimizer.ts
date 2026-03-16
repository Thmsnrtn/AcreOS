/**
 * T150 — Price Optimizer Routes
 *
 * POST /api/price-optimizer/:propertyId/acquisition   — recommend acquisition price
 * POST /api/price-optimizer/:propertyId/disposition   — recommend disposition price
 * POST /api/price-optimizer/:propertyId/counter       — recommend counter-offer price
 * GET  /api/price-optimizer/:propertyId               — get all recommendations for property
 * POST /api/price-optimizer/outcome/:id               — record actual price outcome
 * GET  /api/price-optimizer/accuracy                  — accuracy metrics for org
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { priceOptimizerService } from "./services/priceOptimizer";

const router = Router();

function getOrg(req: Request) {
  return (req as any).organization;
}

// Recommend acquisition price for a property
router.post("/:propertyId/acquisition", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid propertyId" });

    const { targetMargin } = req.body;
    const recommendation = await priceOptimizerService.recommendAcquisitionPrice(
      org.id,
      propertyId,
      targetMargin
    );
    res.json({ recommendation });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Recommend disposition/listing price
router.post("/:propertyId/disposition", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid propertyId" });

    const { quickSale } = req.body;
    const recommendation = await priceOptimizerService.recommendDispositionPrice(
      org.id,
      propertyId,
      quickSale
    );
    res.json({ recommendation });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Recommend counter-offer price
router.post("/:propertyId/counter", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid propertyId" });

    const { currentOffer, sellerAsk } = req.body;
    if (!currentOffer || !sellerAsk) {
      return res.status(400).json({ error: "currentOffer and sellerAsk are required" });
    }

    const recommendation = await priceOptimizerService.recommendCounterOffer(
      org.id,
      propertyId,
      Number(currentOffer),
      Number(sellerAsk)
    );
    res.json({ recommendation });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get all recommendations for a property
router.get("/:propertyId", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid propertyId" });

    const recommendations = await priceOptimizerService.getPropertyRecommendations(org.id, propertyId);
    res.json({ recommendations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record actual price outcome for a recommendation
router.post("/outcome/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid recommendation id" });

    const { actualPrice, accepted } = req.body;
    if (actualPrice === undefined || accepted === undefined) {
      return res.status(400).json({ error: "actualPrice and accepted are required" });
    }

    await priceOptimizerService.recordPriceOutcome(id, Number(actualPrice), Boolean(accepted));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get accuracy metrics for the organization
router.get("/accuracy/stats", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const metrics = await priceOptimizerService.analyzeRecommendationAccuracy(org.id);
    res.json({ metrics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
