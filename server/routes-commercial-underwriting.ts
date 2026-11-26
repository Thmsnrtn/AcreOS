/**
 * Commercial underwriting — the commercial vertical's decision route
 * (Step 0 gap sheet commercial.md, work item 2, bar (b)).
 *
 * POST /api/commercial/underwrite
 *   Recomputes the acquisition/hold underwrite with the
 *   `commercial_underwrite` engine (in-place NOI, cap rate and rollover
 *   from the org's RECORDED figures: the operator-entered price, the
 *   recorded leases' rents, recorded CAM recoveries, and operating
 *   expenses measured from the expense records), freezes it as a
 *   scenario, and records the operator's call (acquire / hold / pass)
 *   as a decision under the commercial strategy pack, citing that
 *   scenario. The decision carries the operator's own review date, so
 *   the outcome loop can later grade the call against what the asset
 *   actually did.
 *
 * The subject is the property, as on every desk the shared kit serves:
 * the kit's body schema and tenancy check are property-shaped.
 *
 * The kit enforces the guarantees (verticalDecision.ts). The pack and
 * engine are string literals here because evidence rule v2 reads them,
 * and neither is steerable from the request body.
 *
 * Records a decision; buys nothing, sends nothing, moves no money. The
 * engine invents no market figure — no market rent, no comp, no assumed
 * expense — and with expenses unmeasured it returns no NOI, which the
 * record states rather than papering over.
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
const bodySchema = underwriteBodySchema(["acquire", "hold", "pass"] as const);

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
      engineId: "commercial_underwrite",
      strategyPackId: "commercial",
      inputs: body.inputs,
      scenarioLabel: `Commercial underwrite — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member, acting by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:commercial_underwrite",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
