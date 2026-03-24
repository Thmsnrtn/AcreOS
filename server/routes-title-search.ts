/**
 * T196 — Title Search Routes
 *
 * POST /api/title-search/search        — run a preliminary title search
 * GET  /api/title-search/report/:id    — retrieve a saved report
 * GET  /api/title-search/history       — list recent searches for org
 */

import { Router, type Request, type Response } from "express";
import { titleSearchService } from "./services/titleSearchService";

const router = Router();


// POST /api/title-search/search
router.post("/search", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { address, parcelId, propertyId } = req.body;
    if (!address && !parcelId) {
      return res.status(400).json({ error: "address or parcelId required" });
    }

    const result = await titleSearchService.runSearch({ address, parcelId, propertyId, organizationId: org.id });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/title-search/report/:id
router.get("/report/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const report = await titleSearchService.getReport(req.params.id, org.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/title-search/history
router.get("/history", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 100);
    const history = await titleSearchService.listReports(org.id, limit);
    res.json({ reports: history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
