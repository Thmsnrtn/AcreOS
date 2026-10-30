/**
 * Owner requests — the founder half (W5a), Decisions door → "Owner requests".
 *
 *   GET  /api/founder/trust/owner-optouts
 *   POST /api/founder/trust/owner-optouts/:id/mail-code-sent
 *   POST /api/founder/trust/owner-optouts/:id/orgs/:orgId/deletion   — the hard stop
 *
 * Erasing an org's records is customer-data deletion, a founder-only hard
 * stop: requireFounder here, and no other caller of decideOwnerDeletion.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { decideOwnerDeletion, listOwnerOptOutsForFounder, markMailCodeSent } from "./services/trust/ownerOptOut";
import { routeParam } from "./utils/routeParams";

export function registerFounderOwnerOptOutRoutes(app: Express): void {
  app.get("/api/founder/trust/owner-optouts", isAuthenticated, requireFounder, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      return res.json({ requests: await listOwnerOptOutsForFounder() });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post(
    "/api/founder/trust/owner-optouts/:id/mail-code-sent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(routeParam(req.params.id));
      if (!Number.isInteger(id)) return Errors.badRequest(res, "Invalid request id");
      try {
        if (!(await markMailCodeSent(id))) return Errors.notFound(res, "Mail-code request");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/trust/owner-optouts/:id/orgs/:orgId/deletion",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(routeParam(req.params.id));
      const orgId = Number(routeParam(req.params.orgId));
      if (!Number.isInteger(id) || !Number.isInteger(orgId)) return Errors.badRequest(res, "Invalid id");
      const parsed = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).strict().safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      try {
        const result = await decideOwnerDeletion(id, orgId, parsed.data.approve, parsed.data.note ?? null);
        if (!result.ok) return Errors.badRequest(res, result.reason);
        return res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
