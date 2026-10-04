/**
 * The wholesale assignment engine: the registered adapter over
 * shared/calculators/wholesaleAssignment.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. An omitted marketing cost or
 * closing cost is excluded from total cost, and it must appear as an assumption
 * with its origin, never as a measured $0 (canonical law 3 applied to
 * arithmetic).
 *
 * Earnest money is the operator's own figure, so it is reported with origin
 * "user": it is at risk while the contract is open, and it is deliberately NOT
 * in total cost (it comes back when the contract assigns). There is no metric
 * for it, so the assumption list is where the amount at risk is shown.
 *
 * It declares the `residential_wholesaler` vertical: a decision under that pack
 * counts only when it cites a scenario from this engine (evidence rule v2).
 *
 * It reuses `total_cost`, `profit` and `roi` rather than minting wholesale
 * twins. `assignment_fee` and `buyer_max_price` are wholesale-specific. The
 * buyer's price is NOT emitted as `max_allowable_offer`: in wholesaling "MAO"
 * means the most the wholesaler offers the seller, and a desk showing the
 * buyer's price under that label invites an offer that earns $0 (V1 audit).
 */
import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import {
  WHOLESALE_ASSIGNMENT_ENGINE_ID,
  WHOLESALE_ASSIGNMENT_ENGINE_VERSION,
  WholesaleAssignmentInputError,
  computeWholesaleAssignment,
} from "@shared/calculators/wholesaleAssignment";

/** "$1,250" or "$1,250.50" — deterministic, no locale lookup. */
function dollars(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rem = cents % 100;
  return rem === 0 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, "0")}`;
}

export const wholesaleAssignmentEngine: EngineSpec = {
  id: WHOLESALE_ASSIGNMENT_ENGINE_ID,
  version: WHOLESALE_ASSIGNMENT_ENGINE_VERSION,
  label: "Wholesale assignment (buyer's max price, assignment fee, profit)",
  verticals: ["residential_wholesaler"],
  produces: ["buyer_max_price", "assignment_fee", "total_cost", "profit", "roi"],

  compute(inputs) {
    const normalised = {
      arvCents: requireCents(inputs, "arvCents"),
      buyerRulePct: requireNumber(inputs, "buyerRulePct"),
      buyerRepairEstimateCents: requireCents(inputs, "buyerRepairEstimateCents"),
      contractPriceCents: requireCents(inputs, "contractPriceCents"),
      marketingCostCents: optionalCents(inputs, "marketingCostCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      earnestMoneyCents: optionalCents(inputs, "earnestMoneyCents"),
    };

    let out;
    try {
      out = computeWholesaleAssignment(normalised);
    } catch (err) {
      if (err instanceof WholesaleAssignmentInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.marketingCostCents === null) {
      assumptions.push({
        key: "marketing_cost",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No marketing or acquisition cost was entered, so total cost and profit leave out what it cost to find this deal. Enter your figure before relying on them.",
      });
    }
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing or transaction cost was entered, so total cost and profit leave out title, escrow or attorney fees you pay to assign.",
      });
    }
    // The operator's own figure, not a substitution: shown so the amount at
    // risk is visible, and so it is clear why it is not in total cost.
    if (out.earnestMoneyAtRiskCents !== null) {
      assumptions.push({
        key: "earnest_money_at_risk",
        value: `${dollars(out.earnestMoneyAtRiskCents)} at risk`,
        origin: "user",
        basis: "Earnest money is at risk if the contract neither assigns nor closes. It is not counted in total cost, because when the contract assigns it is normally reimbursed by your buyer or credited at closing — check your assignment agreement says so",
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("buyer_max_price", out.buyerMaxPriceCents),
        metric("assignment_fee", out.assignmentFeeCents),
        metric("total_cost", out.totalCostCents),
        metric("profit", out.profitCents),
        metric("roi", out.roi),
      ],
    };
  },
};
