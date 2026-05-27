/**
 * T147 — Buyer Qualification Bot Routes
 *
 * POST /api/buyer-qualification/start            — start qualification for a buyer
 * GET  /api/buyer-qualification/:id              — get qualification by ID
 * GET  /api/buyer-qualification/org/qualified    — all qualified buyers
 * GET  /api/buyer-qualification/org/high-risk    — high-risk buyers
 * POST /api/buyer-qualification/:id/financial    — run financial check
 * POST /api/buyer-qualification/:id/background   — run background checks
 * POST /api/buyer-qualification/:id/financing    — assess financing readiness
 * POST /api/buyer-qualification/:id/assess       — generate full assessment
 * GET  /api/buyer-qualification/:id/report       — qualification report
 * GET  /api/buyer-qualification/:id/probability  — closing probability estimate
 * PATCH /api/buyer-qualification/:id/status      — update qualification status
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { buyerQualificationBotService } from "./services/buyerQualificationBot";
import { Errors } from "./utils/errors";

const router = Router();


// Start qualification process for a buyer
router.post("/start", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { buyerName, email, phone, dealId } = req.body;
    if (!buyerName || !email) {
      return Errors.badRequest(res, "buyerName and email are required");
    }
    const qualification = await buyerQualificationBotService.startQualification(
      org.id,
      { buyerName, email, phone, dealId }
    );
    res.status(201).json({ qualification });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Get qualification by ID
router.get("/:id", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const qualification = await buyerQualificationBotService.getQualificationById(id);
    if (!qualification) return Errors.notFound(res, "Qualification");
    res.json({ qualification });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// All qualified buyers for org
router.get("/org/qualified", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const buyers = await buyerQualificationBotService.getQualifiedBuyers(org.id);
    res.json({ buyers });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// High-risk buyers
router.get("/org/high-risk", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const buyers = await buyerQualificationBotService.getHighRiskBuyers(org.id);
    res.json({ buyers });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Run financial check
router.post("/:id/financial", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const result = await buyerQualificationBotService.runFinancialCheck(id);
    res.json({ result });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Run background checks
router.post("/:id/background", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const result = await buyerQualificationBotService.runBackgroundChecks(id);
    res.json({ result });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Assess financing readiness
router.post("/:id/financing", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const result = await buyerQualificationBotService.assessFinancingReadiness(id);
    res.json({ result });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Generate full assessment
router.post("/:id/assess", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const assessment = await buyerQualificationBotService.generateAssessment(id);
    res.json({ assessment });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Get qualification report
router.get("/:id/report", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const report = await buyerQualificationBotService.generateQualificationReport(id);
    res.json({ report });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Estimate closing probability
router.get("/:id/probability", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const probability = await buyerQualificationBotService.estimateClosingProbability(id);
    res.json({ probability });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Update qualification status
router.patch("/:id/status", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid qualification ID");
    const { status, notes } = req.body;
    if (!status) return Errors.badRequest(res, "status is required");
    const qualification = await buyerQualificationBotService.updateQualificationStatus(id, status, notes);
    if (!qualification) return Errors.notFound(res, "Qualification");
    res.json({ qualification });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

export default router;
