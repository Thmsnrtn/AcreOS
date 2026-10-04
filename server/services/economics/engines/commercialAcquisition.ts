/**
 * The commercial acquisition engine: the registered adapter over
 * shared/calculators/commercialAcquisition.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently. Omitted expense recoveries, other
 * income, closing costs and TI/LC/capex are excluded from the totals; an
 * omitted down payment is modelled as all cash; an omitted market cap rate
 * means no value at market is computed. Each must appear as an assumption with
 * its origin, never as a measured $0 (canonical law 3 applied to arithmetic).
 *
 * It declares the `commercial` vertical: a decision under that pack counts
 * only when it cites a scenario from this engine (evidence rule v2). The older
 * `multifamily_noi` engine has a "commercial" structure class, but it values a
 * building already operated against a valuation; it has no price, financing or
 * cash required, so it cannot carry a buy call and declares no vertical.
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
  COMMERCIAL_ACQUISITION_ENGINE_ID,
  COMMERCIAL_ACQUISITION_ENGINE_VERSION,
  CommercialAcquisitionInputError,
  computeCommercialAcquisition,
} from "@shared/calculators/commercialAcquisition";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

function usd(cents: number): string {
  // Deterministic, no locale lookup: this text is persisted in the scenario's
  // assumptions, and a locale-dependent string would make the frozen record
  // depend on the machine that computed it.
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export const commercialAcquisitionEngine: EngineSpec = {
  id: COMMERCIAL_ACQUISITION_ENGINE_ID,
  version: COMMERCIAL_ACQUISITION_ENGINE_VERSION,
  label: "Commercial acquisition (NOI with recoveries, cash flow, DSCR, value at market cap)",
  verticals: ["commercial"],
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
    "stabilized_value",
  ],

  compute(inputs) {
    const normalised = {
      rentableSqft: requireNumber(inputs, "rentableSqft"),
      annualBaseRentCents: requireCents(inputs, "annualBaseRentCents"),
      annualRecoveriesCents: optionalCents(inputs, "annualRecoveriesCents"),
      otherAnnualIncomeCents: optionalCents(inputs, "otherAnnualIncomeCents"),
      vacancyPct: requireNumber(inputs, "vacancyPct"),
      annualOperatingExpensesCents: requireCents(inputs, "annualOperatingExpensesCents"),
      managementPct: requireNumber(inputs, "managementPct"),
      annualReservesCents: requireCents(inputs, "annualReservesCents"),
      tiLcCapexCents: optionalCents(inputs, "tiLcCapexCents"),
      purchasePriceCents: requireCents(inputs, "purchasePriceCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      downPaymentPct: optionalNumber(inputs, "downPaymentPct"),
      interestRatePct: optionalNumber(inputs, "interestRatePct"),
      amortizationYears: optionalNumber(inputs, "amortizationYears"),
      marketCapRatePct: optionalNumber(inputs, "marketCapRatePct"),
    };

    let out;
    try {
      out = computeCommercialAcquisition(normalised);
    } catch (err) {
      if (err instanceof CommercialAcquisitionInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (normalised.annualRecoveriesCents === null) {
      assumptions.push({
        key: "expense_recoveries",
        value: "none counted",
        origin: "platform-default",
        basis: "No expense recoveries were entered, so the leases are modelled as recovering nothing from tenants, as a gross lease would. Under triple-net, modified-gross or CAM leases, enter what tenants are actually billed each year.",
      });
    }
    if (normalised.otherAnnualIncomeCents === null) {
      assumptions.push({
        key: "other_income",
        value: "none counted",
        origin: "platform-default",
        basis: "No other income was entered, so parking, signage and similar income are left out. Enter what the building actually collects, if anything.",
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
    if (normalised.tiLcCapexCents === null) {
      assumptions.push({
        key: "ti_lc_capex",
        value: "none budgeted",
        origin: "platform-default",
        basis: "No tenant improvements, leasing commissions or immediate capex were entered, so the building is treated as needing none at purchase. Vacant suites and expiring leases usually do; enter the budget if they apply.",
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
        basis: "No market cap rate was entered, so the building's value at market is not computed. Enter the cap rate comparable buildings trade at to see it.",
      });
    } else if (out.stabilizedValueCents === null) {
      assumptions.push({
        key: "value_at_market",
        value: "not computed — NOI is not positive",
        origin: "derived",
        basis: `NOI comes to ${usd(out.annualNoiCents)} a year before debt service, so dividing it by a cap rate gives no meaningful value.`,
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
