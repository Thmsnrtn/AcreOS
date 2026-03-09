/**
 * T145 — Commission Service Routes
 *
 * GET  /api/commissions/config              — get commission configuration
 * PUT  /api/commissions/config              — update commission configuration
 * GET  /api/commissions                     — list commission records
 * POST /api/commissions/deal                — record deal commission
 * POST /api/commissions/:id/payment         — record commission payment
 * GET  /api/commissions/agents              — agent commission summaries
 * GET  /api/commissions/statement/:agentId  — generate commission statement
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  getCommissionConfig,
  saveCommissionConfig,
  recordDealCommission,
  recordCommissionPayment,
  getCommissionRecords,
  getAgentCommissionSummaries,
  generateCommissionStatement,
} from "./services/commissionService";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

// Get commission configuration
router.get("/config", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const config = await getCommissionConfig(org.id);
    res.json({ config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update commission configuration
router.put("/config", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const config = await saveCommissionConfig(org.id, req.body);
    res.json({ config });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// List commission records
router.get("/", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const filters: any = {};
    if (req.query.agentId) filters.agentId = req.query.agentId as string;
    if (req.query.dealId) filters.dealId = parseInt(req.query.dealId as string);
    if (req.query.status) filters.status = req.query.status;
    const records = await getCommissionRecords(org.id, filters);
    res.json({ records });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record deal commission
router.post("/deal", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { dealId, agentId, dealAmount } = req.body;
    if (!dealId || !agentId || !dealAmount) {
      return res.status(400).json({ error: "dealId, agentId, and dealAmount are required" });
    }
    const record = await recordDealCommission(org.id, dealId, agentId, dealAmount);
    res.status(201).json({ record });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Record commission payment
router.post("/:id/payment", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const commissionId = parseInt(req.params.id);
    if (isNaN(commissionId)) return res.status(400).json({ error: "Invalid commission ID" });
    const { amount, method, notes } = req.body;
    if (!amount) return res.status(400).json({ error: "amount is required" });
    const record = await recordCommissionPayment(org.id, commissionId, amount, method, notes);
    res.json({ record });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Agent commission summaries
router.get("/agents", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const summaries = await getAgentCommissionSummaries(org.id);
    res.json({ summaries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate commission statement for an agent
router.get("/statement/:agentId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { agentId } = req.params;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const statement = await generateCommissionStatement(org.id, agentId, from, to);
    res.json({ statement });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
