/**
 * The creative-finance wrap engine: the registered adapter over
 * shared/calculators/creativeWrap.ts.
 *
 * The adapter's job is the boundary. It validates the wire inputs, maps the
 * calculator's outputs onto the shared metric vocabulary, and DECLARES every
 * substitution the calculator made silently:
 *   - omitted closing costs, repairs and servicing are excluded (platform
 *     default) — never a measured $0;
 *   - an omitted underlying payment is replaced by the derived level payment
 *     (derived);
 * and the consequences the arithmetic found, so a figure built on them cannot
 * read as a clean one: an IRR that is not a number because the buyer's down
 * payment covers the whole outlay, and an entered underlying payment that
 * retires the loan before the payoff month.
 *
 * total_cost and cash_required are the same figure here — the investor's cost
 * to take the deal down (cash to seller + closing + repairs), before the end
 * buyer's down payment comes back. That is what the Today outcome prompt
 * measures against.
 *
 * It declares the `creative_finance` vertical: a decision under that pack
 * counts only when it cites a scenario from this engine (evidence rule v2).
 * ARITHMETIC ONLY: no compliance verdict on originating the wrap, and nothing
 * here collects, holds or disburses a payment.
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
  CREATIVE_WRAP_ENGINE_ID,
  CREATIVE_WRAP_ENGINE_VERSION,
  CreativeWrapInputError,
  computeCreativeWrap,
} from "@shared/calculators/creativeWrap";

function usd(cents: number): string {
  // Deterministic, no locale lookup: this text is persisted in the scenario's
  // assumptions, and a locale-dependent string would make the frozen record
  // depend on the machine that computed it.
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export const creativeWrapEngine: EngineSpec = {
  id: CREATIVE_WRAP_ENGINE_ID,
  version: CREATIVE_WRAP_ENGINE_VERSION,
  label: "Creative-finance wrap (payment spread, balance spread, return if the buyer pays to the payoff month)",
  verticals: ["creative_finance"],
  produces: ["cash_required", "total_cost", "acquisition_cost", "monthly_cash_flow", "profit", "irr", "hold_months"],

  compute(inputs) {
    const normalised = {
      underlyingBalanceCents: requireCents(inputs, "underlyingBalanceCents"),
      underlyingRatePct: requireNumber(inputs, "underlyingRatePct"),
      underlyingRemainingMonths: requireNumber(inputs, "underlyingRemainingMonths"),
      underlyingPaymentCents: optionalCents(inputs, "underlyingPaymentCents"),
      cashToSellerCents: requireCents(inputs, "cashToSellerCents"),
      closingCostsCents: optionalCents(inputs, "closingCostsCents"),
      repairsCents: optionalCents(inputs, "repairsCents"),
      salePriceCents: requireCents(inputs, "salePriceCents"),
      buyerDownPaymentCents: requireCents(inputs, "buyerDownPaymentCents"),
      wrapRatePct: requireNumber(inputs, "wrapRatePct"),
      wrapAmortizationMonths: requireNumber(inputs, "wrapAmortizationMonths"),
      monthlyServicingCents: optionalCents(inputs, "monthlyServicingCents"),
      horizonMonths: requireNumber(inputs, "horizonMonths"),
    };

    let out;
    try {
      out = computeCreativeWrap(normalised);
    } catch (err) {
      if (err instanceof CreativeWrapInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const assumptions: ScenarioAssumption[] = [];
    if (out.underlyingPaymentDerived) {
      assumptions.push({
        key: "underlying_payment",
        value: `${usd(out.underlyingPaymentCents)} a month`,
        origin: "derived",
        basis: "No underlying payment was entered, so the level payment that pays off this balance at its rate over its remaining months is used. Enter the principal-and-interest payment on the loan statement if it differs",
      });
    }
    if (normalised.closingCostsCents === null) {
      assumptions.push({
        key: "closing_costs",
        value: "not entered — excluded",
        origin: "platform-default",
        basis: "No closing or acquisition cost was entered, so total cost, cash required, profit and IRR leave it out. Enter title, escrow, legal and recording costs before relying on them",
      });
    }
    if (normalised.repairsCents === null) {
      assumptions.push({
        key: "repairs",
        value: "none budgeted",
        origin: "platform-default",
        basis: "No repair cost was entered, so the property is treated as resold without repairs. Enter your repair budget if it needs work before resale",
      });
    }
    if (normalised.monthlyServicingCents === null) {
      assumptions.push({
        key: "servicing",
        value: "none counted",
        origin: "platform-default",
        basis: "No monthly servicing cost was entered, so the monthly spread and profit leave it out. Enter what your loan servicer charges you each month, if anything",
      });
    }
    if (out.outlayCoveredByDown) {
      assumptions.push({
        key: "irr",
        value: "not computed — the down payment covers your outlay",
        origin: "derived",
        basis: `The buyer's down payment (${usd(normalised.buyerDownPaymentCents)}) covers everything you pay at the start (${usd(out.outlayCents)}), so none of your own money is at work and a yield on it is not a number. Read profit and the monthly spread instead`,
      });
    } else if (out.irr === null) {
      assumptions.push({
        key: "irr",
        value: "not computed — no rate fits these cash flows",
        origin: "derived",
        basis: "No discount rate makes these cash flows sum to zero (for example, nothing ever comes back to cover the outlay), so there is no IRR. Read profit instead",
      });
    }
    if (out.underlyingPaidOffMonth !== null) {
      assumptions.push({
        key: "underlying_early_payoff",
        value: `paid off in month ${out.underlyingPaidOffMonth}`,
        origin: "derived",
        basis: `At ${usd(out.underlyingPaymentCents)} a month the underlying loan is paid off before month ${normalised.horizonMonths}, so its payments stop there. Check the payment and remaining months`,
      });
    }

    const wire: Record<string, number> = {};
    for (const [k, v] of Object.entries(normalised)) if (v !== null) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("cash_required", out.outlayCents),
        metric("total_cost", out.outlayCents),
        // What it costs to TAKE IT DOWN (cash to seller + closing; repairs come after) — what Today asks at "Acquired".
        metric("acquisition_cost", normalised.cashToSellerCents + (normalised.closingCostsCents ?? 0)),
        metric("monthly_cash_flow", out.monthlySpreadCents),
        metric("profit", out.profitCents),
        metric("irr", out.irr),
        metric("hold_months", out.horizonMonths),
      ],
    };
  },
};
