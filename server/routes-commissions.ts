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
import { Errors } from "./utils/errors";

const router = Router();


// Get commission configuration
router.get("/config", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await getCommissionConfig(org.id);
    res.json({ config });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Update commission configuration
router.put("/config", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await saveCommissionConfig(org.id, req.body);
    res.json({ config });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// List commission records
router.get("/", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const filters: any = {};
    if (req.query.agentId) filters.agentId = req.query.agentId as string;
    if (req.query.dealId) filters.dealId = parseInt(req.query.dealId as string);
    if (req.query.status) filters.status = req.query.status;
    const records = await getCommissionRecords(org.id, filters);
    res.json({ records });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Record deal commission
router.post("/deal", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { dealId, agentId, dealAmount } = req.body;
    if (!dealId || !agentId || !dealAmount) {
      return Errors.badRequest(res, "dealId, agentId, and dealAmount are required");
    }
    const record = await recordDealCommission(org.id, dealId, agentId, dealAmount);
    res.status(201).json({ record });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// Record commission payment
router.post("/:id/payment", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    // Commission records are keyed by string id in the service store.
    const commissionId = req.params.id;
    if (!commissionId) return Errors.badRequest(res, "Invalid commission ID");
    const { amount } = req.body;
    if (!amount) return Errors.badRequest(res, "amount is required");
    // TODO(tsc): recordCommissionPayment only persists paid cents; the route's
    // method/notes fields are not yet tracked by the service store.
    const record = await recordCommissionPayment(org.id, commissionId, Number(amount));
    res.json({ record });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// Agent commission summaries
router.get("/agents", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const summaries = await getAgentCommissionSummaries(org.id);
    res.json({ summaries });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Generate commission statement for an agent
router.get("/statement/:agentId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const agentId = parseInt(req.params.agentId, 10);
    if (Number.isNaN(agentId)) return Errors.badRequest(res, "Invalid agent ID");
    // TODO(tsc): the service computes statements per calendar year, not an
    // arbitrary from/to range; honoring `from` for the year selection only.
    const year = req.query.from
      ? new Date(req.query.from as string).getFullYear()
      : new Date().getFullYear();
    const summaries = await getAgentCommissionSummaries(org.id, year);
    const summary = summaries.find((s) => s.teamMemberId === agentId);
    if (!summary) return Errors.notFound(res, "Agent commission summary");
    const statement = generateCommissionStatement(summary, org.name, year);
    res.json({ statement });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
