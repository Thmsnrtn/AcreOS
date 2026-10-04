/**
 * The buy-and-hold acquisition engine: the registered adapter over
 * shared/calculators/rentalAcquisition.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. An omitted closing cost or rehab
 * budget is excluded from the totals, and it must appear as an assumption with
 * its origin, never as a measured $0 (canonical law 3 applied to arithmetic).
 *
 * It declares the `buy_and_hold` vertical: a decision under that pack counts
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
  RENTAL_ACQUISITION_ENGINE_ID,
  RENTAL_ACQUISITION_ENGINE_VERSION,
  RentalAcquisitionInputError,
  computeRentalAcquisition,
} from "@shared/calculators/rentalAcquisition";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

export const rentalAcquisitionEngine: EngineSpec = {
  id: RENTAL_ACQUISITION_ENGINE_ID,
  version: RENTAL_ACQUISITION_ENGINE_VERSION,
  label: "Buy-and-hold acquisition (NOI, cash flow, cash-on-cash, DSCR)",
  verticals: ["buy_and_hold"],
  produces: [
    "total_cost",
    "cash_required",
    "effective_gross_income",
    "annual_operating_expense",
    "annual_noi",
    "annual_debt_service",
    "monthly_cash_flow",
    "cap_rate",
    "cash_on_cash",
    "dscr",
    "operating_expense_ratio",
    "gross_rent_multiplier",
  ],

  compute(inputs) {
    const normalised = {
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      rehabCents: optionalCents(inputs, "rehabCents"),
      monthlyRentCents: requireCents(inputs, "monthlyRentCents"),
      vacancyPct: requireNumber(inputs, "vacancyPct"),
      monthlyFixedExpensesCents: requireCents(inputs, "monthlyFixedExpensesCents"),
      managementPct: requireNumber(inputs, "managementPct"),
      reservesPct: requireNumber(inputs, "reservesPct"),
      downPaymentPct: optionalNumber(inputs, "downPaymentPct"),
      interestRatePct: optionalNumber(inputs, "interestRatePct"),
      amortizationYears: optionalNumber(inputs, "amortizationYears"),
    };

    let out;
    try {
      out = computeRentalAcquisition(normalised);
    } catch (err) {
      if (err instanceof RentalAcquisitionInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing cost was entered, so total cost and cash required leave it out. Enter your estimate before relying on them.",
      });
    }
    if (normalised.rehabCents === null) {
      assumptions.push({
        key: "rehab",
        value: "none budgeted",
        origin: "platform-default",
        basis: "No rehab budget was entered, so the property is treated as rent-ready.",
      });
    }
    // Only an ABSENT down payment is our substitution. 100% down is the
    // operator's own answer (all cash), not a default to declare.
    if (normalised.downPaymentPct === null) {
      assumptions.push({
        key: "financing",
        value: "all cash",
        origin: "platform-default",
        basis: "No down payment was entered, so the purchase is modelled as all cash: no debt service, no DSCR.",
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        metric("cash_required", out.cashRequiredCents),
        metric("effective_gross_income", out.effectiveGrossIncomeCents),
        metric("annual_operating_expense", out.annualOperatingExpenseCents),
        metric("annual_noi", out.annualNoiCents),
        metric("annual_debt_service", out.annualDebtServiceCents),
        metric("monthly_cash_flow", out.monthlyCashFlowCents),
        metric("cap_rate", out.capRate),
        metric("cash_on_cash", out.cashOnCash),
        metric("dscr", out.dscr),
        metric("operating_expense_ratio", out.operatingExpenseRatio),
        metric("gross_rent_multiplier", out.grossRentMultiplier),
      ],
    };
  },
};
