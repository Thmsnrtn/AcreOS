/**
 * Delinquency ladder routes — V-Notes-2 Leg 1 (acquired book). Evidence and
 * record only.
 *
 *   GET  /api/notes/:id/delinquency-ladder                  the ladder: current stage (or why none),
 *                                                     every recorded stage entry, default review
 *   GET  /api/notes/:id/delinquency-ladder/bundle           the escalation evidence bundle, assembled on
 *                                                     request for a note at 30+ days
 *   POST /api/notes/:id/delinquency-ladder/default-review   the operator records default review (once)
 *
 * The path is `delinquency-ladder`, not `delinquency`: GET /api/notes/:noteId/
 * delinquency already exists in routes-va-engine.ts for the ORIGINATED book
 * (integer note ids). The two books never share a route.
 *
 * Same guard as the note record (owner or admin); another org's note is a 404.
 * Nothing here contacts a borrower, writes a reminder, a notice or an outbox
 * row, or calls the legacy book's dunning ladder. The POST writes exactly one
 * note_events row, attributed to the signed-in user.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { routeParam } from "./utils/routeParams";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultReviewBody = z.object({ note: z.string().trim().max(2_000).nullable().default(null) }).strict();

export function registerNoteDelinquencyRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"])] as const;

  app.get("/api/notes/:id/delinquency-ladder", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = String(routeParam(req.params.id));
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const { buildLadderView } = await import("./services/notes/delinquencyLadder");
      const view = await buildLadderView(getOrganizationId(req), id);
      if (!view) return Errors.notFound(res, "Note");
      return res.json(view);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/notes/:id/delinquency-ladder/bundle", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = String(routeParam(req.params.id));
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const { buildEscalationBundle } = await import("./services/notes/delinquencyLadder");
      const bundle = await buildEscalationBundle(getOrganizationId(req), id);
      if (!bundle) return Errors.notFound(res, "Note");
      return res.json(bundle);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/notes/:id/delinquency-ladder/default-review", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = String(routeParam(req.params.id));
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const parsed = defaultReviewBody.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      const { recordDefaultReview, DefaultReviewRefused } = await import("./services/notes/delinquencyLadder");
      try {
        const row = await recordDefaultReview({ organizationId: getOrganizationId(req), noteId: id, userId: getUserId(req), note: parsed.data.note });
        if (!row) return Errors.notFound(res, "Note");
        return res.json({ recorded: { id: row.id, recordedAt: row.recordedAt.toISOString(), recordedBy: row.recordedBy } });
      } catch (err) {
        if (err instanceof DefaultReviewRefused) return Errors.badRequest(res, err.message);
        throw err;
      }
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
