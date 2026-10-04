/**
 * The creative-finance wrap engine, pinned by hand-computed figures.
 *
 * Golden case A — take a $100,000 loan subject-to and resell on a wrap.
 *   Underlying: $100,000 at 3%, 300 months left, no payment entered.
 *   Acquisition: $25,000 cash to the seller, $3,000 closing, $7,000 repairs.
 *   Resale: $160,000, $10,000 down, wrap at 9% over 360 months, $30/month
 *   servicing, the buyer pays off in month 60.
 *
 *   outlay        = 25,000 + 3,000 + 7,000                       = $35,000
 *                   (cash_required = total_cost = $35,000)
 *   month 0       = 10,000 down − 35,000                          = −$25,000
 *   underlying    = 100,000 × 0.0025 ÷ (1 − 1.0025^−300)
 *     payment       1.0025^300 = 2.1150196, so 250 ÷ (1 − 0.4728090)
 *                 = 250 ÷ 0.5271910                               = $474.2112 → $474.21
 *   wrap principal= 160,000 − 10,000                              = $150,000
 *   wrap payment  = 150,000 × 0.0075 ÷ (1 − 1.0075^−360)
 *                   1.0075^360 = 14.7305761, so 1,125 ÷ (1 − 0.0678860)
 *                 = 1,125 ÷ 0.9321140                             = $1,206.934 → $1,206.93
 *   monthly spread= 1,206.93 − 474.21 − 30.00                     = $702.72
 *   month 60: everything owed on each note (that month's payment included),
 *     owed_60 = B × g − payment × (g − (1 + r)) ÷ r, with g = (1 + r)^60
 *     underlying  g = 1.0025^60 = 1.1616168; (g − 1.0025) ÷ 0.0025 = 63.646713
 *                 = 116,161.68 − 474.21 × 63.646713
 *                 = 116,161.68 − 30,181.91                        = $85,979.77
 *     wrap        g = 1.0075^60 = 1.5656810; (g − 1.0075) ÷ 0.0075 = 74.424137
 *                 = 234,852.15 − 1,206.93 × 74.424137
 *                 = 234,852.15 − 89,824.72                        = $145,027.43
 *     month 60    = 145,027.43 − 85,979.77 − 30.00                = $59,017.66
 *     (of which the balance spread after month 60's payments is
 *      (145,027.43 − 1,206.93) − (85,979.77 − 474.21) = $58,314.94)
 *   profit        = −25,000 + 59 × 702.72 + 59,017.66
 *                 = −25,000 + 41,460.48 + 59,017.66               = $75,478.14
 *   IRR           = the monthly m with NPV(m) = 0, as (1+m)^12 − 1 ≈ 50.95%
 *                   (m ≈ 3.4912%; solved numerically, and the test checks the
 *                   NPV at m is zero). A small net outlay and a large balance
 *                   spread make a high IRR; it is the result IF the inputs hold.
 *   hold          = 60 months
 *
 * Golden case B — zero rates, so every figure is exact.
 *   Underlying $120,000 at 0% over 120 months → $1,000 a month.
 *   $10,000 cash to seller, nothing else entered; resale $160,000 with $10,000
 *   down, wrap $150,000 at 0% over 100 months → $1,500 a month; payoff month 60.
 *   month 0       = 10,000 − 10,000                               = $0
 *                   → the down payment covers the outlay: IRR is null (declared)
 *   monthly spread= 1,500 − 1,000                                 = $500
 *   month 60      = wrap owed 150,000 − 59 × 1,500 = $61,500,
 *                   less underlying owed 120,000 − 59 × 1,000 = $61,000 = $500
 *   profit        = 0 + 60 × 500                                  = $30,000
 *                 = sale 160,000 − balance 120,000 − outlay 10,000 (at zero
 *                   rates every dollar of both notes is paid by month H)
 *
 * Identity — a wrap that mirrors the underlying exactly (same balance, rate and
 * term) earns no spread at all: profit is the down payment less the outlay.
 */
import { describe, expect, it } from "vitest";
import { computeCreativeWrap, type CreativeWrapInputs } from "../../shared/calculators/creativeWrap";
import { remainingBalanceCents } from "../../shared/calculators/finance";
import { computeIrr } from "../../shared/calculators/landDeal";
import { creativeWrapEngine } from "../../server/services/economics/engines/creativeWrap";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { CREATIVE_WRAP_FIELDS } from "../../shared/economics/fields/creativeWrap";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === creativeWrapEngine.id)).toEqual([creativeWrapEngine]);
});

const golden: CreativeWrapInputs = {
  underlyingBalanceCents: 10_000_000,
  underlyingRatePct: 3,
  underlyingRemainingMonths: 300,
  underlyingPaymentCents: null,
  cashToSellerCents: 2_500_000,
  closingCostsCents: 300_000,
  repairsCents: 700_000,
  salePriceCents: 16_000_000,
  buyerDownPaymentCents: 1_000_000,
  wrapRatePct: 9,
  wrapAmortizationMonths: 360,
  monthlyServicingCents: 3_000,
  horizonMonths: 60,
};

const zeroRate: CreativeWrapInputs = {
  underlyingBalanceCents: 12_000_000,
  underlyingRatePct: 0,
  underlyingRemainingMonths: 120,
  underlyingPaymentCents: null,
  cashToSellerCents: 1_000_000,
  closingCostsCents: null,
  repairsCents: null,
  salePriceCents: 16_000_000,
  buyerDownPaymentCents: 1_000_000,
  wrapRatePct: 0,
  wrapAmortizationMonths: 100,
  monthlyServicingCents: null,
  horizonMonths: 60,
};

function npvCents(flows: number[], monthly: number): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + monthly, t), 0);
}

describe("computeCreativeWrap — golden case A (subject-to, wrap at 9%, payoff in month 60)", () => {
  const o = computeCreativeWrap(golden);
  it("outlay and month 0", () => {
    expect(o.outlayCents).toBe(3_500_000);
    expect(o.cashFlowsCents).toHaveLength(61);
    expect(o.cashFlowsCents[0]).toBe(-2_500_000);
  });
  it("derives the underlying payment and the wrap payment from finance.ts", () => {
    expect(o.underlyingPaymentDerived).toBe(true);
    expect(o.underlyingPaymentCents).toBe(47_421);
    expect(o.wrapPrincipalCents).toBe(15_000_000);
    expect(o.wrapPaymentCents).toBe(120_693);
  });
  it("the monthly spread lands every month before the payoff", () => {
    expect(o.monthlySpreadCents).toBe(70_272);
    expect(o.cashFlowsCents[1]).toBe(70_272);
    expect(o.cashFlowsCents[59]).toBe(70_272);
  });
  it("month 60 adds the balance spread: both notes retired", () => {
    expect(o.underlyingPayoffCents).toBe(8_597_977);
    expect(o.wrapPayoffCents).toBe(14_502_743);
    expect(o.cashFlowsCents[60]).toBe(5_901_766);
    // The balance spread after month 60's regular payments.
    expect(o.wrapPayoffCents - o.wrapPaymentCents - (o.underlyingPayoffCents - o.underlyingPaymentCents)).toBe(5_831_494);
  });
  it("profit is the sum of every month's cash flow", () => {
    expect(o.profitCents).toBe(7_547_814);
    expect(o.profitCents).toBe(o.cashFlowsCents.reduce((s, c) => s + c, 0));
  });
  it("IRR is annualised from the monthly rate that zeroes the NPV", () => {
    expect(o.outlayCoveredByDown).toBe(false);
    expect(o.irr).toBeCloseTo(0.5095, 3);
    const monthly = Math.pow(1 + (o.irr as number), 1 / 12) - 1;
    expect(monthly).toBeCloseTo(0.034912, 5);
    expect(Math.abs(npvCents(o.cashFlowsCents, monthly))).toBeLessThan(1);
  });
  it("hold is the payoff month", () => {
    expect(o.horizonMonths).toBe(60);
    expect(o.underlyingPaidOffMonth).toBeNull();
  });
  it("with level payments, the walk agrees with finance.ts remainingBalanceCents", () => {
    // Balance after month 60's payment = owed at 60 − that payment. The
    // payments are rounded to the cent and remainingBalanceCents uses the
    // unrounded one, so they differ by the rounding compounded over 60 months
    // (under a dollar), not by a modelling difference.
    const under = o.underlyingPayoffCents - o.underlyingPaymentCents;
    const wrap = o.wrapPayoffCents - o.wrapPaymentCents;
    expect(Math.abs(under - remainingBalanceCents(10_000_000, 3, 25, 60))).toBeLessThanOrEqual(100);
    expect(Math.abs(wrap - remainingBalanceCents(15_000_000, 9, 30, 60))).toBeLessThanOrEqual(100);
  });
});

describe("computeCreativeWrap — golden case B (zero rates, exact)", () => {
  const o = computeCreativeWrap(zeroRate);
  it("payments, spread and payoffs", () => {
    expect(o.underlyingPaymentCents).toBe(100_000);
    expect(o.wrapPaymentCents).toBe(150_000);
    expect(o.monthlySpreadCents).toBe(50_000);
    expect(o.wrapPayoffCents).toBe(6_150_000);
    expect(o.underlyingPayoffCents).toBe(6_100_000);
    expect(o.cashFlowsCents[0]).toBe(0);
    expect(o.cashFlowsCents[60]).toBe(50_000);
  });
  it("profit is sale − balance − outlay, and the covered outlay has no IRR", () => {
    expect(o.profitCents).toBe(3_000_000);
    expect(o.outlayCoveredByDown).toBe(true);
    expect(o.irr).toBeNull();
  });
  it("a covered outlay is null even when the flows would yield a (meaningless) rate", () => {
    // Month 0 is +$15,000 and every later month is negative: computeIrr finds a
    // "rate" (a borrowing cost, about −20%), which is not a return on money the
    // investor put in. Null, not that number.
    const flows = computeCreativeWrap({
      ...golden,
      cashToSellerCents: 0,
      closingCostsCents: 0,
      repairsCents: 0,
      salePriceCents: 11_000_000,
      buyerDownPaymentCents: 1_500_000,
      wrapRatePct: 3,
    });
    expect(flows.cashFlowsCents[0]).toBe(1_500_000);
    expect(computeIrr(flows.cashFlowsCents)).not.toBeNull();
    expect(flows.outlayCoveredByDown).toBe(true);
    expect(flows.irr).toBeNull();
  });
  it("at zero rates the profit identity holds for any payoff month", () => {
    for (const h of [1, 12, 99, 100]) {
      expect(computeCreativeWrap({ ...zeroRate, horizonMonths: h }).profitCents).toBe(16_000_000 - 12_000_000 - 1_000_000);
    }
  });
});

describe("computeCreativeWrap — identities and edges", () => {
  it("a wrap that mirrors the underlying earns no spread: profit = down − outlay", () => {
    const o = computeCreativeWrap({
      ...golden,
      underlyingRatePct: 6,
      underlyingRemainingMonths: 360,
      wrapRatePct: 6,
      wrapAmortizationMonths: 360,
      salePriceCents: 12_000_000,
      buyerDownPaymentCents: 2_000_000,
      cashToSellerCents: 500_000,
      closingCostsCents: null,
      repairsCents: null,
      monthlyServicingCents: null,
      horizonMonths: 120,
    });
    expect(o.wrapPaymentCents).toBe(o.underlyingPaymentCents);
    expect(o.cashFlowsCents.slice(1).every((c) => c === 0)).toBe(true);
    expect(o.profitCents).toBe(1_500_000);
  });
  it("a negative spread is a result, not a refusal", () => {
    const o = computeCreativeWrap({ ...golden, wrapRatePct: 0, wrapAmortizationMonths: 360, salePriceCents: 2_000_000, buyerDownPaymentCents: 0 });
    expect(o.monthlySpreadCents).toBeLessThan(0);
    expect(o.monthlySpreadCents).toBe(Math.round(2_000_000 / 360) - 47_421 - 3_000);
  });
  it("a buyer who pays the whole price down leaves no wrap: the investor still carries the underlying", () => {
    const o = computeCreativeWrap({ ...golden, buyerDownPaymentCents: 16_000_000 });
    expect(o.wrapPrincipalCents).toBe(0);
    expect(o.wrapPaymentCents).toBe(0);
    expect(o.monthlySpreadCents).toBe(-47_421 - 3_000);
    expect(o.wrapPayoffCents).toBe(0);
  });
  it("an entered underlying payment larger than the level one pays the loan off early, and stops there", () => {
    const o = computeCreativeWrap({ ...golden, underlyingPaymentCents: 300_000 });
    expect(o.underlyingPaidOffMonth).toBe(35);
    expect(o.underlyingPayoffCents).toBe(0);
    // After the payoff month, only the wrap payment less servicing lands.
    expect(o.cashFlowsCents[40]).toBe(120_693 - 3_000);
  });
  it("an interest-only underlying keeps its balance: the payoff is the balance plus a month's interest", () => {
    const o = computeCreativeWrap({ ...golden, underlyingPaymentCents: 25_000 });
    expect(o.underlyingPayoffCents).toBe(10_025_000);
  });
});

describe("computeCreativeWrap — refusals (every bound)", () => {
  it("non-positive underlying balance or sale price", () => {
    expect(() => computeCreativeWrap({ ...golden, underlyingBalanceCents: 0 })).toThrow(/Underlying loan balance/);
    expect(() => computeCreativeWrap({ ...golden, salePriceCents: 0 })).toThrow(/Sale price/);
  });
  it("negative costs — a typo would flatter every return", () => {
    expect(() => computeCreativeWrap({ ...golden, cashToSellerCents: -1 })).toThrow(/cashToSellerCents/);
    expect(() => computeCreativeWrap({ ...golden, closingCostsCents: -1 })).toThrow(/closingCostsCents/);
    expect(() => computeCreativeWrap({ ...golden, repairsCents: -1 })).toThrow(/repairsCents/);
    expect(() => computeCreativeWrap({ ...golden, monthlyServicingCents: -1 })).toThrow(/monthlyServicingCents/);
    expect(() => computeCreativeWrap({ ...golden, cashToSellerCents: 0 })).not.toThrow();
  });
  it("down payment below zero or above the sale price", () => {
    expect(() => computeCreativeWrap({ ...golden, buyerDownPaymentCents: -1 })).toThrow(/down payment/);
    expect(() => computeCreativeWrap({ ...golden, buyerDownPaymentCents: 16_000_001 })).toThrow(/more than the sale price/);
    expect(() => computeCreativeWrap({ ...golden, buyerDownPaymentCents: 0 })).not.toThrow();
  });
  it("either rate outside 0–30%", () => {
    expect(() => computeCreativeWrap({ ...golden, underlyingRatePct: -0.1 })).toThrow(/Underlying loan rate/);
    expect(() => computeCreativeWrap({ ...golden, underlyingRatePct: 30.1 })).toThrow(/Underlying loan rate/);
    expect(() => computeCreativeWrap({ ...golden, underlyingRatePct: 30 })).not.toThrow();
    expect(() => computeCreativeWrap({ ...golden, wrapRatePct: -0.1 })).toThrow(/Wrap rate/);
    expect(() => computeCreativeWrap({ ...golden, wrapRatePct: 30.1 })).toThrow(/Wrap rate/);
    expect(() => computeCreativeWrap({ ...golden, wrapRatePct: 30 })).not.toThrow();
  });
  it("either term not a whole month from 1 to 480", () => {
    expect(() => computeCreativeWrap({ ...golden, underlyingRemainingMonths: 0 })).toThrow(/Underlying remaining term/);
    expect(() => computeCreativeWrap({ ...golden, underlyingRemainingMonths: 481 })).toThrow(/Underlying remaining term/);
    expect(() => computeCreativeWrap({ ...golden, underlyingRemainingMonths: 300.5 })).toThrow(/Underlying remaining term/);
    expect(() => computeCreativeWrap({ ...golden, underlyingRemainingMonths: 1, horizonMonths: 1 })).not.toThrow();
    expect(() => computeCreativeWrap({ ...golden, wrapAmortizationMonths: 0 })).toThrow(/Wrap amortization/);
    expect(() => computeCreativeWrap({ ...golden, wrapAmortizationMonths: 481 })).toThrow(/Wrap amortization/);
    expect(() => computeCreativeWrap({ ...golden, wrapAmortizationMonths: 360.5 })).toThrow(/Wrap amortization/);
    expect(() => computeCreativeWrap({ ...golden, wrapAmortizationMonths: 480 })).not.toThrow();
  });
  it("payoff month not a whole month from 1 to the shorter term", () => {
    expect(() => computeCreativeWrap({ ...golden, horizonMonths: 0 })).toThrow(/Payoff month/);
    expect(() => computeCreativeWrap({ ...golden, horizonMonths: 12.5 })).toThrow(/Payoff month/);
    // Shorter of 300 (underlying) and 360 (wrap) is 300.
    expect(() => computeCreativeWrap({ ...golden, horizonMonths: 301 })).toThrow(/1 to 300/);
    expect(() => computeCreativeWrap({ ...golden, horizonMonths: 300 })).not.toThrow();
    expect(() => computeCreativeWrap({ ...golden, wrapAmortizationMonths: 240, horizonMonths: 241 })).toThrow(/1 to 240/);
    expect(() => computeCreativeWrap({ ...golden, horizonMonths: 1 })).not.toThrow();
  });
  it("a non-positive underlying payment, or one below its interest (the balance would grow)", () => {
    expect(() => computeCreativeWrap({ ...golden, underlyingPaymentCents: 0 })).toThrow(/Underlying monthly payment must be positive/);
    // First month's interest on $100,000 at 3% is $250.00.
    expect(() => computeCreativeWrap({ ...golden, underlyingPaymentCents: 24_999 })).toThrow(/interest/);
    expect(() => computeCreativeWrap({ ...golden, underlyingPaymentCents: 25_000 })).not.toThrow();
  });
  it("a wrap rate and amortization whose payment does not exceed its interest (negative amortization)", () => {
    // $10,000 at 30% over 480 months: interest is $250.00 a month, the level
    // payment is $250.0018, which rounds to $250.00 — interest only, forever.
    const wrapOnly = { ...golden, buyerDownPaymentCents: 0, cashToSellerCents: 0, wrapRatePct: 30, wrapAmortizationMonths: 480 };
    expect(() => computeCreativeWrap({ ...wrapOnly, salePriceCents: 1_000_000 })).toThrow(/never come down/);
    // $100,000 at the same terms: the payment rounds to $2,500.02 and amortizes.
    expect(() => computeCreativeWrap({ ...wrapOnly, salePriceCents: 10_000_000 })).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    underlyingBalanceCents: 10_000_000,
    underlyingRatePct: 3,
    underlyingRemainingMonths: 300,
    cashToSellerCents: 2_500_000,
    salePriceCents: 16_000_000,
    buyerDownPaymentCents: 1_000_000,
    wrapRatePct: 9,
    wrapAmortizationMonths: 360,
    horizonMonths: 60,
  };
  const run = (inputs: Record<string, number | string>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "creative_wrap", inputs }, ENGINES);

  it("declares creative_finance and its version", () => {
    expect(creativeWrapEngine.id).toBe("creative_wrap");
    expect(creativeWrapEngine.version).toBe("creative-wrap-1");
    expect(creativeWrapEngine.verticals).toEqual(["creative_finance"]);
  });

  it("produces only registered metrics, including total_cost and profit for the outcome prompt", () => {
    for (const id of creativeWrapEngine.produces) expect(metricById(id), id).toBeDefined();
    expect(creativeWrapEngine.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
    // Deliberately not produced: a simple annualised return misstates a wrap.
    expect(creativeWrapEngine.produces).not.toContain("annualized_return");
  });

  it("emits every metric it declares, in its registered unit", () => {
    const body = run({ ...wire, closingCostsCents: 300_000, repairsCents: 700_000, monthlyServicingCents: 3_000 });
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...creativeWrapEngine.produces].sort());
    const by = (id: string) => body.metrics.find((m) => m.id === id)!;
    expect(by("cash_required")).toEqual({ id: "cash_required", value: 3_500_000, unit: "cents" });
    expect(by("total_cost")).toEqual({ id: "total_cost", value: 3_500_000, unit: "cents" });
    expect(by("monthly_cash_flow")).toEqual({ id: "monthly_cash_flow", value: 70_272, unit: "cents" });
    expect(by("profit")).toEqual({ id: "profit", value: 7_547_814, unit: "cents" });
    expect(by("irr").unit).toBe("ratio");
    expect(by("irr").value).toBeCloseTo(0.5095, 3);
    expect(by("hold_months")).toEqual({ id: "hold_months", value: 60, unit: "months" });
    expect(body.assumptions.map((a) => a.key)).toEqual(["underlying_payment"]);
  });

  it("declares each absent optional input — never a silent $0 or a silent payment", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["closing_costs", "repairs", "servicing", "underlying_payment"]);
    const by = (k: string) => body.assumptions.find((a) => a.key === k)!;
    expect(by("closing_costs").origin).toBe("platform-default");
    expect(by("repairs").origin).toBe("platform-default");
    expect(by("servicing").origin).toBe("platform-default");
    expect(by("underlying_payment").origin).toBe("derived");
    expect(by("underlying_payment").value).toBe("$474.21 a month");
    // Derived and excluded values are the engine's, not inputs the operator gave.
    for (const k of ["underlyingPaymentCents", "closingCostsCents", "repairsCents", "monthlyServicingCents"]) {
      expect(body.inputs).not.toHaveProperty(k);
    }
  });

  it("the operator's own answers are not declared as defaults", () => {
    const body = run({ ...wire, closingCostsCents: 0, repairsCents: 0, monthlyServicingCents: 0, underlyingPaymentCents: 47_421 });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toMatchObject({ closingCostsCents: 0, repairsCents: 0, monthlyServicingCents: 0, underlyingPaymentCents: 47_421 });
  });

  it("a down payment that covers the outlay leaves IRR null, and says why", () => {
    const body = run({ ...wire, cashToSellerCents: 0, closingCostsCents: 0, repairsCents: 0, monthlyServicingCents: 3_000, underlyingPaymentCents: 47_421, salePriceCents: 11_000_000, buyerDownPaymentCents: 1_500_000, wrapRatePct: 3 });
    expect(body.metrics.find((m) => m.id === "irr")).toEqual({ id: "irr", value: null, unit: "ratio" });
    expect(body.assumptions.map((a) => a.key)).toEqual(["irr"]);
    const irr = body.assumptions[0];
    expect(irr.origin).toBe("derived");
    expect(irr.basis).toContain("$15,000.00");
    expect(irr.basis).toContain("($0.00)");
  });

  it("an entered underlying payment that retires the loan before the payoff month says so", () => {
    const body = run({ ...wire, closingCostsCents: 0, repairsCents: 0, monthlyServicingCents: 0, underlyingPaymentCents: 300_000 });
    expect(body.assumptions.map((a) => a.key)).toEqual(["underlying_early_payoff"]);
    expect(body.assumptions[0].value).toBe("paid off in month 35");
    expect(body.assumptions[0].basis).toContain("$3,000.00");
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, wrapRatePct: 45 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, horizonMonths: 400 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, wrapAmortizationMonths: 12.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, salePriceCents: 1.5 })).toThrow(/integer/);
    expect(() => run({ ...wire, underlyingPaymentCents: 100 })).toThrow(ScenarioEngineError);
    // The payoff month is required, never defaulted.
    const { horizonMonths: _h, ...noHorizon } = wire;
    expect(() => run(noHorizon)).toThrow(/horizonMonths/);
  });

  it("the form asks for every input the engine reads, with the optional ones optional", () => {
    const keys = CREATIVE_WRAP_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual([
      "buyerDownPaymentCents",
      "cashToSellerCents",
      "closingCostsCents",
      "horizonMonths",
      "monthlyServicingCents",
      "repairsCents",
      "salePriceCents",
      "underlyingBalanceCents",
      "underlyingPaymentCents",
      "underlyingRatePct",
      "underlyingRemainingMonths",
      "wrapAmortizationMonths",
      "wrapRatePct",
    ]);
    const optional = CREATIVE_WRAP_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(["closingCostsCents", "monthlyServicingCents", "repairsCents", "underlyingPaymentCents"]);
    expect(CREATIVE_WRAP_FIELDS.find((f) => f.key === "horizonMonths")?.optional).toBeUndefined();
  });
});
