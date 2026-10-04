/**
 * The agent-investor flip engine: the registered adapter over
 * shared/calculators/agentFlip.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. An omitted purchase closing cost,
 * rehab budget or monthly holding cost is excluded from total cost, and it
 * must appear as an assumption with its origin, never as a measured $0.
 *
 * Every commission and split rate is required, so none is ever declared: a 0%
 * listing commission or a 0% split (an agent past their annual cap) is the
 * operator's own answer, not a default.
 *
 * It declares the `agent_investor` vertical: a decision under that pack counts
 * only when it cites a scenario from this engine (evidence rule v2).
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
  AGENT_FLIP_ENGINE_ID,
  AGENT_FLIP_ENGINE_VERSION,
  AgentFlipInputError,
  computeAgentFlip,
} from "@shared/calculators/agentFlip";

export const agentFlipEngine: EngineSpec = {
  id: AGENT_FLIP_ENGINE_ID,
  version: AGENT_FLIP_ENGINE_VERSION,
  label: "Agent-investor flip (own-account purchase with buy-side and listing commission)",
  verticals: ["agent_investor"],
  produces: ["total_cost", "net_proceeds", "profit", "roi", "annualized_return", "hold_months"],

  compute(inputs) {
    const normalised = {
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      buySideCommissionPct: requireNumber(inputs, "buySideCommissionPct"),
      buySideBrokerageSplitPct: requireNumber(inputs, "buySideBrokerageSplitPct"),
      purchaseClosingCostsCents: optionalCents(inputs, "purchaseClosingCostsCents"),
      rehabCents: optionalCents(inputs, "rehabCents"),
      holdMonths: requireNumber(inputs, "holdMonths"),
      monthlyHoldingCostCents: optionalCents(inputs, "monthlyHoldingCostCents"),
      salePriceCents: requireCents(inputs, "salePriceCents"),
      listingCommissionPct: requireNumber(inputs, "listingCommissionPct"),
      listingBrokerageSplitPct: requireNumber(inputs, "listingBrokerageSplitPct"),
      coopCommissionPct: requireNumber(inputs, "coopCommissionPct"),
      saleClosingCostsPct: requireNumber(inputs, "saleClosingCostsPct"),
    };

    let out;
    try {
      out = computeAgentFlip(normalised);
    } catch (err) {
      if (err instanceof AgentFlipInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.purchaseClosingCostsCents === null) {
      assumptions.push({
        key: "purchase_closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No purchase closing cost was entered, so total cost leaves it out. Enter your estimate before relying on the profit.",
      });
    }
    if (normalised.rehabCents === null) {
      assumptions.push({
        key: "rehab",
        value: "none budgeted",
        origin: "platform-default",
        basis: "No rehab budget was entered, so the property is treated as ready to sell as bought.",
      });
    }
    if (normalised.monthlyHoldingCostCents === null) {
      assumptions.push({
        key: "holding_cost",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No monthly holding cost was entered, so carry during the hold is left out of total cost. Taxes, insurance, utilities and loan interest are not free.",
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        metric("net_proceeds", out.netProceedsCents),
        metric("profit", out.profitCents),
        metric("roi", out.roi),
        metric("annualized_return", out.annualizedReturn),
        metric("hold_months", out.holdMonths),
      ],
    };
  },
};
