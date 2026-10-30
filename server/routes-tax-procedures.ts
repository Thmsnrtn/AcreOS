/**
 * Procedure-object routes — V-Tax-1 T2a.
 *
 *   GET   /api/tax-procedures/:state/:county               current version, history,
 *                                                         and standing (biddable or
 *                                                         locked, with reasons)
 *   POST  /api/tax-procedures/:state/:county               record a new version (fields
 *                                                         each with source, as-of,
 *                                                         basis, verification); it
 *                                                         starts unverified
 *   POST  /api/tax-procedures/:state/:county/verification  complete the county-
 *                                                         verification task
 *
 * Owner/admin. Everything is the session organization's own; another
 * organization's procedure is never read.
 */

import type { Express, Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";

function place(req: AuthenticatedRequest): { state: string; county: string } | null {
  const state = String(routeParam(req.params.state) ?? "").toUpperCase();
  const county = String(routeParam(req.params.county) ?? "").trim();
  if (!/^[A-Z]{2}$/.test(state) || county.length === 0 || county.length > 120) return null;
  return { state, county };
}

export function registerTaxProcedureRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"])];

  app.get("/api/tax-procedures/:state/:county", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const p = place(req);
      if (!p) return Errors.badRequest(res, "A two-letter state and a county are required.");
      const { procedureHistory } = await import("./services/tax/taxProcedures");
      const { procedureStanding } = await import("@shared/tax/procedure");
      const history = await procedureHistory(getOrganizationId(req), p.state, p.county);
      const current = history[0] ?? null;
      res.json({
        current,
        history: history.map((h) => ({ id: h.id, version: h.version, recordedAt: h.recordedAt, recordedBy: h.recordedBy, verified: h.countyVerification !== null })),
        standing: procedureStanding(current, clock.now().toISOString().slice(0, 10)),
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/tax-procedures/:state/:county", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const p = place(req);
      if (!p) return Errors.badRequest(res, "A two-letter state and a county are required.");
      const { procedureFieldsSchema, recordProcedureVersion } = await import("./services/tax/taxProcedures");
      const parsed = procedureFieldsSchema.safeParse(req.body?.fields);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      const today = clock.now().toISOString().slice(0, 10);
      const future = Object.entries(parsed.data).find(([, f]) => f && f.asOf > today);
      if (future) return Errors.badRequest(res, `The source date for ${future[0]} is in the future.`);
      const row = await recordProcedureVersion(getOrganizationId(req), getUserId(req), p.state, p.county, parsed.data);
      res.json({ procedure: row });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/tax-procedures/:state/:county/verification", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const p = place(req);
      if (!p) return Errors.badRequest(res, "A two-letter state and a county are required.");
      const { countyVerificationSchema, recordCountyVerification } = await import("./services/tax/taxProcedures");
      const parsed = countyVerificationSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      if (parsed.data.completedOn > clock.now().toISOString().slice(0, 10)) return Errors.badRequest(res, "A verification cannot be dated in the future.");
      const row = await recordCountyVerification(getOrganizationId(req), getUserId(req), p.state, p.county, parsed.data);
      if (!row) return Errors.notFound(res, "Procedure");
      res.json({ procedure: row });
    } catch (err) {
      Errors.internal(res, err);
    }
  });
}
