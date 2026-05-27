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
import { Errors } from "./utils/errors";

const router = Router();

function getUser(req: Request) { return req.user; }

router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const exchanges = await exchange1031Service.listExchanges(org.id);
    res.json({ exchanges });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const user = getUser(req);
    const { relinquishedPropertyAddress, relinquishedSalePriceCents, dealId, qualifiedIntermediaryName } = req.body;

    if (!relinquishedPropertyAddress || !relinquishedSalePriceCents) {
      return Errors.badRequest(res, "relinquishedPropertyAddress and relinquishedSalePriceCents required");
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
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const exchange = await exchange1031Service.getExchange(id, org.id);
    if (!exchange) return Errors.notFound(res, "Exchange");
    res.json({ exchange });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/:id/identify", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const { address, estimatedPriceCents } = req.body;
    if (!address || !estimatedPriceCents) {
      return Errors.badRequest(res, "address and estimatedPriceCents required");
    }

    const updated = await exchange1031Service.addReplacementProperty(id, org.id, { address, estimatedPriceCents });
    res.json({ exchange: updated });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.post("/:id/complete", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const updated = await exchange1031Service.completeExchange(id, org.id);
    res.json({ exchange: updated });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

export default router;
