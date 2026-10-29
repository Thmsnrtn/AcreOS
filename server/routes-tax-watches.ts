/**
 * County watch routes — V-Tax-1 T1.
 *
 *   GET   /api/tax-watches                 the org's county watches, with lot counts
 *   PUT   /api/tax-watches/:id/terms       state the watch's redemption period,
 *                                          sale type and auction cadence — each
 *                                          with its source (and as-of); a term
 *                                          left out is unknown
 *   GET   /api/tax-watches/:id/triage      the watch's lots against the ignorance
 *                                          map (services/tax/taxWatches.ts)
 *
 * Owner/admin, like the certificate routes. A watch outside the caller's
 * organization is a 404, exactly like one that does not exist.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { isCalendarDate } from "@shared/dates/calendar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stated = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value,
      source: z.string().trim().min(3, "say where this came from (e.g. the county's sale notice)").max(500),
      asOf: z.string().refine(isCalendarDate, "not a calendar date (YYYY-MM-DD)").nullable(),
    })
    .strict();

const termsSchema = z
  .object({
    redemptionPeriodMonths: stated(z.number().int().min(0).max(600)).optional(),
    saleType: stated(z.enum(["lien", "deed", "redeemable_deed"])).optional(),
    auctionCadence: stated(z.string().trim().min(1).max(200)).optional(),
  })
  .strict();

export function registerTaxWatchRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"])];

  app.get("/api/tax-watches", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { listWatches } = await import("./services/tax/taxWatches");
      res.json({ watches: await listWatches(getOrganizationId(req)) });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.put("/api/tax-watches/:id/terms", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!UUID.test(id)) return Errors.notFound(res, "Watch");
      const parsed = termsSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      const { setWatchTerms } = await import("./services/tax/taxWatches");
      const watch = await setWatchTerms(getOrganizationId(req), id, parsed.data);
      if (!watch) return Errors.notFound(res, "Watch");
      res.json({ watch });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.get("/api/tax-watches/:id/triage", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!UUID.test(id)) return Errors.notFound(res, "Watch");
      const { buildWatchTriage } = await import("./services/tax/taxWatches");
      const triage = await buildWatchTriage(getOrganizationId(req), id);
      if (!triage) return Errors.notFound(res, "Watch");
      res.json(triage);
    } catch (err) {
      Errors.internal(res, err);
    }
  });
}
