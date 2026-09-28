import { Router } from "express";
import { Errors, sendError } from "./utils/errors";
import { DealUnderwritingService } from "./services/dealUnderwriting";

const router = Router();
const svc = new DealUnderwritingService();

// POST /api/deal-underwriting/analyze
router.post("/analyze", async (req, res) => {
  try {
    const org = req.organization;
    const results = await svc.analyzeScenarios(org.id, req.body);
    res.json({ results });
  } catch (e: any) {
    sendError(res, 400, "BAD_REQUEST", e.message);
  }
});

// GET /api/deal-underwriting/history
router.get("/history", async (req, res) => {
  try {
    const org = req.organization;
    const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
    const history = await svc.getUnderwritingHistory(org.id, dealId);
    res.json({ history });
  } catch (e: any) {
    Errors.internal(res, e);
  }
});

export default router;
