/**
 * T102 — Regulatory Intelligence Routes
 *
 * GET  /api/regulatory/states              — all state profiles (summary)
 * GET  /api/regulatory/states/:code        — full profile for one state
 * GET  /api/regulatory/alerts              — active alerts (optional ?state=TX)
 * GET  /api/regulatory/checklist/:state    — due diligence checklist
 * POST /api/regulatory/assess              — risk assessment for a deal
 */

import { Router } from "express";
import { isAuthenticated } from "./auth";
import { regulatoryIntelligenceService } from "./services/regulatoryIntelligence";

const router = Router();

// All state summary profiles
router.get("/states", isAuthenticated, (_req, res) => {
  res.json(regulatoryIntelligenceService.getAllStates());
});

// Full profile for a specific state
router.get("/states/:code", isAuthenticated, (req, res) => {
  const profile = regulatoryIntelligenceService.getStateProfile(req.params.code);
  if (!profile) return res.status(404).json({ message: "State not found in regulatory database" });
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
  if (!checklist) return res.status(404).json({ message: "State not found in regulatory database" });
  res.json(checklist);
});

// Risk assessment for a deal
router.post("/assess", isAuthenticated, (req, res) => {
  const { state, sellerFinanced, acreage, nearWater, coastal } = req.body;
  if (!state) return res.status(400).json({ message: "state is required" });
  const result = regulatoryIntelligenceService.assessDealRisk(state, {
    sellerFinanced,
    acreage,
    nearWater,
    coastal,
  });
  res.json(result);
});

export default router;
