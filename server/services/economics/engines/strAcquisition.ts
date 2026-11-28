/**
 * The short-term-rental acquisition/hold engine: the registered adapter
 * over shared/calculators/strAcquisition.ts.
 *
 * It declares the `short_term_rental` vertical: a decision under that pack
 * counts only when it cites a scenario from this engine (evidence rule v2).
 * Before this engine, STR was surfaced-only — strMetrics/stayPnl in
 * shared/rental are honest pure engines, but they are not registered
 * scenario engines and cite no scenario, so no STR decision could be
 * gradeable (Step-0 gap sheet short_term_rental.md, bar (b), work item 1).
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES the
 * provenance of every revenue assumption: ADR, occupancy, fees, cleaning
 * and platform fee are the OPERATOR's entered figures (origin "user"),
 * never market data. There is no market-ADR/comps source behind this
 * engine — the residential-comps hard-stop stands — and every required
 * input is refused when absent rather than defaulted.
 *
 * Gradeability is built in from the start: the output is an ordinary
 * Scenario (engine id + version, verbatim normalised inputs, declared
 * assumptions, registered metrics), so a decision desk can freeze a
 * decision_snapshot citing it with a review date, and an Outcome can grade
 * it later. No new table — scenarios persist via the existing scenario
 * store, exactly like the other engines.
 */
import {
  ScenarioEngineError,
  metric,
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

export const strAcquisitionEngine: EngineSpec = {
  id: STR_ACQUISITION_ENGINE_ID,
  version: STR_ACQUISITION_ENGINE_VERSION,
  label: "Short-term rental acquisition/hold (NOI, cash flow, cash-on-cash, DSCR)",
  verticals: ["short_term_rental"],
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
      closingCostsCents: requireCents(inputs, "closingCostsCents"),
      adrCents: requireCents(inputs, "adrCents"),
      occupancyPct: requireNumber(inputs, "occupancyPct"),
      guestFeesPerStayCents: requireCents(inputs, "guestFeesPerStayCents"),
      cleaningCostPerStayCents: requireCents(inputs, "cleaningCostPerStayCents"),
      platformFeePct: requireNumber(inputs, "platformFeePct"),
      averageStayNights: requireNumber(inputs, "averageStayNights"),
      annualFixedExpensesCents: requireCents(inputs, "annualFixedExpensesCents"),
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

    // Every revenue/cost assumption is the operator's own entered figure.
    // Declaring that here — with origin "user" — is what keeps a later
    // reader from mistaking an entered ADR for a measured market rate, and
    // states the fence in the record itself: no market data was consulted.
    const assumptions: ScenarioAssumption[] = [
      {
        key: "adr",
        value: normalised.adrCents,
        unit: "cents per booked night",
        origin: "user",
        basis: "Operator-entered average daily rate. No market ADR or comps source exists behind this engine and none was consulted.",
      },
      {
        key: "occupancy",
        value: normalised.occupancyPct,
        unit: "percent of 365 nights",
        origin: "user",
        basis: "Operator-entered occupancy assumption, not a measured trailing occupancy.",
      },
      {
        key: "platform_fee",
        value: normalised.platformFeePct,
        unit: "percent of gross room revenue",
        origin: "user",
        basis: "Operator-entered platform/channel fee, applied to gross room revenue only (guest fees excluded).",
      },
    ];
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
