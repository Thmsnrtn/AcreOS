/**
 * Wholesale disposition — the packet a wholesaler sends buyers, and the
 * outcome of the deal (wholesale package, Leg 4).
 *
 * GET  /api/wholesale/properties/:propertyId/disposition-packet
 *   The packet, assembled NOW from the deal and the frozen decision, with the
 *   buyer price re-derived at this moment. Writes nothing, sends nothing: the
 *   operator hands it to the existing buyer-blast lane.
 *
 * POST /api/wholesale/decisions/:decisionId/outcome
 *   { exit: "assignment" | "double_close" | "walked", assignmentId?,
 *     doubleCloseId?, closedOn: "YYYY-MM-DD" }
 *   Records realised fee, days to close and the exit against the frozen
 *   decision through the existing outcome loop. The fee is read from the
 *   deal's own record; no money moves.
 *
 * GET  /api/wholesale/deals/:dealId/seller-follow-ups/preview?templateId=
 * POST /api/wholesale/deals/:dealId/seller-follow-ups  { offerTemplateId, supersedes? }
 * GET  /api/wholesale/deals/:dealId/seller-follow-ups
 *   Seller-side follow-up DRAFTS (§6.2): the operator's own follow-up template
 *   merged with the deal's record facts. Preview writes nothing; create writes
 *   one draft record; list re-checks each draft's cited facts. None of them
 *   sends anything.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { clock } from "./utils/clock";
import { isCalendarDate } from "@shared/dates/calendar";
import { routeParam } from "./utils/routeParams";
import { buildDispositionPacket, DispositionRefusal, recordWholesaleOutcome } from "./services/wholesale/disposition";
import { createSellerFollowUp, listSellerFollowUps, previewSellerFollowUp } from "./services/wholesale/sellerFollowUps";

const router = Router();

function refuse(res: Response, err: DispositionRefusal) {
  if (err.status === 404) return Errors.notFound(res, err.message);
  if (err.status === 422) return Errors.unprocessable(res, err.message);
  return sendError(res, 409, "CONFLICT", err.message);
}

router.get("/properties/:propertyId/disposition-packet", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const propertyId = Number(routeParam(req.params.propertyId));
    if (!Number.isInteger(propertyId) || propertyId <= 0) return Errors.badRequest(res, "Invalid property id");
    res.json(await buildDispositionPacket(organizationId, propertyId, clock.now()));
  } catch (err) {
    if (err instanceof DispositionRefusal) return refuse(res, err);
    Errors.internal(res, err);
  }
});

const outcomeSchema = z
  .object({
    exit: z.enum(["assignment", "double_close", "walked"]),
    assignmentId: z.number().int().positive().optional(),
    doubleCloseId: z.string().min(1).max(64).optional(),
    closedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "closedOn must be YYYY-MM-DD")
      .refine((d) => isCalendarDate(d), "That date does not exist"),
  })
  .strict();

router.post("/decisions/:decisionId/outcome", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const decisionId = Number(routeParam(req.params.decisionId));
    if (!Number.isInteger(decisionId) || decisionId <= 0) return Errors.badRequest(res, "Invalid decision id");
    const parsed = outcomeSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    res.json(await recordWholesaleOutcome(organizationId, decisionId, parsed.data, clock.now()));
  } catch (err) {
    if (err instanceof DispositionRefusal) return refuse(res, err);
    Errors.internal(res, err);
  }
});

// ── Seller follow-up drafts (§6.2): prepared, never sent ─────────────────────

function dealIdOf(req: AuthenticatedRequest): number | null {
  const id = Number(routeParam(req.params.dealId));
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/deals/:dealId/seller-follow-ups/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const dealId = dealIdOf(req);
    if (dealId === null) return Errors.badRequest(res, "Invalid deal id");
    const templateId = Number(typeof req.query.templateId === "string" ? req.query.templateId : NaN);
    if (!Number.isInteger(templateId) || templateId <= 0) return Errors.badRequest(res, "Choose a follow-up template (templateId)");
    res.json(await previewSellerFollowUp(organizationId, dealId, templateId, clock.now()));
  } catch (err) {
    if (err instanceof DispositionRefusal) return refuse(res, err);
    Errors.internal(res, err);
  }
});

const sellerFollowUpSchema = z
  .object({
    offerTemplateId: z.number().int().positive(),
    supersedes: z.number().int().positive().optional(),
  })
  .strict();

router.post("/deals/:dealId/seller-follow-ups", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const dealId = dealIdOf(req);
    if (dealId === null) return Errors.badRequest(res, "Invalid deal id");
    const parsed = sellerFollowUpSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    res.json(await createSellerFollowUp(organizationId, userId, dealId, parsed.data, clock.now()));
  } catch (err) {
    if (err instanceof DispositionRefusal) return refuse(res, err);
    Errors.internal(res, err);
  }
});

router.get("/deals/:dealId/seller-follow-ups", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const dealId = dealIdOf(req);
    if (dealId === null) return Errors.badRequest(res, "Invalid deal id");
    res.json(await listSellerFollowUps(organizationId, dealId));
  } catch (err) {
    if (err instanceof DispositionRefusal) return refuse(res, err);
    Errors.internal(res, err);
  }
});

export default router;
