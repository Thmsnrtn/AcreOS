/**
 * The wholesale MAO engine — the residential wholesaler's registered engine.
 *
 * WHAT IT ANSWERS. "What is the most I can put this house under contract for,
 * and still assign it at the fee I want?" A wholesaler's contract price has to
 * clear TWO ceilings, not one:
 *
 *   seller side   the MAO under the OPERATOR'S own rules — the ceiling they
 *                 would accept were they the end buyer;
 *   buyer side    the MAO under the END BUYER'S stated rules (their rule % and
 *                 rehab contingency) — what a cash buyer will actually pay.
 *
 *   offer = min(seller-side MAO, buyer-side MAO) − the operator's target fee.
 *
 * The fee comes out of the BINDING side, once. Taking it out of each side
 * before the `min` would give the same number, but recording which side bound
 * is the part an outcome can later teach from ("my buyers' numbers were the
 * constraint on 9 of 10 deals"), so the sides are computed fee-free and the
 * fee is subtracted after.
 *
 * IT DELEGATES; IT DOES NOT REIMPLEMENT. Both ceilings come from `computeMao`
 * (server/services/flipUnderwriting.ts), the single MAO implementation the
 * flip engine also wraps. Only the rule-MAO and the contingency are read from
 * its result; it is handed a rule set whose carry, closing and selling fields
 * are zero because the RULE MAO does not depend on them (computeMao's rule
 * pass reads only the rule % and the contingency-inclusive rehab), and none of
 * the profit fields those zeros would shape are read or reported here.
 *
 * WHAT IT PREDICTS. `max_allowable_offer` (the offer), `assignment_fee` (the
 * labelled target) and `profit` — which for an assignment IS the fee: the
 * wholesaler's whole return is the spread they assign at, so the predicted
 * profit is the fee they underwrote, and the realised fee is what an outcome
 * grades it against. `profit` is what makes the decision gradeable by the
 * existing outcome loop (verticalReadiness: a decided vertical must predict
 * `total_cost` or `profit`). No `total_cost` is claimed: a wholesaler who
 * assigns never pays the contract price, and naming it a cost would be wrong.
 *
 * NO DEFAULTS. Every input is required. A buyer's rule % defaulted to "70%"
 * would be the most common number in wholesaling and still an invented fact
 * about THIS buyer, so the engine refuses rather than assumes.
 *
 * Declares `residential_wholesaler`: a decision under that pack counts only
 * when it cites a scenario from this engine (evidence rule v2).
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import { computeMao } from "../../flipUnderwriting";

const WHOLESALE_MAO_ENGINE_ID = "wholesale_mao" as const;
/** Bumped when the formula or the mapping changes. */
const WHOLESALE_MAO_ENGINE_VERSION = "wholesale-mao-1" as const;

function pctInput(
  inputs: Record<string, number | string>,
  key: string,
  { min, max, exclusiveMin }: { min: number; max: number; exclusiveMin?: boolean },
): number {
  const v = requireNumber(inputs, key);
  if ((exclusiveMin ? v <= min : v < min) || v > max) {
    throw new ScenarioEngineError(
      `"${key}" must be ${exclusiveMin ? "above" : "at least"} ${min} and at most ${max} (percentage points)`,
    );
  }
  return v;
}

/** One side's rule MAO, fee-free, from the shared implementation. */
function sideMao(arvCents: number, rehabEstimateCents: number, rulePct: number, contingencyPct: number) {
  const r = computeMao({
    arvCents,
    rehabEstimateCents,
    purchasePriceCents: null,
    feeCents: 0,
    // Only maoRulePct and rehabContingencyPct reach the rule MAO read below.
    // The remaining fields shape computeMao's PROFIT figures, which this
    // engine never reads or reports.
    defaults: {
      maoRulePct: rulePct,
      rehabContingencyPct: contingencyPct,
      sellingCostPct: 0,
      purchaseClosingPct: 0,
      holdMonths: 0,
      monthlyHoldingCostCents: 0,
      targetProfitPct: 0,
    },
  });
  return { maoCents: r.maoCents, rehabWithContingencyCents: r.rehabWithContingencyCents };
}

function usd(cents: number): string {
  return `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
}

export interface WholesaleMaoBreakdown {
  sellerSideMaoCents: number;
  buyerSideMaoCents: number;
  bindingSide: "seller" | "buyer";
  targetFeeCents: number;
  offerCents: number;
}

/**
 * The arithmetic alone. Exported so the disposition packet RE-DERIVES the
 * buyer-side ceiling from the frozen inputs with the same function the engine
 * froze it with (server/services/wholesale/disposition.ts).
 */
export function computeWholesaleMao(
  inputs: Record<string, number | string>,
): WholesaleMaoBreakdown & { normalised: Record<string, number> } {
  const arvCents = requireCents(inputs, "arvCents");
  if (arvCents <= 0) throw new ScenarioEngineError("arvCents must be positive");
  const rehabEstimateCents = requireCents(inputs, "rehabEstimateCents");
  if (rehabEstimateCents < 0) throw new ScenarioEngineError("rehabEstimateCents cannot be negative");
  const targetFeeCents = requireCents(inputs, "targetFeeCents");
  if (targetFeeCents < 0) throw new ScenarioEngineError("targetFeeCents cannot be negative");

  const sellerRulePct = pctInput(inputs, "sellerRulePct", { min: 0, max: 100, exclusiveMin: true });
  const sellerContingencyPct = pctInput(inputs, "sellerContingencyPct", { min: 0, max: 100 });
  const buyerRulePct = pctInput(inputs, "buyerRulePct", { min: 0, max: 100, exclusiveMin: true });
  const buyerContingencyPct = pctInput(inputs, "buyerContingencyPct", { min: 0, max: 100 });

  const seller = sideMao(arvCents, rehabEstimateCents, sellerRulePct, sellerContingencyPct);
  const buyer = sideMao(arvCents, rehabEstimateCents, buyerRulePct, buyerContingencyPct);
  // Ties bind on the buyer side: the buyer is the one who must actually pay.
  const bindingSide: "seller" | "buyer" = seller.maoCents < buyer.maoCents ? "seller" : "buyer";
  const ceilingCents = Math.min(seller.maoCents, buyer.maoCents);

  return {
    sellerSideMaoCents: seller.maoCents,
    buyerSideMaoCents: buyer.maoCents,
    bindingSide,
    targetFeeCents,
    offerCents: ceilingCents - targetFeeCents,
    normalised: {
      arvCents,
      rehabEstimateCents,
      targetFeeCents,
      sellerRulePct,
      sellerContingencyPct,
      buyerRulePct,
      buyerContingencyPct,
    },
  };
}

export const wholesaleMaoEngine: EngineSpec = {
  id: WHOLESALE_MAO_ENGINE_ID,
  version: WHOLESALE_MAO_ENGINE_VERSION,
  label: "Wholesale MAO (lesser of your ceiling and your buyer's, less your fee)",
  verticals: ["residential_wholesaler"],
  produces: ["max_allowable_offer", "assignment_fee", "profit"],

  compute(inputs) {
    const r = computeWholesaleMao(inputs);

    const assumptions: ScenarioAssumption[] = [
      {
        key: "seller_side_mao",
        value: r.sellerSideMaoCents,
        unit: "cents",
        origin: "derived",
        basis: `${r.normalised.sellerRulePct}% of ARV less rehab with ${r.normalised.sellerContingencyPct}% contingency (your rules): ${usd(r.sellerSideMaoCents)}`,
      },
      {
        key: "buyer_side_mao",
        value: r.buyerSideMaoCents,
        unit: "cents",
        origin: "derived",
        basis: `${r.normalised.buyerRulePct}% of ARV less rehab with ${r.normalised.buyerContingencyPct}% contingency (your end buyer's stated rules): ${usd(r.buyerSideMaoCents)}`,
      },
      {
        key: "binding_side",
        value: r.bindingSide,
        origin: "derived",
        basis:
          r.bindingSide === "buyer"
            ? "Your end buyer's ceiling is the lower one, so it sets the offer."
            : "Your own ceiling is the lower one, so it sets the offer.",
      },
    ];

    return {
      normalisedInputs: r.normalised,
      assumptions,
      metrics: [
        metric("max_allowable_offer", r.offerCents),
        metric("assignment_fee", r.targetFeeCents),
        // An assignment's whole return is its fee: the predicted profit IS the
        // target fee, graded later against the fee actually realised.
        metric("profit", r.targetFeeCents),
      ],
    };
  },
};
