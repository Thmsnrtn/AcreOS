/**
 * T214 — Dunning Management Routes
 *
 * All routes require authentication + founder authorization (P1-5 fix).
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
import { requireFounder } from "./auth";
import { Errors } from "./utils/errors";

const router = Router();

// All dunning routes are founder-only — apply requireFounder to the entire router.
// isAuthenticated is already applied at the mount point in routes.ts.
router.use(requireFounder);

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const summary = await dunningService.getSummary();
    res.json(summary);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/cases", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const cases = await dunningService.getActiveCases(status);
    res.json({ cases });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/:id/retry", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");
    const result = await dunningService.retryPayment(id);
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");
    const result = await dunningService.cancelCase(id);
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

router.post("/:id/resolve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");
    const { notes } = req.body;
    const result = await dunningService.resolveCase(id, notes);
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
    const history = await dunningService.getHistory(limit);
    res.json({ cases: history });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
