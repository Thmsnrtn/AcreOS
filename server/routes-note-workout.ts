/**
 * Workout analysis routes — V-Notes-2 Leg 2 (acquired book).
 *
 *   POST /api/notes/:id/workout-analyses          run a comparison and append it
 *   GET  /api/notes/:id/workout-analyses          every run on the note, oldest first
 *   GET  /api/notes/:id/workout-analyses/:runId   one run + its reproduction check
 *
 * Same guard as the note record (owner or admin). A note outside the caller's
 * organization is a 404, exactly like a note that does not exist.
 *
 * The POST writes ONE thing: an append-only analysis row on note_events. It
 * opens, edits and closes no loss-mit case, logs no action, sends nothing,
 * files nothing, posts nothing and moves no money (tests/unit/
 * workoutAnalysisRoutes.test.ts pins the write set). It is a comparison of the
 * operator's stated scenarios, never a recommendation.
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

const cents = z.number().int().nonnegative();
const months = z.number().int().min(1).max(600);
const bps = z.number().int().min(0).max(100_000);
const costLine = z.object({
  label: z.string().trim().min(1).max(120),
  amountCents: cents,
  timing: z.enum(["upfront", "monthly", "at_resolution"]),
});
const disposition = z.object({
  timelineMonths: months.nullable(),
  costs: z.array(costLine).max(30),
  citation: z.string().trim().max(500).nullable().default(null),
});

export const workoutRunBody = z.object({
  discountRateBps: bps,
  arrearsCents: cents.nullable().default(null),
  servicingMonthlyCents: cents.nullable().default(null),
  remainingTermMonths: months.nullable().default(null),
  collateralValueCents: cents.nullable().default(null),
  modification: z
    .object({
      rateBps: bps,
      termMonths: months,
      arrearsTreatment: z.enum(["capitalize", "defer_to_maturity", "waive"]),
      principalForbearanceCents: cents,
      principalReductionCents: cents,
    })
    .nullable()
    .default(null),
  forbearance: z.object({ months, reducedPaymentCents: cents }).nullable().default(null),
  deedInLieu: disposition.nullable().default(null),
  foreclosure: disposition.nullable().default(null),
  chargeOffHold: z.object({ recoveryCents: cents, horizonMonths: months, costs: z.array(costLine).max(30) }).nullable().default(null),
  supersedesRunId: z.string().regex(UUID).nullable().default(null),
}).strict();

export function registerNoteWorkoutRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"])] as const;

  app.post("/api/notes/:id/workout-analyses", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const id = String(routeParam(req.params.id));
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const parsed = workoutRunBody.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      const { createWorkoutRun, SupersedeTargetMissing } = await import("./services/notes/workoutAnalysis");
      try {
        const run = await createWorkoutRun({ organizationId, noteId: id, recordedBy: getUserId(req), operator: parsed.data });
        if (!run) return Errors.notFound(res, "Note");
        return res.json({ run });
      } catch (err) {
        if (err instanceof SupersedeTargetMissing) return Errors.badRequest(res, err.message);
        throw err;
      }
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/notes/:id/workout-analyses", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const id = String(routeParam(req.params.id));
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const { buildNoteRecord } = await import("./services/notes/noteRecord");
      if (!(await buildNoteRecord(organizationId, id))) return Errors.notFound(res, "Note");
      const { listWorkoutRuns } = await import("./services/notes/workoutAnalysis");
      return res.json({ runs: await listWorkoutRuns(organizationId, id) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/notes/:id/workout-analyses/:runId", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const id = String(routeParam(req.params.id));
      const runId = String(routeParam(req.params.runId));
      if (!UUID.test(id) || !UUID.test(runId)) return Errors.notFound(res, "Workout analysis");
      const { getWorkoutRun } = await import("./services/notes/workoutAnalysis");
      const run = await getWorkoutRun(organizationId, id, runId);
      if (!run) return Errors.notFound(res, "Workout analysis");
      return res.json({ run });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
