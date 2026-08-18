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
import {
  sellerIntentPredictorService,
  SellerIntentNotInOrgError,
} from "./services/sellerIntentPredictor";
import { Errors } from "./utils/errors";
import { getOrganizationId } from "./types/request";

const router = Router();


  // accuracy — registered BEFORE /:leadId so the literal path wins (2026-07-11 route-order sweep).
// Model accuracy stats
router.get("/accuracy", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const accuracy = await sellerIntentPredictorService.analyzeAccuracy(org.id);
    res.json({ accuracy });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

  // hot-leads — registered BEFORE /:leadId so the literal path wins (2026-07-11 route-order sweep).
// Hot leads (high intent) for the organization
router.get("/hot-leads", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const minScore = parseFloat((req.query.minScore as string) || "60");
    const predictions = await sellerIntentPredictorService.getLeadPredictions(org.id, minScore);
    res.json({ predictions });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Full intent prediction for a lead
router.get("/:leadId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const prediction = await sellerIntentPredictorService.predictIntent(org.id, leadId);
    res.json({ prediction });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Urgency signals
router.get("/:leadId/urgency", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const signals = await sellerIntentPredictorService.analyzeUrgencySignals(org.id, leadId);
    res.json({ signals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Financial distress signals
router.get("/:leadId/financial", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
    const signals = await sellerIntentPredictorService.analyzeFinancialSignals(org.id, leadId, propertyId);
    res.json({ signals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Engagement signals
router.get("/:leadId/engagement", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const signals = await sellerIntentPredictorService.analyzeEngagementSignals(org.id, leadId);
    res.json({ signals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Price flexibility signals
router.get("/:leadId/price-flexibility", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const signals = await sellerIntentPredictorService.analyzePriceFlexibility(org.id, leadId);
    res.json({ signals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Recommended approach strategy
router.post("/:leadId/approach", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    // generateApproachRecommendation operates on computed signals; deriving the
    // recommendation for a lead goes through predictIntent, which produces and
    // persists the recommendedApproach + approachReasoning fields.
    const prediction = await sellerIntentPredictorService.predictIntent(org.id, leadId);
    const approach = {
      recommendedApproach: prediction.recommendedApproach,
      approachReasoning: prediction.approachReasoning,
    };
    res.json({ approach });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Suggested offer range
router.post("/:leadId/offer-range", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const { propertyId } = req.body;
    // Was `suggestOfferRange(leadId, propertyId)` against a
    // `(propertyId, signals)` signature — `req.body` is `any`, so passing the
    // LEAD id as the property id and the property id as the signals object
    // type-checked. The range was therefore derived from whatever property
    // happened to share an id with the lead, or from nothing.
    //
    // `predictIntent` is the canonical path: it scopes by organization, runs
    // all six analysers, and computes `suggestedOfferRange` from the real
    // signals. Deriving it a second way here is what produced the bug.
    const prediction = await sellerIntentPredictorService.predictIntent(
      org.id,
      leadId,
      propertyId ? Number(propertyId) : undefined,
    );
    res.json({ range: prediction.suggestedOfferRange });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Record negotiation outcome (for model training)
router.post("/:leadId/outcome", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
    const { outcome } = req.body;
    if (!outcome) return Errors.badRequest(res, "outcome is required");
    // The service takes a LEAD id now. It used to take a predictionId, and this
    // line passed a leadId to it under a comment that said so — the outcome of
    // lead #42 landed on prediction #42. finalPrice/notes are still not
    // accepted by the service (they were silently dropped at runtime).
    await sellerIntentPredictorService.recordOutcome(getOrganizationId(req), leadId, outcome);
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof SellerIntentNotInOrgError) return Errors.notFound(res, "Prediction");
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});



export default router;
