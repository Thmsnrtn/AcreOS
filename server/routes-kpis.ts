// @ts-nocheck
/**
 * T228 — KPI Dashboard Routes
 *
 * GET  /api/kpis              — get all KPI metrics for org
 * GET  /api/kpis/:id          — get single KPI detail with history
 * POST /api/kpis/targets      — set KPI targets
 * GET  /api/kpis/export       — export KPI report
 */

import { Router, type Request, type Response } from "express";
import { kpiStreamingService } from "./services/kpiStreamingService";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

router.get("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const period = (req.query.period as string) ?? "mtd";
    const metrics = await kpiStreamingService.getMetrics(org.id, period);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { id } = req.params;
    const periods = Math.min(parseInt(String(req.query.periods ?? "12")), 36);
    const detail = await kpiStreamingService.getMetricDetail(org.id, id, periods);
    if (!detail) return res.status(404).json({ error: "KPI not found" });
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/targets", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { targets } = req.body;
    if (!Array.isArray(targets)) return res.status(400).json({ error: "targets must be an array" });

    const result = await kpiStreamingService.setTargets(org.id, targets);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/export", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const period = (req.query.period as string) ?? "mtd";
    const report = await kpiStreamingService.exportReport(org.id, period);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
