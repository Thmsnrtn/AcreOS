/**
 * T214 — Dunning Management Routes
 *
 * GET  /api/dunning/summary       — summary stats
 * GET  /api/dunning/cases         — list active dunning cases
 * POST /api/dunning/:id/retry     — manual retry a payment
 * POST /api/dunning/:id/cancel    — cancel a dunning case
 * POST /api/dunning/:id/resolve   — mark manually resolved
 * GET  /api/dunning/history       — historical resolved/failed cases
 */

import { Router, type Request, type Response } from "express";
import { dunningService } from "./services/dunning";

const router = Router();

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const summary = await dunningService.getSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cases", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const cases = await dunningService.getActiveCases(status);
    res.json({ cases });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/retry", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const result = await dunningService.retryPayment(id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const result = await dunningService.cancelCase(id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/resolve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const { notes } = req.body;
    const result = await dunningService.resolveCase(id, notes);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
    const history = await dunningService.getHistory(limit);
    res.json({ cases: history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
