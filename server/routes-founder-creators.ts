/**
 * Founder routes for the creator revenue share (W3) — behind the Controls
 * door (client: CreatorProgramSection on /founder/autopilot/control).
 *
 *   GET  /api/founder/creators                 ledger: creators, attributed signups,
 *                                              paid conversions, owed (null while the
 *                                              rate is unset) + the pending decisions
 *   POST /api/founder/creators                 add a creator and their ?ref= code
 *   POST /api/founder/creators/:id/approve     approve everything owed into one batch
 *                                              (refused while the rate is unset)
 *   POST /api/founder/creators/payouts/:batch/paid  record the founder's payment reference
 *
 * Founder-only (requireFounder). AcreOS moves no money here: the founder pays
 * creators from AcreOS's own account outside the app and records it.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { approveCreatorPayout, createCreator, creatorLedger, markCreatorPayoutPaid } from "./services/creatorProgram";
import { pendingAcquisitionDecisions } from "./services/acquisitionDecisions";

const createSchema = z.object({
  code: z.string().trim().min(4).max(16),
  displayName: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(200).optional(),
});

const CREATE_REFUSALS: Record<string, string> = {
  invalid_code: "A code is 4–16 letters, digits, dashes or underscores.",
  code_taken: "That code already belongs to a creator.",
  code_is_customer_referral: "That code is a customer's referral code; pick another.",
  missing_name: "Give the creator a name.",
};

export function registerFounderCreatorRoutes(app: Express): void {
  app.get("/api/founder/creators", isAuthenticated, requireFounder, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const ledger = await creatorLedger();
      return res.json({ ...ledger, decisions: pendingAcquisitionDecisions() });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/creators", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const r = await createCreator({ ...parsed.data, createdBy: getUserId(req) });
      if (!r.ok) return Errors.badRequest(res, CREATE_REFUSALS[r.reason], { reason: r.reason });
      return res.json({ creator: r.creator });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/creators/:id/approve", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Unknown creator.");
    try {
      const r = await approveCreatorPayout(id, getUserId(req));
      if (!r.ok) return Errors.badRequest(res, r.message, { reason: r.reason });
      return res.json(r);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/creators/payouts/:batch/paid", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({ reference: z.string().trim().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const r = await markCreatorPayoutPaid(String(req.params.batch), parsed.data.reference, getUserId(req));
      if (!r.ok) return Errors.badRequest(res, "No approved payout with that batch id.");
      return res.json(r);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
