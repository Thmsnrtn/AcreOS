/**
 * Wholesale underwriting — the residential wholesaler's decision route.
 *
 * POST /api/wholesale/underwrite
 *   Recomputes the offer with the `wholesale_mao` engine (the lesser of the
 *   operator's ceiling and the end buyer's, less the operator's labelled target
 *   fee), freezes it as a scenario with the comp, ARV and fee evidence the
 *   operator supplied attached as their own assumptions, and records the call
 *   (offer / pass) as a decision under the residential_wholesaler pack citing
 *   that scenario. The decision carries the operator's own review date, so the
 *   outcome loop asks how it went.
 *
 * The kit enforces the guarantees (verticalDecision.ts). The pack and engine
 * are string literals here because evidence rule v2 reads them, and neither is
 * steerable from the request body.
 *
 * Records a decision; sends nothing, contacts nobody, moves no money. The
 * assignment fee it underwrites is a number in a record, never a charge.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { ScenarioEngineError, type ScenarioAssumption } from "@shared/economics/scenario";
import { clock } from "./utils/clock";
import {
  describeProperty,
  loadOrgProperty,
  recordUnderwrittenDecision,
  underwriteBodySchema,
} from "./services/underwriting/verticalDecision";

const compSchema = z.object({
  address: z.string().trim().min(3).max(200),
  soldPriceCents: z.number().int().positive(),
  soldOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "soldOn must be YYYY-MM-DD")
    .refine((d) => Date.parse(`${d}T00:00:00Z`) <= clock.nowMs(), { message: "A comp's sale date cannot be in the future." }),
});

/**
 * The evidence behind the two numbers an offer rests on. Required: an ARV with
 * no comps behind it, or a fee with no reason, is a number the operator cannot
 * defend later — and the outcome loop grades exactly these.
 */
export const wholesaleEvidenceSchema = z.object({
  comps: z.array(compSchema).min(1, "List at least one sold comp behind the ARV.").max(10),
  arvBasis: z.string().trim().min(10).max(500),
  feeBasis: z.string().trim().min(10).max(500),
});

const bodySchema = underwriteBodySchema(["offer", "pass"] as const).extend({
  evidence: wholesaleEvidenceSchema,
});

/** The operator's evidence, frozen with the scenario as their own (origin "user") assumptions. */
export function evidenceAssumptions(e: z.infer<typeof wholesaleEvidenceSchema>): ScenarioAssumption[] {
  return [
    ...e.comps.map((c, i) => ({
      key: `comp_${i + 1}`,
      value: c.soldPriceCents,
      unit: "cents",
      origin: "user" as const,
      basis: `Sold comp: ${c.address}, sold ${c.soldOn}`,
    })),
    { key: "arv_basis", value: e.arvBasis, origin: "user" as const },
    { key: "fee_basis", value: e.feeBasis, origin: "user" as const },
  ];
}

const router = Router();

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
      engineId: "wholesale_mao",
      strategyPackId: "residential_wholesaler",
      inputs: body.inputs,
      assumptions: evidenceAssumptions(body.evidence),
      scenarioLabel: `Wholesale offer — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member, acting by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:wholesale_underwrite",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
