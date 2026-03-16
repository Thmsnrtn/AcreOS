/**
 * T276 — A/B Test Engine Routes
 *
 * GET  /api/ab-tests             — list tests for org
 * POST /api/ab-tests             — create test
 * GET  /api/ab-tests/:id         — get test details
 * GET  /api/ab-tests/:id/results — get test results
 * POST /api/ab-tests/:id/pause   — pause test
 * POST /api/ab-tests/:id/complete — complete/end test
 */

import { Router, type Request, type Response } from "express";
import {
  createTest,
  getTest,
  listTests,
  getResults,
  getVariant,
  type AbTest,
} from "./services/abTestEngine";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

router.get("/", (req: Request, res: Response) => {
  const org = getOrg(req);
  const tests = listTests(org.id);
  res.json({ tests });
});

router.post("/", (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { id, name, variants, metric } = req.body;

    if (!id || !name || !variants || !metric) {
      return res.status(400).json({ error: "id, name, variants, and metric are required" });
    }
    if (!Array.isArray(variants) || variants.length < 2) {
      return res.status(400).json({ error: "Must have at least 2 variants" });
    }
    const totalWeight = variants.reduce((s: number, v: any) => s + (v.weight ?? 0), 0);
    if (Math.abs(totalWeight - 100) > 1) {
      return res.status(400).json({ error: "Variant weights must sum to 100" });
    }

    const test = createTest({ id, name, orgId: org.id, variants, metric });
    res.status(201).json(test);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", (req: Request, res: Response) => {
  const test = getTest(req.params.id);
  if (!test) return res.status(404).json({ error: "Test not found" });
  res.json(test);
});

router.get("/:id/results", (req: Request, res: Response) => {
  const test = getTest(req.params.id);
  if (!test) return res.status(404).json({ error: "Test not found" });
  const results = getResults(test);
  res.json(results);
});

router.get("/:id/variant/:leadId", (req: Request, res: Response) => {
  const test = getTest(req.params.id);
  if (!test) return res.status(404).json({ error: "Test not found" });
  const leadId = parseInt(req.params.leadId);
  if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });
  const variant = getVariant(test, leadId);
  res.json({ variant });
});

export default router;
