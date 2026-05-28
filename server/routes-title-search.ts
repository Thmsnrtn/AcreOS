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
    const { apn, parcelId, state } = req.body;
    // The service searches by APN (+ optional state). Accept apn or parcelId.
    const apnValue = apn || parcelId;
    if (!apnValue) {
      return res.status(400).json({ error: "apn or parcelId required" });
    }

    const result = await titleSearchService.search(String(apnValue), state ? String(state) : undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/title-search/report/:id
// TODO(tsc): titleSearchService does not persist reports (no getReport()).
// Results are returned synchronously from /search; saved-report retrieval
// needs a persistence layer before this can return real data.
router.get("/report/:id", async (_req: Request, res: Response) => {
  res.status(404).json({ error: "Report not found" });
});

// GET /api/title-search/history
// TODO(tsc): titleSearchService does not persist reports (no listReports()).
router.get("/history", async (_req: Request, res: Response) => {
  res.json({ reports: [] });
});

export default router;
