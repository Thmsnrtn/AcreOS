/**
 * T271 — Recording Fees Routes
 *
 * GET /api/recording-fees         — lookup recording fees for state/county
 * GET /api/recording-fees/closing — estimate full closing costs
 */

import { Router, type Request, type Response } from "express";
import { getRecordingFees, estimateClosingCosts } from "./services/countyRecordingFees";
import { sendError } from "./utils/errors";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const state = (req.query.state as string) ?? "";
  const county = (req.query.county as string) ?? "";

  if (!state) return sendError(res, 400, "BAD_REQUEST", "state is required");
  if (!county) return sendError(res, 400, "BAD_REQUEST", "county is required");

  const fees = getRecordingFees(state, county);
  res.json(fees);
});

router.get("/closing", (req: Request, res: Response) => {
  const state = (req.query.state as string) ?? "";
  const county = (req.query.county as string) ?? "";
  const priceStr = req.query.price as string;

  if (!state || !county) {
    return sendError(res, 400, "BAD_REQUEST", "state and county are required");
  }
  const purchasePrice = parseFloat(priceStr);
  if (!priceStr || isNaN(purchasePrice) || purchasePrice <= 0) {
    return sendError(res, 400, "BAD_REQUEST", "price must be a positive number");
  }

  const costs = estimateClosingCosts(purchasePrice, state, county);
  res.json({ state: state.toUpperCase(), county, purchasePrice, ...costs });
});

export default router;
