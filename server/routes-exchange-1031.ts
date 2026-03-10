// @ts-nocheck
/**
 * T213 — 1031 Exchange Tracker Routes
 *
 * GET    /api/exchange-1031              — list exchanges for org
 * POST   /api/exchange-1031              — create new exchange record
 * GET    /api/exchange-1031/:id          — get exchange details
 * PUT    /api/exchange-1031/:id          — update exchange
 * POST   /api/exchange-1031/:id/identify — add replacement property
 * POST   /api/exchange-1031/:id/complete — mark exchange as complete
 */

import { Router, type Request, type Response } from "express";
import { exchange1031Service } from "./services/exchange1031";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }
function getUser(req: Request) { return (req as any).user; }

router.get("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const exchanges = await exchange1031Service.listExchanges(org.id);
    res.json({ exchanges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const user = getUser(req);
    const { relinquishedPropertyAddress, relinquishedSalePriceCents, dealId, qualifiedIntermediaryName } = req.body;

    if (!relinquishedPropertyAddress || !relinquishedSalePriceCents) {
      return res.status(400).json({ error: "relinquishedPropertyAddress and relinquishedSalePriceCents required" });
    }

    const exchange = await exchange1031Service.createExchange({
      organizationId: org.id,
      userId: user.id,
      relinquishedPropertyAddress,
      relinquishedSalePriceCents,
      dealId,
      qualifiedIntermediaryName,
    });
    res.status(201).json({ exchange });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const exchange = await exchange1031Service.getExchange(id, org.id);
    if (!exchange) return res.status(404).json({ error: "Exchange not found" });
    res.json({ exchange });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/identify", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const { address, estimatedPriceCents } = req.body;
    if (!address || !estimatedPriceCents) {
      return res.status(400).json({ error: "address and estimatedPriceCents required" });
    }

    const updated = await exchange1031Service.addReplacementProperty(id, org.id, { address, estimatedPriceCents });
    res.json({ exchange: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/complete", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const updated = await exchange1031Service.completeExchange(id, org.id);
    res.json({ exchange: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
