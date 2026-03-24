import { Router } from "express";
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
    res.status(400).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

export default router;
