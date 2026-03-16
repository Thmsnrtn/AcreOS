// @ts-nocheck
/**
 * T195 — Zoning & Permit Lookup Routes
 *
 * POST /api/zoning/lookup          — lookup zoning for an address or parcel
 * GET  /api/zoning/history/:parcelId — zoning change history for a parcel
 */

import { Router, type Request, type Response } from "express";
import { zoningService } from "./services/zoningService";

const router = Router();

// POST /api/zoning/lookup
router.post("/lookup", async (req: Request, res: Response) => {
  try {
    const { address, parcelId } = req.body;
    if (!address && !parcelId) {
      return res.status(400).json({ error: "address or parcelId required" });
    }

    const result = await zoningService.lookupZoning({ address, parcelId });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zoning/history/:parcelId
router.get("/history/:parcelId", async (req: Request, res: Response) => {
  try {
    const { parcelId } = req.params;
    const history = await zoningService.getZoningHistory(parcelId);
    res.json({ parcelId, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
