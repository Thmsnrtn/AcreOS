/**
 * Fix-and-flip decision desk — the flip vertical's kit-recorded decision.
 *
 * POST /api/fix-and-flip/decide
 *   Records the operator's call (acquire / offer / pass) on a property as a
 *   decision under the fix_and_flip strategy pack, citing a `flip_mao`
 *   scenario recomputed HERE from server-resolved inputs, with the operator's
 *   own rationale and review date. Through the shared kit
 *   (recordUnderwrittenDecision), so the evidence-rule-v2 ownership guard runs
 *   before anything is written.
 *
 * WHAT IS RECOMPUTED, NOT ACCEPTED
 *   - The flip rules come from the org's saved rules (platform defaults where
 *     unset), never from the request.
 *   - ARV: either the property's CURRENT ARV calculation row (its mid figure,
 *     loaded here) or a figure the operator states — the request says which,
 *     and the record says which.
 *   - Rehab: where the property has a rehab project, the project's scope total
 *     (line budgets summed now). A typed number that disagrees with it is
 *     refused; there is one estimate, and it lives in the project. With no
 *     project, the operator's stated estimate, labelled "operator-stated, no
 *     scope" — never presented as the same grade of number.
 *
 * THE EVIDENCE (founder/COO ruling 2026-11-05, option (a))
 *   Carried as scenario assumptions, which the kit already accepts: the ARV
 *   calculation's id, its low/mid/high and comp count, the comp-source posture,
 *   the rehab source with the project id, line count and total, and the
 *   per-field provenance of every flip rule. Two facts make the ARV id a sound
 *   reference rather than a pointer to something that can move: a saved
 *   calculation's comp set is never edited after insert (a newer calculation
 *   only flips `is_current`), and no route deletes ARV rows. The headline
 *   figures are frozen here as well, so the decision's evidence survives even
 *   a hypothetical change to the row.
 *
 * WHAT THIS IS NOT
 *   - Not the draft offer. POST /api/flip-analyzer/offer stays exactly as it is
 *     and keeps writing its own records; an offer is a draft document. This is
 *     the deliberate, gradeable decision (§3.3: a screen is not a decision).
 *   - Not advice. The engine computes, the operator decides, the record keeps it.
 *
 * Records a decision; sends nothing, contacts nobody, moves no money.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { arvCalculations, rehabs, rehabLineItems } from "@shared/schema/fix-and-flip";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { ScenarioEngineError, type ScenarioAssumption } from "@shared/economics/scenario";
import {
  computeMao,
  computeRentalReturns,
  resolveFlipDefaults,
  stampAssumptionSources,
  type FlipDefaults,
} from "./services/flipUnderwriting";
import {
  describeProperty,
  loadOrgProperty,
  recordUnderwrittenDecision,
  underwriteBodySchema,
} from "./services/underwriting/verticalDecision";

const router = Router();

const KINDS = ["acquire", "offer", "pass"] as const;

/**
 * The kit's body, minus its free-form `inputs`: here every engine input is
 * resolved on the server. `kind`, `choice`, `rationale` and the required-
 * nullable `reviewDueAt` keep the kit's own validation — one regime, not two.
 */
const flipDecideBodySchema = underwriteBodySchema(KINDS)
  .omit({ inputs: true })
  .extend({
    arv: z.discriminatedUnion("source", [
      /**
       * The saved calculation. `expectedArvCents` is the figure the operator
       * previewed; when the row has changed since, the request is refused
       * rather than freezing numbers the operator never saw.
       */
      z.object({ source: z.literal("calculation"), expectedArvCents: z.number().int().positive().optional() }),
      z.object({ source: z.literal("operator_stated"), arvCents: z.number().int().positive() }),
      /** The analyzer's in-browser median $/sq ft of pulled comps × subject sq ft, unadjusted. */
      z.object({ source: z.literal("comp_median_unadjusted"), arvCents: z.number().int().positive() }),
    ]),
    /** Only when the property has NO rehab project; with one, its scope total is the estimate. */
    operatorRehabEstimateCents: z.number().int().min(0).optional(),
    purchasePriceCents: z.number().int().positive().optional(),
    feeCents: z.number().int().min(0).default(0),
    /** The buy-and-hold comparison the operator ran, recorded as seen-not-chosen (§3.4). */
    holdComparisonSeen: z
      .object({
        monthlyRentCents: z.number().int().min(0),
        monthlyExpensesCents: z.number().int().min(0).optional(),
      })
      .optional(),
  });

const usd = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The property's CURRENT ARV calculation, org-scoped, with what the record needs. */
async function loadCurrentArvRow(organizationId: number, propertyId: number) {
  const [row] = await db
    .select({
      id: arvCalculations.id,
      arvLowCents: arvCalculations.arvLowCents,
      arvMidCents: arvCalculations.arvMidCents,
      arvHighCents: arvCalculations.arvHighCents,
      confidence: arvCalculations.confidence,
      compsUsed: arvCalculations.compsUsed,
      createdAt: arvCalculations.createdAt,
    })
    .from(arvCalculations)
    .where(
      and(
        eq(arvCalculations.organizationId, organizationId),
        eq(arvCalculations.propertyId, propertyId),
        eq(arvCalculations.isCurrent, true),
      ),
    )
    .orderBy(desc(arvCalculations.createdAt))
    .limit(1);
  return row ?? null;
}

/** The property's rehab project and its scope total right now, org-scoped. */
async function loadRehabScope(organizationId: number, propertyId: number) {
  const [rehab] = await db
    .select({ id: rehabs.id })
    .from(rehabs)
    .where(and(eq(rehabs.organizationId, organizationId), eq(rehabs.propertyId, propertyId)));
  if (!rehab) return null;
  const lines = await db
    .select({ budgetCents: rehabLineItems.budgetCents })
    .from(rehabLineItems)
    .where(and(eq(rehabLineItems.organizationId, organizationId), eq(rehabLineItems.rehabId, rehab.id)));
  return {
    rehabId: rehab.id,
    lineCount: lines.length,
    totalCents: lines.reduce((s, l) => s + Number(l.budgetCents ?? 0), 0),
  };
}

router.post("/decide", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const parsed = flipDecideBodySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    const body = parsed.data;

    const property = await loadOrgProperty(organizationId, body.propertyId);
    if (!property) return Errors.notFound(res, "Property");

    const evidence: ScenarioAssumption[] = [];

    // ── ARV: the calculation row, or the operator's stated figure ─────────
    let arvCents: number;
    if (body.arv.source === "calculation") {
      const row = await loadCurrentArvRow(organizationId, property.id);
      if (!row) {
        return Errors.badRequest(
          res,
          "This property has no saved ARV calculation. Compute one from comps first, or record the decision on an ARV you state yourself.",
        );
      }
      arvCents = Number(row.arvMidCents);
      if (body.arv.expectedArvCents !== undefined && body.arv.expectedArvCents !== arvCents) {
        return Errors.badRequest(
          res,
          `The saved ARV calculation has changed since you previewed it (it is now ${usd(arvCents)}). Re-run the MAO on the current figure before recording.`,
          { arvCents },
        );
      }
      const comps = Array.isArray(row.compsUsed) ? row.compsUsed : [];
      evidence.push(
        { key: "arv_source", value: "calculation", origin: "derived", basis: "The ARV is the mid figure of this property's current saved ARV calculation." },
        { key: "arv_calculation_id", value: row.id, origin: "derived", basis: "A saved calculation's comp set is never edited after it is saved, and no route deletes ARV rows; a newer calculation only marks this one not-current." },
        { key: "arv_low_cents", value: Number(row.arvLowCents), unit: "cents", origin: "derived", basis: "Frozen from the calculation at decision time." },
        { key: "arv_mid_cents", value: Number(row.arvMidCents), unit: "cents", origin: "derived", basis: "Frozen from the calculation at decision time; the figure the MAO used." },
        { key: "arv_high_cents", value: Number(row.arvHighCents), unit: "cents", origin: "derived", basis: "Frozen from the calculation at decision time." },
        { key: "arv_comp_count", value: comps.length, origin: "derived", basis: "Comparables in the calculation's comp set." },
        { key: "arv_calculated_at", value: new Date(row.createdAt).toISOString(), origin: "derived", basis: "When the ARV calculation was saved." },
        {
          key: "arv_comp_source",
          value: "not recorded",
          origin: "derived",
          basis: "The ARV calculation does not store whether its comps came from the ATTOM seam or were entered by hand, so this record does not claim either.",
        },
      );
      if (row.confidence) {
        evidence.push({
          key: "arv_confidence",
          value: row.confidence,
          origin: "derived",
          basis: "Computed by the ARV calculator from its comps: high with 3+ comps within 0.5 mi sold in the last 6 months, medium with 3+ comps, low otherwise.",
        });
      }
    } else if (body.arv.source === "comp_median_unadjusted") {
      arvCents = body.arv.arvCents;
      evidence.push({
        key: "arv_source",
        value: "comp_median_unadjusted",
        origin: "derived",
        basis:
          "Derived in the analyzer: the median sale price per sq ft of the comps pulled there, times the subject's sq ft — not adjusted for condition, and with no saved ARV calculation behind it.",
      });
    } else {
      arvCents = body.arv.arvCents;
      evidence.push({
        key: "arv_source",
        value: "operator_stated",
        origin: "user",
        basis: "The operator stated this ARV; no saved ARV calculation backs it.",
      });
    }

    // ── Rehab: the project's scope total, or the operator's stated estimate ─
    let rehabEstimateCents: number;
    const scope = await loadRehabScope(organizationId, property.id);
    if (scope) {
      if (scope.lineCount === 0 || scope.totalCents === 0) {
        return Errors.badRequest(
          res,
          "This property's rehab project has no priced scope lines yet. Price its lines first — with a project, its scope total is the rehab estimate.",
        );
      }
      if (body.operatorRehabEstimateCents !== undefined && body.operatorRehabEstimateCents !== scope.totalCents) {
        return Errors.badRequest(
          res,
          `This property has a rehab project, and its scope total (${usd(scope.totalCents)}) is the rehab estimate. Change the line prices on the project rather than typing a different number here.`,
          { scopeTotalCents: scope.totalCents },
        );
      }
      rehabEstimateCents = scope.totalCents;
      evidence.push(
        { key: "rehab_source", value: "sow", origin: "derived", basis: "The rehab estimate is the property's rehab project scope total (line budgets summed at decision time)." },
        { key: "rehab_id", value: scope.rehabId, origin: "derived", basis: "The rehab project whose scope priced this decision." },
        { key: "rehab_sow_line_count", value: scope.lineCount, origin: "derived", basis: "Scope lines summed." },
        { key: "rehab_sow_total_cents", value: scope.totalCents, unit: "cents", origin: "derived", basis: "Frozen at decision time; later line edits do not move it." },
      );
    } else {
      if (body.operatorRehabEstimateCents === undefined) {
        return Errors.badRequest(
          res,
          "No rehab estimate. This property has no rehab project, so state your rehab estimate — it is recorded as operator-stated, with no scope behind it.",
        );
      }
      rehabEstimateCents = body.operatorRehabEstimateCents;
      evidence.push({
        key: "rehab_source",
        value: "operator_stated",
        origin: "user",
        basis: "Operator-stated rehab estimate; no rehab project or scope of work existed for this property when the decision was made.",
      });
    }

    // ── The org's flip rules, with per-field provenance ──────────────────
    const stored = getOrganization(req).underwritingDefaults?.flip as Partial<FlipDefaults> | null | undefined;
    const resolved = resolveFlipDefaults(stored ?? null);
    const preview = computeMao({
      arvCents,
      rehabEstimateCents,
      purchasePriceCents: body.purchasePriceCents ?? null,
      feeCents: body.feeCents,
      defaults: resolved.values,
    });
    // Each rule's origin comes from where its VALUE came from (the org's saved
    // rule, or the platform default) — field by field, never from the display.
    const RULE_FIELD: Record<string, keyof FlipDefaults> = {
      maoRulePct: "maoRulePct",
      rehabContingencyPct: "rehabContingencyPct",
      sellingCostPct: "sellingCostPct",
      purchaseClosingPct: "purchaseClosingPct",
      holdingCost: "monthlyHoldingCostCents",
      targetProfitPct: "targetProfitPct",
    };
    const originOf = (field: keyof FlipDefaults) =>
      resolved.sources[field] === "org_rule" ? ("user" as const) : ("platform-default" as const);
    const rules: ScenarioAssumption[] = stampAssumptionSources(preview.assumptions, resolved.sources).map((a) => ({
      key: a.key,
      value: a.display,
      origin: RULE_FIELD[a.key] ? originOf(RULE_FIELD[a.key]) : ("derived" as const),
      basis: a.label,
    }));
    // The hold period is its own rule: holding cost is monthly × months, and
    // the two can come from different places.
    rules.push({
      key: "rule_hold_months",
      value: resolved.values.holdMonths,
      unit: "months",
      origin: originOf("holdMonths"),
      basis: "Months of carry the MAO's holding cost assumes.",
    });

    // ── The hold comparison the operator saw — recorded, not chosen ──────
    const seen: ScenarioAssumption[] = [];
    if (body.holdComparisonSeen) {
      if (body.purchasePriceCents === undefined) {
        return Errors.badRequest(res, "A hold comparison needs the purchase price it was run at.");
      }
      const r = computeRentalReturns({
        purchasePriceCents: body.purchasePriceCents,
        monthlyRentCents: body.holdComparisonSeen.monthlyRentCents,
        monthlyExpensesCents: body.holdComparisonSeen.monthlyExpensesCents ?? null,
      });
      // Seen, not chosen (§3.4): the inputs the operator gave, the platform's
      // stand-in where they gave none, and what the comparison computed from them.
      seen.push(
        { key: "hold_comparison_monthly_rent_cents", value: body.holdComparisonSeen.monthlyRentCents, unit: "cents", origin: "user", basis: "Seen, not chosen: the rent the operator entered for the hold comparison." },
        r.expenseBasis === "operator"
          ? { key: "hold_comparison_monthly_expenses_cents", value: body.holdComparisonSeen.monthlyExpensesCents as number, unit: "cents", origin: "user", basis: "Seen, not chosen: expenses the operator entered." }
          : { key: "hold_comparison_expense_basis", value: "assumed 40% of rent", origin: "platform-default", basis: "No expenses were entered; the comparison assumed expenses run 40% of rent." },
        { key: "hold_comparison_monthly_cash_flow_cents", value: r.monthlyCashFlowCents, unit: "cents", origin: "derived", basis: "Seen, not chosen: the hold comparison's monthly cash flow at this price, computed from the figures above." },
        { key: "hold_comparison_cap_rate_pct", value: r.capRatePct, unit: "percent", origin: "derived", basis: "Seen, not chosen: the hold comparison's cap rate, computed from the figures above." },
      );
    }

    const out = await recordUnderwrittenDecision(organizationId, {
      subjectType: "property",
      subjectId: property.id,
      engineId: "flip_mao",
      strategyPackId: "fix_and_flip",
      inputs: {
        arvCents,
        rehabEstimateCents,
        ...(body.purchasePriceCents === undefined ? {} : { purchasePriceCents: body.purchasePriceCents }),
        feeCents: body.feeCents,
        maoRulePct: resolved.values.maoRulePct,
        rehabContingencyPct: resolved.values.rehabContingencyPct,
        sellingCostPct: resolved.values.sellingCostPct,
        purchaseClosingPct: resolved.values.purchaseClosingPct,
        holdMonths: resolved.values.holdMonths,
        monthlyHoldingCostCents: resolved.values.monthlyHoldingCostCents,
        targetProfitPct: resolved.values.targetProfitPct,
      },
      assumptions: [...evidence, ...rules, ...seen],
      scenarioLabel: `Flip decision — ${describeProperty(property)}`,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorRef: userId,
      // The real authority: an authenticated org member deciding by hand on
      // their own org's property (tenancy checked above).
      authority: "org_member:flip_decide",
      reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
    });

    res.json({ ...out, recordKind: "decision" as const });
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

export default router;
