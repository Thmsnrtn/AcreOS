/**
 * The land development engine: the registered adapter over
 * shared/calculators/developmentProforma.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. An omitted monthly carry is
 * excluded from total cost, profit and IRR, and it must appear as an assumption
 * with its origin, never as a measured $0 (canonical law 3 applied to
 * arithmetic).
 *
 * It declares the `developer` vertical: a decision under that pack counts only
 * when it cites a scenario from this engine (evidence rule v2).
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
  DEVELOPMENT_PROFORMA_ENGINE_ID,
  DEVELOPMENT_PROFORMA_ENGINE_VERSION,
  DevelopmentProformaInputError,
  computeDevelopmentProforma,
} from "@shared/calculators/developmentProforma";

export const developmentProformaEngine: EngineSpec = {
  id: DEVELOPMENT_PROFORMA_ENGINE_ID,
  version: DEVELOPMENT_PROFORMA_ENGINE_VERSION,
  label: "Land development pro-forma (sell-out, profit, IRR)",
  verticals: ["developer"],
  produces: [
    "total_cost", "acquisition_cost",
    "gross_sellout",
    "net_proceeds",
    "profit",
    "roi",
    "annualized_return",
    "irr",
    "hold_months",
  ],

  compute(inputs) {
    const normalised = {
      landCostCents: requireCents(inputs, "landCostCents"),
      entitlementCostsCents: requireCents(inputs, "entitlementCostsCents"),
      improvementCostsCents: requireCents(inputs, "improvementCostsCents"),
      lotCount: requireNumber(inputs, "lotCount"),
      averageLotPriceCents: requireCents(inputs, "averageLotPriceCents"),
      sellingCostPct: requireNumber(inputs, "sellingCostPct"),
      entitlementMonths: requireNumber(inputs, "entitlementMonths"),
      developmentMonths: requireNumber(inputs, "developmentMonths"),
      selloutMonths: requireNumber(inputs, "selloutMonths"),
      monthlyCarryCents: optionalCents(inputs, "monthlyCarryCents"),
    };

    let out;
    try {
      out = computeDevelopmentProforma(normalised);
    } catch (err) {
      if (err instanceof DevelopmentProformaInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    // Only an ABSENT carry is our substitution. An explicit 0 is the operator's
    // own answer (land held free and clear, taxes paid elsewhere).
    if (normalised.monthlyCarryCents === null) {
      assumptions.push({
        key: "carry",
        value: "not entered — excluded",
        origin: "platform-default",
        basis:
          `No monthly carry was entered, so taxes, insurance and interest over the ${out.holdMonths}-month ` +
          "hold are left out of total cost, profit and IRR. Enter your estimate before relying on them.",
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        // What it costs to TAKE IT DOWN (the land; entitlement, improvements and carry come after) — what Today asks at "Acquired".
        metric("acquisition_cost", normalised.landCostCents),
        metric("gross_sellout", out.grossSelloutCents),
        metric("net_proceeds", out.netProceedsCents),
        metric("profit", out.profitCents),
        metric("roi", out.roi),
        metric("annualized_return", out.annualizedReturn),
        metric("irr", out.irr),
        metric("hold_months", out.holdMonths),
      ],
    };
  },
};
