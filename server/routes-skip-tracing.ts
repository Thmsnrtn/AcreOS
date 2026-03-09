/**
 * T193 — Skip Tracing Routes
 *
 * POST /api/skip-tracing/trace/:leadId — trace a single lead
 * POST /api/skip-tracing/batch         — queue batch trace for all untraced leads
 * GET  /api/skip-tracing/stats         — aggregate trace stats
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { leads } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { skipTracingService } from "./services/skipTracingService";

const router = Router();

function getOrg(req: Request) {
  return (req as any).org;
}

// POST /api/skip-tracing/trace/:leadId — trace a single lead
router.post("/trace/:leadId", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

    const result = await skipTracingService.traceLead(leadId, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skip-tracing/batch — queue batch trace
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { limit = 50 } = req.body;

    const queued = await skipTracingService.queueBatchTrace(org.id, Math.min(limit, 100));
    res.json({ queued, message: `Queued ${queued} leads for skip tracing` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/skip-tracing/stats — aggregate stats
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const stats = await skipTracingService.getStats(org.id);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
