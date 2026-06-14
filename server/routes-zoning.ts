/**
 * T195 — Zoning & Permit Lookup Routes
 *
 * POST /api/zoning/lookup          — lookup zoning for an address or parcel
 * GET  /api/zoning/history/:parcelId — zoning change history for a parcel
 */

import { Router, type Request, type Response } from "express";
import { Errors, sendError } from "./utils/errors";
import { zoningService } from "./services/zoningService";

const router = Router();

// POST /api/zoning/lookup
router.post("/lookup", async (req: Request, res: Response) => {
  try {
    const { address, parcelId } = req.body;
    if (!address && !parcelId) {
      return Errors.badRequest(res, "address or parcelId required");
    }

    // zoningService exposes getZoning(address). Parcel-only lookups are not
    // supported by the underlying providers.
    if (!address) {
      return Errors.badRequest(res, "address is required for zoning lookup");
    }
    const result = await zoningService.getZoning(address);
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /api/zoning/history/:parcelId
// TODO(tsc): zoningService has no getZoningHistory method; zoning-change
// history is not yet available from the providers.
router.get("/history/:parcelId", async (_req: Request, res: Response) => {
  sendError(res, 501, "NOT_IMPLEMENTED", "Zoning history endpoint not implemented");
});

export default router;
