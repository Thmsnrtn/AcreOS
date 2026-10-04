/**
 * Wholesale underwriting — the residential wholesaler vertical's decision route.
 *
 * POST /api/wholesale/underwrite
 *   Recomputes the deal with the `wholesale_assignment` engine (buyer's max
 *   price, assignment fee, your costs, profit), freezes it as a scenario, and
 *   records the operator's call (offer / pursue / pass) as a decision under the
 *   residential_wholesaler strategy pack, citing that scenario. The decision
 *   carries the operator's own review date, so Today asks how it went.
 *
 * This is the vertical's half of the canonical loop
 * (decision-memos/2026-10-04-vertical-program.md). The kit enforces the
 * guarantees. The pack is a string literal here because evidence rule v2 reads
 * it, and a computed pack is evidence of nothing.
 *
 * Records a decision; sends nothing, contacts nobody, moves no money.
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
const bodySchema = underwriteBodySchema(["offer", "pursue", "pass"] as const);

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
      engineId: "wholesale_assignment",
      strategyPackId: "residential_wholesaler",
      inputs: body.inputs,
      scenarioLabel: `Wholesale underwriting — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member, acting by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:residential_wholesaler_underwrite",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
