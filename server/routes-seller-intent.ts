// @ts-nocheck
/**
 * T142 — Seller Intent Predictor Routes
 *
 * GET  /api/seller-intent/:leadId              — predict intent for a lead
 * GET  /api/seller-intent/:leadId/signals      — breakdown of all signals
 * GET  /api/seller-intent/:leadId/urgency      — urgency signal analysis
 * GET  /api/seller-intent/:leadId/financial    — financial distress signals
 * GET  /api/seller-intent/:leadId/engagement   — engagement pattern signals
 * POST /api/seller-intent/:leadId/approach     — recommended approach strategy
 * POST /api/seller-intent/:leadId/offer-range  — suggested offer range
 * POST /api/seller-intent/:leadId/outcome      — record negotiation outcome
 * GET  /api/seller-intent/accuracy             — model accuracy stats
 * GET  /api/seller-intent/hot-leads            — leads with high intent (org-wide)
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { sellerIntentPredictorService } from "./services/sellerIntentPredictor";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

// Full intent prediction for a lead
router.get("/:leadId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const prediction = await sellerIntentPredictorService.predictIntent(leadId);
    res.json({ prediction });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Urgency signals
router.get("/:leadId/urgency", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const signals = await sellerIntentPredictorService.analyzeUrgencySignals(leadId);
    res.json({ signals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Financial distress signals
router.get("/:leadId/financial", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
    const signals = await sellerIntentPredictorService.analyzeFinancialSignals(leadId, propertyId);
    res.json({ signals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Engagement signals
router.get("/:leadId/engagement", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const signals = await sellerIntentPredictorService.analyzeEngagementSignals(leadId);
    res.json({ signals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Price flexibility signals
router.get("/:leadId/price-flexibility", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const signals = await sellerIntentPredictorService.analyzePriceFlexibility(leadId);
    res.json({ signals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Recommended approach strategy
router.post("/:leadId/approach", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const approach = await sellerIntentPredictorService.generateApproachRecommendation(leadId);
    res.json({ approach });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Suggested offer range
router.post("/:leadId/offer-range", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const { propertyId } = req.body;
    const range = await sellerIntentPredictorService.suggestOfferRange(leadId, propertyId);
    res.json({ range });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Record negotiation outcome (for model training)
router.post("/:leadId/outcome", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
    const { outcome, finalPrice, notes } = req.body;
    if (!outcome) return res.status(400).json({ error: "outcome is required" });
    await sellerIntentPredictorService.recordOutcome(leadId, outcome, finalPrice, notes);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Model accuracy stats
router.get("/accuracy", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const accuracy = await sellerIntentPredictorService.analyzeAccuracy(org.id);
    res.json({ accuracy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Hot leads (high intent) for the organization
router.get("/hot-leads", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const minScore = parseFloat((req.query.minScore as string) || "60");
    const predictions = await sellerIntentPredictorService.getLeadPredictions(org.id, minScore);
    res.json({ predictions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
