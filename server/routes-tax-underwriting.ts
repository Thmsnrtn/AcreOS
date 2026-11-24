/**
 * Tax underwriting — the tax lien / deed vertical's decision route
 * (Step 0 item T5).
 *
 * POST /api/tax-lien/underwrite
 *   Recomputes the max bid with the `tax_max_bid` engine (the most the
 *   operator can bid for a tax-sale lot and still make their required
 *   return, from their own rights stack), freezes it as a scenario, and
 *   records the operator's call (offer / pass) as a decision under the
 *   tax_lien_deed strategy pack, citing that scenario. The decision
 *   carries the operator's own review date, so the outcome loop can
 *   later grade the call against what the lot actually did.
 *
 * The subject is the lot's property, as on every desk the shared kit
 * serves: the kit's body schema and tenancy check are property-shaped,
 * and the property is the asset both sides of the tax sale point at.
 *
 * The kit enforces the guarantees (verticalDecision.ts). The pack and
 * engine are string literals here because evidence rule v2 reads them,
 * and neither is steerable from the request body.
 *
 * Records a decision; places no bid, sends nothing, moves no money. The
 * max bid it underwrites is a number in a record, never an auction bid —
 * AcreOS is the screen, never the bidder.
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
const bodySchema = underwriteBodySchema(["offer", "pass"] as const);

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
      engineId: "tax_max_bid",
      strategyPackId: "tax_lien_deed",
      inputs: body.inputs,
      scenarioLabel: `Tax max bid — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member, acting by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:tax_underwrite",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
