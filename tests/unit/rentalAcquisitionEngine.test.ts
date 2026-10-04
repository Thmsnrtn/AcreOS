/**
 * The buy-and-hold acquisition engine, pinned by hand-computed figures.
 *
 * Golden case: $200,000 price, $4,000 closing, $10,000 rehab, $2,000/mo rent,
 * 5% vacancy, $500/mo fixed costs, 8% management, 10% reserves, 25% down,
 * 7% interest, 30-year amortization.
 *   total cost   = 200,000 + 4,000 + 10,000          = $214,000
 *   cash req'd   = 50,000 down + 4,000 + 10,000      = $64,000
 *   EGI          = 24,000 × 0.95                     = $22,800
 *   opex         = 6,000 fixed + 22,800 × 18%        = $10,104
 *   NOI          = 22,800 − 10,104                   = $12,696
 *   payment      = $150,000 @ 7% / 30y               = $997.95/mo → $11,975.40/yr
 *   cash flow    = 12,696 − 11,975.40                = $720.60/yr → $60.05/mo
 *   cap rate     = 12,696 / 200,000                  = 6.348%
 *   CoC          = 720.60 / 64,000                   = 1.1259375%
 *   DSCR         = 12,696 / 11,975.40                ≈ 1.0602
 *   OER          = 10,104 / 22,800                   ≈ 44.32%
 *   GRM          = 200,000 / 24,000                  ≈ 8.33
 */
import { describe, expect, it } from "vitest";
import { computeRentalAcquisition, type RentalAcquisitionInputs } from "../../shared/calculators/rentalAcquisition";
import { monthlyPaymentCents, remainingBalanceCents } from "../../shared/calculators/finance";
import { rentalAcquisitionEngine } from "../../server/services/economics/engines/rentalAcquisition";
import { computeScenario, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";

const golden: RentalAcquisitionInputs = {
  purchasePriceCents: 20_000_000,
  closingCostsCents: 400_000,
  rehabCents: 1_000_000,
  monthlyRentCents: 200_000,
  vacancyPct: 5,
  monthlyFixedExpensesCents: 50_000,
  managementPct: 8,
  reservesPct: 10,
  downPaymentPct: 25,
  interestRatePct: 7,
  amortizationYears: 30,
};

describe("loan arithmetic", () => {
  it("$150,000 at 7% over 30 years is $997.95 a month", () => {
    expect(monthlyPaymentCents(15_000_000, 7, 30)).toBe(99_795);
  });
  it("a zero rate is straight-line", () => {
    expect(monthlyPaymentCents(1_200_000, 0, 1)).toBe(100_000);
  });
  it("the balance is the principal before any payment and zero at term", () => {
    expect(remainingBalanceCents(15_000_000, 7, 30, 0)).toBe(15_000_000);
    expect(remainingBalanceCents(15_000_000, 7, 30, 360)).toBe(0);
  });
  it("after 5 years of a 30-year 7% loan, about 94% of $150,000 remains", () => {
    const b = remainingBalanceCents(15_000_000, 7, 30, 60);
    expect(b).toBeGreaterThan(14_100_000);
    expect(b).toBeLessThan(14_200_000);
  });
});

describe("computeRentalAcquisition — golden case", () => {
  const o = computeRentalAcquisition(golden);
  it("costs and cash", () => {
    expect(o.totalCostCents).toBe(21_400_000);
    expect(o.cashRequiredCents).toBe(6_400_000);
  });
  it("income, expense and NOI", () => {
    expect(o.effectiveGrossIncomeCents).toBe(2_280_000);
    expect(o.annualOperatingExpenseCents).toBe(1_010_400);
    expect(o.annualNoiCents).toBe(1_269_600);
  });
  it("debt and cash flow", () => {
    expect(o.annualDebtServiceCents).toBe(1_197_540);
    expect(o.monthlyCashFlowCents).toBe(6_005);
  });
  it("ratios", () => {
    expect(o.capRate).toBeCloseTo(0.06348, 6);
    expect(o.cashOnCash).toBeCloseTo(0.011259375, 8);
    expect(o.dscr).toBeCloseTo(1.06017, 4);
    expect(o.operatingExpenseRatio).toBeCloseTo(0.443158, 5);
    expect(o.grossRentMultiplier).toBeCloseTo(8.3333, 4);
  });
});

describe("computeRentalAcquisition — the honest edges", () => {
  it("all cash: no debt service, no DSCR, cash required is price + costs", () => {
    const o = computeRentalAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(21_400_000);
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeRentalAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
  });
  it("out-of-range percentages are refused", () => {
    expect(() => computeRentalAcquisition({ ...golden, vacancyPct: 120 })).toThrow(/vacancyPct/);
  });
  it("negative costs are refused — a typo would flatter every return", () => {
    expect(() => computeRentalAcquisition({ ...golden, closingCostsCents: -1 })).toThrow(/closingCostsCents/);
    expect(() => computeRentalAcquisition({ ...golden, rehabCents: -1 })).toThrow(/rehabCents/);
    expect(() => computeRentalAcquisition({ ...golden, monthlyFixedExpensesCents: -1 })).toThrow(/monthlyFixedExpensesCents/);
  });
  it("loan terms outside any real loan are refused", () => {
    expect(() => computeRentalAcquisition({ ...golden, interestRatePct: 31 })).toThrow(/Interest rate/);
    expect(() => computeRentalAcquisition({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeRentalAcquisition({ ...golden, amortizationYears: 0 })).toThrow(/Amortization/);
    expect(() => computeRentalAcquisition({ ...golden, amortizationYears: 41 })).toThrow(/Amortization/);
    expect(() => computeRentalAcquisition({ ...golden, amortizationYears: 29.5 })).toThrow(/Amortization/);
  });
  it("loan terms typed without a down payment are refused, not silently dropped", () => {
    expect(() => computeRentalAcquisition({ ...golden, downPaymentPct: null })).toThrow(/without a down payment/);
  });
  it("100% down is all cash by the operator's own answer", () => {
    const o = computeRentalAcquisition({ ...golden, downPaymentPct: 100, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(21_400_000);
  });
  it("zero rent: GRM is undefined, not a number", () => {
    expect(computeRentalAcquisition({ ...golden, monthlyRentCents: 0 }).grossRentMultiplier).toBeNull();
  });
});

describe("the registered engine", () => {
  const wire = {
    purchasePriceCents: 20_000_000,
    monthlyRentCents: 200_000,
    vacancyPct: 5,
    monthlyFixedExpensesCents: 50_000,
    managementPct: 8,
    reservesPct: 10,
  };

  it("is in the registry and declares buy_and_hold", () => {
    expect(ALL_ENGINES.find((e) => e.id === "rental_acquisition")).toBe(rentalAcquisitionEngine);
    expect(rentalAcquisitionEngine.verticals).toEqual(["buy_and_hold"]);
  });

  it("emits every metric it declares, and predicts total_cost so an outcome can grade it", () => {
    const body = computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "rental_acquisition", inputs: wire }, ALL_ENGINES);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...rentalAcquisitionEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(20_000_000);
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "rental_acquisition", inputs: wire }, ALL_ENGINES);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["closing_costs", "financing", "rehab"]);
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
  });

  it("100% down is the operator's answer, so no financing default is declared", () => {
    // The audit of V0 found the adapter keyed this on `financed`, so a 100%
    // down payment was described as "No down payment was entered".
    const body = computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "rental_acquisition", inputs: { ...wire, downPaymentPct: 100 } }, ALL_ENGINES);
    expect(body.assumptions.map((a) => a.key)).not.toContain("financing");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "rental_acquisition", inputs: { ...wire, vacancyPct: 150 } }, ALL_ENGINES)).toThrow(ScenarioEngineError);
    expect(() => computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "rental_acquisition", inputs: { ...wire, purchasePriceCents: 1.5 } }, ALL_ENGINES)).toThrow(/integer/);
  });
});
