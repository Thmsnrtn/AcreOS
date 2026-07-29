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
import { Errors } from "./utils/errors";

const router = Router();


router.get("/", async (req: Request, res: Response) => {
  const org = req.organization;
  const tests = await listTests(org.id);
  res.json({ tests });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { id, name, variants, metric } = req.body;

    if (!id || !name || !variants || !metric) {
      return Errors.badRequest(res, "id, name, variants, and metric are required");
    }
    if (!Array.isArray(variants) || variants.length < 2) {
      return Errors.badRequest(res, "Must have at least 2 variants");
    }
    const totalWeight = variants.reduce((s: number, v: any) => s + (v.weight ?? 0), 0);
    if (Math.abs(totalWeight - 100) > 1) {
      return Errors.badRequest(res, "Variant weights must sum to 100");
    }

    const test = await createTest({ id, name, orgId: org.id, variants, metric });
    res.status(201).json(test);
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const test = await getTest(req.params.id, req.organization.id);
  if (!test) return Errors.notFound(res, "Test");
  res.json(test);
});

router.get("/:id/results", async (req: Request, res: Response) => {
  const test = await getTest(req.params.id, req.organization.id);
  if (!test) return Errors.notFound(res, "Test");
  const results = await getResults(test);
  res.json(results);
});

router.get("/:id/variant/:leadId", async (req: Request, res: Response) => {
  const test = await getTest(req.params.id, req.organization.id);
  if (!test) return Errors.notFound(res, "Test");
  const leadId = parseInt(req.params.leadId);
  if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");
  const variant = getVariant(test, leadId);
  res.json({ variant });
});

export default router;
