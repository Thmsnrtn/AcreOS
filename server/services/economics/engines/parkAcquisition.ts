/**
 * The mobile-home park acquisition engine: the registered adapter over
 * shared/calculators/parkAcquisition.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. Omitted park-owned homes, other
 * income, closing costs or infrastructure capex are excluded from the totals;
 * an omitted down payment is modelled as all cash; an omitted market cap rate
 * means no value at market is computed. Each must appear as an assumption with
 * its origin, never as a measured $0 (canonical law 3 applied to arithmetic).
 *
 * It declares the `mobile_home` vertical: a decision under that pack counts
 * only when it cites a scenario from this engine (evidence rule v2).
 *
 * Occupancy is the operator's own occupied-lot count, so there is nothing to
 * declare about it: it is never assumed.
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
  PARK_ACQUISITION_ENGINE_ID,
  PARK_ACQUISITION_ENGINE_VERSION,
  ParkAcquisitionInputError,
  computeParkAcquisition,
} from "@shared/calculators/parkAcquisition";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

export const parkAcquisitionEngine: EngineSpec = {
  id: PARK_ACQUISITION_ENGINE_ID,
  version: PARK_ACQUISITION_ENGINE_VERSION,
  label: "Mobile-home park acquisition (lot and park-owned-home income, NOI, cash flow, DSCR, value at market cap)",
  verticals: ["mobile_home"],
  produces: [
    "total_cost", "acquisition_cost",
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
    "stabilized_value",
  ],

  compute(inputs) {
    const normalised = {
      totalLots: requireNumber(inputs, "totalLots"),
      occupiedLots: requireNumber(inputs, "occupiedLots"),
      monthlyLotRentCents: requireCents(inputs, "monthlyLotRentCents"),
      parkOwnedHomes: optionalNumber(inputs, "parkOwnedHomes"),
      parkOwnedHomeRentCents: optionalCents(inputs, "parkOwnedHomeRentCents"),
      otherMonthlyIncomeCents: optionalCents(inputs, "otherMonthlyIncomeCents"),
      creditLossPct: requireNumber(inputs, "creditLossPct"),
      annualOperatingExpensesCents: requireCents(inputs, "annualOperatingExpensesCents"),
      managementPct: requireNumber(inputs, "managementPct"),
      capexReservePerLotPerYearCents: requireCents(inputs, "capexReservePerLotPerYearCents"),
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      infrastructureCapexCents: optionalCents(inputs, "infrastructureCapexCents"),
      downPaymentPct: optionalNumber(inputs, "downPaymentPct"),
      interestRatePct: optionalNumber(inputs, "interestRatePct"),
      amortizationYears: optionalNumber(inputs, "amortizationYears"),
      marketCapRatePct: optionalNumber(inputs, "marketCapRatePct"),
    };

    let out;
    try {
      out = computeParkAcquisition(normalised);
    } catch (err) {
      if (err instanceof ParkAcquisitionInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    // Only an ABSENT home count is our substitution. 0 is the operator's own
    // answer (a lot-rent-only park), not a default to declare.
    if (normalised.parkOwnedHomes === null) {
      assumptions.push({
        key: "park_owned_homes",
        value: "none counted",
        origin: "platform-default",
        basis: "No park-owned home count was entered, so the park is modelled on lot rent alone and no home rent is counted. Enter how many homes the park owns and rents out, if any.",
      });
    }
    if (normalised.otherMonthlyIncomeCents === null) {
      assumptions.push({
        key: "other_income",
        value: "none counted",
        origin: "platform-default",
        basis: "No other income was entered, so laundry and utility bill-back are left out of income. Enter what the park actually collects, if anything.",
      });
    }
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing cost was entered, so total cost and cash required leave it out. Enter your estimate before relying on them.",
      });
    }
    if (normalised.infrastructureCapexCents === null) {
      assumptions.push({
        key: "infrastructure_capex",
        value: "none budgeted",
        origin: "platform-default",
        basis: "No infrastructure capex was entered, so the park's roads, water, sewer and electrical are treated as needing no capital work at purchase.",
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
    if (normalised.marketCapRatePct === null) {
      assumptions.push({
        key: "market_cap_rate",
        value: "not entered — no value at market",
        origin: "platform-default",
        basis: "No market cap rate was entered, so the park's value at market is not computed. Enter the cap rate comparable parks trade at to see it.",
      });
    } else if (out.stabilizedValueCents === null) {
      assumptions.push({
        key: "value_at_market",
        value: "not computed — NOI is negative",
        origin: "derived",
        basis: "The park loses money before debt service, so dividing NOI by a cap rate gives no meaningful value.",
      });
    }

    // Persist what the arithmetic consumed. Loan terms on an all-cash purchase,
    // and a home rent when the park owns no homes, were not used, so they are
    // not recorded as inputs to it.
    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) {
      if (v === null) continue;
      if (!out.financed && (k === "interestRatePct" || k === "amortizationYears")) continue;
      if (k === "parkOwnedHomeRentCents" && !normalised.parkOwnedHomes) continue;
      wire[k] = v;
    }

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        // What it costs to TAKE IT DOWN (price + closing; infrastructure capex comes after) — what Today asks at "Acquired".
        metric("acquisition_cost", normalised.purchasePriceCents + (normalised.closingCostsCents ?? 0)),
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
        metric("stabilized_value", out.stabilizedValueCents),
      ],
    };
  },
};
