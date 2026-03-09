/**
 * T226 — Tax Delinquent Pipeline Routes
 *
 * GET  /api/tax-delinquent           — list delinquent leads
 * POST /api/tax-delinquent/import    — import records from county data
 * GET  /api/tax-delinquent/:id       — get lead detail
 * POST /api/tax-delinquent/:id/contact — add to outreach sequence
 */

import { Router, type Request, type Response } from "express";
import { taxDelinquentPipeline } from "./services/taxDelinquentPipeline";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

router.get("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { state, risk, limit = "50", page = "1" } = req.query;

    const leads = await taxDelinquentPipeline.getLeads({
      organizationId: org.id,
      stateCode: state as string | undefined,
      risk: risk as string | undefined,
      limit: Math.min(parseInt(String(limit)), 200),
      page: parseInt(String(page)),
    });
    res.json(leads);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { stateCode, county, limit = 500 } = req.body;

    const result = await taxDelinquentPipeline.importFromCounty({
      organizationId: org.id,
      stateCode,
      county,
      limit: Math.min(limit, 1000),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const lead = await taxDelinquentPipeline.getLead(id, org.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/contact", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const result = await taxDelinquentPipeline.addToOutreach(id, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
