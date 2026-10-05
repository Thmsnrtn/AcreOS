/**
 * The short-term rental acquisition engine: the registered adapter over
 * shared/calculators/strAcquisition.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. Omitted closing costs or
 * furnishing are excluded from the totals; an omitted guest cleaning fee means
 * no cleaning-fee income is counted; an omitted down payment is modelled as all
 * cash. Each must appear as an assumption with its origin, never as a measured
 * $0 (canonical law 3 applied to arithmetic). The expected booked nights and
 * turnovers are also shown, as derived figures, because the cleaning cost is
 * multiplied by a count the operator never typed.
 *
 * It declares the `short_term_rental` vertical: a decision under that pack
 * counts only when it cites a scenario from this engine (evidence rule v2).
 * Lodging / occupancy tax is a guest pass-through and is not modelled.
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
  STR_ACQUISITION_ENGINE_ID,
  STR_ACQUISITION_ENGINE_VERSION,
  StrAcquisitionInputError,
  computeStrAcquisition,
} from "@shared/calculators/strAcquisition";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

/**
 * An expected count, to one decimal place, without a locale lookup: this text
 * is persisted in the scenario's assumptions, so it must not depend on the
 * machine that computed it. 252 → "252", 237.25 → "237.3".
 */
function count(n: number): string {
  return String(Number(n.toFixed(1)));
}

export const strAcquisitionEngine: EngineSpec = {
  id: STR_ACQUISITION_ENGINE_ID,
  version: STR_ACQUISITION_ENGINE_VERSION,
  label: "Short-term rental acquisition (nightly revenue, turnovers, NOI, cash flow, DSCR)",
  verticals: ["short_term_rental"],
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
  ],

  compute(inputs) {
    const normalised = {
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      furnishingCents: optionalCents(inputs, "furnishingCents"),
      averageDailyRateCents: requireCents(inputs, "averageDailyRateCents"),
      occupancyPct: requireNumber(inputs, "occupancyPct"),
      nightsAvailablePerYear: requireNumber(inputs, "nightsAvailablePerYear"),
      avgStayNights: requireNumber(inputs, "avgStayNights"),
      cleaningCostPerTurnoverCents: requireCents(inputs, "cleaningCostPerTurnoverCents"),
      cleaningFeePerStayCents: optionalCents(inputs, "cleaningFeePerStayCents"),
      platformFeePct: requireNumber(inputs, "platformFeePct"),
      managementPct: requireNumber(inputs, "managementPct"),
      monthlyFixedCostsCents: requireCents(inputs, "monthlyFixedCostsCents"),
      reservesPct: requireNumber(inputs, "reservesPct"),
      downPaymentPct: optionalNumber(inputs, "downPaymentPct"),
      interestRatePct: optionalNumber(inputs, "interestRatePct"),
      amortizationYears: optionalNumber(inputs, "amortizationYears"),
    };

    let out;
    try {
      out = computeStrAcquisition(normalised);
    } catch (err) {
      if (err instanceof StrAcquisitionInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [
      {
        key: "stay_volume",
        value: `${count(out.bookedNights)} booked nights, ${count(out.turnovers)} turnovers a year`,
        origin: "derived",
        basis:
          "Booked nights are nights available × occupancy; turnovers are booked nights ÷ average stay. " +
          "The cleaning cost (and any guest cleaning fee) is counted once per turnover.",
      },
    ];
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing cost was entered, so total cost and cash required leave it out. Enter your estimate before relying on them.",
      });
    }
    if (normalised.furnishingCents === null) {
      assumptions.push({
        key: "furnishing",
        value: "not entered — excluded",
        origin: "platform-default",
        basis:
          "No furnishing or setup cost was entered, so total cost and cash required leave it out, as if the property were bought ready to book. Enter your estimate before relying on them.",
      });
    }
    if (normalised.cleaningFeePerStayCents === null) {
      assumptions.push({
        key: "cleaning_fee_income",
        value: "none counted",
        origin: "platform-default",
        basis:
          "No guest cleaning fee was entered, so income is the nightly rate alone. The owner's cleaning cost per turnover is still counted. Enter the fee you charge per stay, if any.",
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

    // Persist what the arithmetic consumed. Loan terms on an all-cash purchase
    // were not used, so they are not recorded as inputs to it.
    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) {
      if (v === null) continue;
      if (!out.financed && (k === "interestRatePct" || k === "amortizationYears")) continue;
      wire[k] = v;
    }

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("total_cost", out.totalCostCents),
        // What it costs to TAKE IT DOWN (price + closing; furnishing comes after) — what Today asks at "Acquired".
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
      ],
    };
  },
};
