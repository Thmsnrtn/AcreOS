/**
 * Trust checks behind existing doors (W5a).
 *
 * DEALS door (deal detail):
 *   GET  /api/deals/:id/fraud-check              — signals, never accusations; never blocks
 *   POST /api/deals/:id/fraud-check/wire-change  — record "someone asked to wire to a new account"
 *
 * FINANCE door (notes):
 *   GET  /api/finance/collateral-watch             — what is watched on each note's collateral
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { fraudCheckForDeal, reportWireChange } from "./services/trust/fraudCheck";
import { collateralWatchForOrg } from "./services/trust/collateralWatchService";
import { routeParam } from "./utils/routeParams";

export function registerTrustCheckRoutes(app: Express): void {
  app.get("/api/deals/:id/fraud-check", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const dealId = Number(routeParam(req.params.id));
    if (!Number.isInteger(dealId)) return Errors.badRequest(res, "Invalid deal id");
    try {
      const result = await fraudCheckForDeal(getOrganizationId(req), dealId);
      if (!result) return Errors.notFound(res, "Deal");
      return res.json(result);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/deals/:id/fraud-check/wire-change", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const dealId = Number(routeParam(req.params.id));
    if (!Number.isInteger(dealId)) return Errors.badRequest(res, "Invalid deal id");
    const parsed = z.object({ note: z.string().trim().max(500).optional() }).strict().safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const ok = await reportWireChange(getOrganizationId(req), dealId, getUserId(req), parsed.data.note || null);
      if (!ok) return Errors.notFound(res, "Deal");
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/finance/collateral-watch", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      return res.json({ collateral: await collateralWatchForOrg(getOrganizationId(req)) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
