/**
 * T228 — KPI Dashboard Routes
 *
 * GET  /api/kpis              — get all KPI metrics for org
 * GET  /api/kpis/:id          — get single KPI detail with history
 * POST /api/kpis/targets      — set KPI targets
 * GET  /api/kpis/export       — export KPI report
 */

import { Router, type Request, type Response } from "express";

const router = Router();


// TODO(tsc): kpiStreaming service only exposes emit* methods; getMetrics,
// getMetricDetail, setTargets, and exportReport are not implemented. These
// endpoints crashed at runtime previously (calling undefined methods). They
// now return 501 until the KPI query/target/export service methods are built.
router.get("/", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "KPI metrics endpoint not implemented" });
});

  // export — registered BEFORE /:id so the literal path wins (2026-07-11 route-order sweep).
router.get("/export", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "KPI export endpoint not implemented" });
});

router.get("/:id", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "KPI detail endpoint not implemented" });
});

router.post("/targets", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "KPI targets endpoint not implemented" });
});


export default router;
