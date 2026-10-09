/**
 * T102 — Regulatory Intelligence Routes
 *
 * GET  /api/regulatory/states              — all state profiles (summary)
 * GET  /api/regulatory/states/:code        — full profile for one state
 * GET  /api/regulatory/alerts              — active alerts (optional ?state=TX)
 * GET  /api/regulatory/checklist/:state    — due diligence checklist
 * POST /api/regulatory/assess              — risk assessment for a deal
 * POST /api/regulatory/contract-for-deed   — cited contract-for-deed rules for a deal
 */

import { Router } from "express";
import { isAuthenticated } from "./auth";
import { regulatoryIntelligenceService } from "./services/regulatoryIntelligence";
import { sendError, Errors } from "./utils/errors";
import { z } from "zod";
import { checkContractForDeed } from "@shared/regulatory/sellerFinancingRules";

const router = Router();

// All state summary profiles
router.get("/states", isAuthenticated, (_req, res) => {
  res.json(regulatoryIntelligenceService.getAllStates());
});

// Full profile for a specific state
router.get("/states/:code", isAuthenticated, (req, res) => {
  const profile = regulatoryIntelligenceService.getStateProfile(req.params.code);
  if (!profile) return sendError(res, 404, "NOT_FOUND", "State not found in regulatory database");
  res.json(profile);
});

// Active regulatory alerts
router.get("/alerts", isAuthenticated, (req, res) => {
  const state = req.query.state as string | undefined;
  res.json(regulatoryIntelligenceService.getAlerts(state));
});

// Due diligence checklist by state
router.get("/checklist/:state", isAuthenticated, (req, res) => {
  const checklist = regulatoryIntelligenceService.getDueDiligenceChecklist(req.params.state);
  if (!checklist) return sendError(res, 404, "NOT_FOUND", "State not found in regulatory database");
  res.json(checklist);
});

// Risk assessment for a deal
router.post("/assess", isAuthenticated, (req, res) => {
  const { state, sellerFinanced, acreage, nearWater, coastal } = req.body;
  if (!state) return sendError(res, 400, "BAD_REQUEST", "state is required");
  const result = regulatoryIntelligenceService.assessDealRisk(state, {
    sellerFinanced,
    acreage,
    nearWater,
    coastal,
  });
  res.json(result);
});

// Contract-for-deed rules: cited statutes only; an uncovered state says so.
const contractForDeedSchema = z.object({
  state: z.string().trim().length(2),
  purchaserResidence: z.boolean().optional(),
  lotAcres: z.number().nonnegative().optional(),
  deedDeliveryWithinDays: z.number().int().nonnegative().optional(),
  sellerOwnsFreeAndClear: z.boolean().optional(),
  percentPaid: z.number().min(0).max(100).optional(),
  monthlyPaymentsMade: z.number().int().nonnegative().optional(),
  yearsSinceFirstPayment: z.number().nonnegative().optional(),
  recorded: z.boolean().optional(),
  investorSeller: z.boolean().optional(),
});
router.post("/contract-for-deed", isAuthenticated, (req, res) => {
  const parsed = contractForDeedSchema.safeParse(req.body ?? {});
  if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
  res.json(checkContractForDeed(parsed.data));
});

export default router;
