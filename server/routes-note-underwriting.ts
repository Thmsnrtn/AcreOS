/**
 * Note underwriting — the note investor's decision route (Step 0 item N4).
 *
 * POST /api/note-investor/underwrite
 *   Recomputes the price with the `note_price_yield` engine (the most the
 *   operator can pay for their target yield, from the note's scheduled cash
 *   flows), freezes it as a scenario, and records the operator's call
 *   (acquire / offer / pass) as a decision under the note_investor strategy
 *   pack, citing that scenario. The decision carries the operator's own
 *   review date, so the outcome loop can later grade the call against what
 *   the note actually paid.
 *
 * The subject is the collateral property, as on every desk the shared kit
 * serves: the kit's body schema and tenancy check are property-shaped, and
 * the property is the asset both sides of the note trade point at.
 *
 * The kit enforces the guarantees (verticalDecision.ts). The pack and engine
 * are string literals here because evidence rule v2 reads them, and neither
 * is steerable from the request body.
 *
 * Records a decision; sends nothing, contacts nobody, moves no money. The
 * price it underwrites is a number in a record, never a payment.
 */
import { Router, type Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { ScenarioEngineError } from "@shared/economics/scenario";
import {
  describeProperty,
  loadOrgProperty,
  recordUnderwrittenDecision,
  underwriteBodySchema,
} from "./services/underwriting/verticalDecision";

const router = Router();
const bodySchema = underwriteBodySchema(["acquire", "offer", "pass"] as const);

router.post("/underwrite", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    const body = parsed.data;

    const property = await loadOrgProperty(organizationId, body.propertyId);
    if (!property) return Errors.notFound(res, "Property");

    const out = await recordUnderwrittenDecision(organizationId, {
      subjectType: "property",
      subjectId: property.id,
      engineId: "note_price_yield",
      strategyPackId: "note_investor",
      inputs: body.inputs,
      scenarioLabel: `Note price-to-yield — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member, acting by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:note_underwrite",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
