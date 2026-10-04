/**
 * The multifamily acquisition engine, pinned by hand-computed figures.
 *
 * Golden case: 24 units at $1,200/mo average rent, $1,000/mo other income,
 * 6% vacancy, $90,000/yr operating expenses, 5% management, $300/unit/yr
 * reserves, $2,400,000 price, $48,000 closing, $60,000 immediate capex,
 * 25% down, 6.5% interest, 30-year amortization, 6.5% market cap rate.
 *   gross sched. rent = 24 × 1,200 × 12                 = $345,600
 *   other income      = 1,000 × 12                      = $12,000
 *   GPI               = 345,600 + 12,000                = $357,600
 *   EGI               = 357,600 × 0.94                  = $336,144
 *   management        = 336,144 × 5%                    = $16,807.20
 *   reserves          = 300 × 24                        = $7,200
 *   opex              = 90,000 + 16,807.20 + 7,200      = $114,007.20
 *   NOI               = 336,144 − 114,007.20            = $222,136.80
 *   total cost        = 2,400,000 + 48,000 + 60,000     = $2,508,000
 *   cash req'd        = 600,000 down + 48,000 + 60,000  = $708,000
 *   loan              = 2,400,000 × 75%                 = $1,800,000
 *   payment           = $1,800,000 @ 6.5% / 30y: the level-payment factor is
 *                       r / (1 − (1 + r)^−360), r = 0.065/12, = 0.0063206802
 *                       per dollar → $11,377.2244 → $11,377.22/mo
 *   debt service      = 11,377.22 × 12                  = $136,526.64
 *   cash flow         = 222,136.80 − 136,526.64         = $85,610.16/yr
 *                       ÷ 12 = 7,134.18                 = $7,134.18/mo
 *   cap rate          = 222,136.80 / 2,400,000          = 9.2557%
 *   CoC               = 85,610.16 / 708,000             ≈ 12.0918%
 *   DSCR              = 222,136.80 / 136,526.64         ≈ 1.6271×
 *   OER               = 114,007.20 / 336,144            ≈ 33.916%
 *   GRM               = 2,400,000 / 345,600             ≈ 6.9444×
 *   value at market   = 222,136.80 / 0.065              = $3,417,489.23
 */
import { describe, expect, it } from "vitest";
import {
  computeMultifamilyAcquisition,
  type MultifamilyAcquisitionInputs,
} from "../../shared/calculators/multifamilyAcquisition";
import { monthlyPaymentCents } from "../../shared/calculators/finance";
import { multifamilyAcquisitionEngine } from "../../server/services/economics/engines/multifamilyAcquisition";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { MULTIFAMILY_ACQUISITION_FIELDS } from "../../shared/economics/fields/multifamilyAcquisition";


// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine that is not in it cannot
// underwrite anything in production.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === multifamilyAcquisitionEngine.id)).toEqual([multifamilyAcquisitionEngine]);
});

const golden: MultifamilyAcquisitionInputs = {
  unitCount: 24,
  avgMonthlyRentPerUnitCents: 120_000,
  otherMonthlyIncomeCents: 100_000,
  vacancyPct: 6,
  annualOperatingExpensesCents: 9_000_000,
  managementPct: 5,
  reservesPerUnitPerYearCents: 30_000,
  purchasePriceCents: 240_000_000,
  closingCostsCents: 4_800_000,
  capexCents: 6_000_000,
  downPaymentPct: 25,
  interestRatePct: 6.5,
  amortizationYears: 30,
  marketCapRatePct: 6.5,
};

describe("loan arithmetic it reuses", () => {
  it("$1,800,000 at 6.5% over 30 years is $11,377.22 a month", () => {
    expect(monthlyPaymentCents(180_000_000, 6.5, 30)).toBe(1_137_722);
  });
});

describe("computeMultifamilyAcquisition — golden case", () => {
  const o = computeMultifamilyAcquisition(golden);
  it("costs and cash", () => {
    expect(o.totalCostCents).toBe(250_800_000);
    expect(o.cashRequiredCents).toBe(70_800_000);
  });
  it("income, built up per unit", () => {
    expect(o.grossScheduledRentCents).toBe(34_560_000);
    expect(o.grossPotentialIncomeCents).toBe(35_760_000);
    expect(o.effectiveGrossIncomeCents).toBe(33_614_400);
  });
  it("expense and NOI", () => {
    expect(o.managementCents).toBe(1_680_720);
    expect(o.reservesCents).toBe(720_000);
    expect(o.annualOperatingExpenseCents).toBe(11_400_720);
    expect(o.annualNoiCents).toBe(22_213_680);
  });
  it("debt and cash flow", () => {
    expect(o.annualDebtServiceCents).toBe(13_652_664);
    expect(o.monthlyCashFlowCents).toBe(713_418);
  });
  it("ratios and multiples", () => {
    expect(o.capRate).toBeCloseTo(0.092557, 6);
    expect(o.cashOnCash).toBeCloseTo(0.1209183, 6);
    expect(o.dscr).toBeCloseTo(1.6271, 4);
    expect(o.operatingExpenseRatio).toBeCloseTo(0.339162, 5);
    expect(o.grossRentMultiplier).toBeCloseTo(6.9444, 4);
  });
  it("value at the market cap rate", () => {
    expect(o.stabilizedValueCents).toBe(341_748_923);
  });
});

describe("computeMultifamilyAcquisition — the honest edges", () => {
  it("all cash: no debt service, no DSCR, cash required is price + costs", () => {
    const o = computeMultifamilyAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(250_800_000);
  });
  it("100% down is all cash by the operator's own answer", () => {
    const o = computeMultifamilyAcquisition({ ...golden, downPaymentPct: 100, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.dscr).toBeNull();
  });
  it("no market cap rate: no value at market — null, not $0", () => {
    expect(computeMultifamilyAcquisition({ ...golden, marketCapRatePct: null }).stabilizedValueCents).toBeNull();
  });
  it("a negative NOI has no value at market", () => {
    const o = computeMultifamilyAcquisition({ ...golden, annualOperatingExpensesCents: 40_000_000 });
    expect(o.annualNoiCents).toBeLessThan(0);
    expect(o.stabilizedValueCents).toBeNull();
  });
  it("omitted other income, closing and capex are excluded", () => {
    const o = computeMultifamilyAcquisition({ ...golden, otherMonthlyIncomeCents: null, closingCostsCents: null, capexCents: null });
    expect(o.grossPotentialIncomeCents).toBe(34_560_000);
    expect(o.totalCostCents).toBe(240_000_000);
    expect(o.cashRequiredCents).toBe(60_000_000);
  });
  it("zero rent: GRM and expense ratio are undefined, not numbers", () => {
    const o = computeMultifamilyAcquisition({ ...golden, avgMonthlyRentPerUnitCents: 0, otherMonthlyIncomeCents: null });
    expect(o.grossRentMultiplier).toBeNull();
    expect(o.operatingExpenseRatio).toBeNull();
  });
  it("no cash required (0% down, no costs): cash-on-cash is undefined", () => {
    const o = computeMultifamilyAcquisition({ ...golden, downPaymentPct: 0, closingCostsCents: null, capexCents: null });
    expect(o.cashRequiredCents).toBe(0);
    expect(o.cashOnCash).toBeNull();
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
    expect(() => computeMultifamilyAcquisition({ ...golden, amortizationYears: null })).toThrow(/amortization/);
  });
  it("unit count must be a whole number, at least 1", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, unitCount: 0 })).toThrow(/Unit count/);
    expect(() => computeMultifamilyAcquisition({ ...golden, unitCount: -4 })).toThrow(/Unit count/);
    expect(() => computeMultifamilyAcquisition({ ...golden, unitCount: 12.5 })).toThrow(/Unit count/);
  });
  it("price must be positive", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
  });
  it("negative incomes and costs are refused — a typo would move every return", () => {
    for (const k of [
      "avgMonthlyRentPerUnitCents",
      "otherMonthlyIncomeCents",
      "annualOperatingExpensesCents",
      "reservesPerUnitPerYearCents",
      "closingCostsCents",
      "capexCents",
    ] as const) {
      expect(() => computeMultifamilyAcquisition({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
    }
  });
  it("percentages outside 0–100 are refused", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, vacancyPct: -1 })).toThrow(/vacancyPct/);
    expect(() => computeMultifamilyAcquisition({ ...golden, vacancyPct: 101 })).toThrow(/vacancyPct/);
    expect(() => computeMultifamilyAcquisition({ ...golden, managementPct: -1 })).toThrow(/managementPct/);
    expect(() => computeMultifamilyAcquisition({ ...golden, managementPct: 101 })).toThrow(/managementPct/);
    expect(() => computeMultifamilyAcquisition({ ...golden, downPaymentPct: -1 })).toThrow(/Down payment/);
    expect(() => computeMultifamilyAcquisition({ ...golden, downPaymentPct: 101 })).toThrow(/Down payment/);
  });
  it("a market cap rate must be above 0 and at most 100", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, marketCapRatePct: 0 })).toThrow(/Market cap rate/);
    expect(() => computeMultifamilyAcquisition({ ...golden, marketCapRatePct: -2 })).toThrow(/Market cap rate/);
    expect(() => computeMultifamilyAcquisition({ ...golden, marketCapRatePct: 101 })).toThrow(/Market cap rate/);
  });
  it("loan terms outside any real loan are refused", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, interestRatePct: 31 })).toThrow(/Interest rate/);
    expect(() => computeMultifamilyAcquisition({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeMultifamilyAcquisition({ ...golden, amortizationYears: 0 })).toThrow(/Amortization/);
    expect(() => computeMultifamilyAcquisition({ ...golden, amortizationYears: 41 })).toThrow(/Amortization/);
    expect(() => computeMultifamilyAcquisition({ ...golden, amortizationYears: 29.5 })).toThrow(/Amortization/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() => computeMultifamilyAcquisition({ ...golden, vacancyPct: 0, managementPct: 100, interestRatePct: 30, amortizationYears: 40, marketCapRatePct: 100 })).not.toThrow();
    expect(() => computeMultifamilyAcquisition({ ...golden, vacancyPct: 100, managementPct: 0, interestRatePct: 0, amortizationYears: 1, unitCount: 1 })).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    unitCount: 24,
    avgMonthlyRentPerUnitCents: 120_000,
    vacancyPct: 6,
    annualOperatingExpensesCents: 9_000_000,
    managementPct: 5,
    reservesPerUnitPerYearCents: 30_000,
    purchasePriceCents: 240_000_000,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "multifamily_acquisition", inputs }, ENGINES);

  it("declares multifamily, under its own id and version", () => {
    expect(multifamilyAcquisitionEngine.id).toBe("multifamily_acquisition");
    expect(multifamilyAcquisitionEngine.version).toBe("multifamily-acquisition-1");
    expect(multifamilyAcquisitionEngine.verticals).toEqual(["multifamily"]);
  });

  it("emits every metric it declares, and predicts total_cost so an outcome can grade it", () => {
    const body = run(wire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...multifamilyAcquisitionEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(240_000_000);
  });

  it("every metric carries its registered unit — DSCR and GRM are multiples, cap rate a ratio", () => {
    const body = run(golden as unknown as Record<string, number>);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    expect(body.metrics.find((m) => m.id === "dscr")?.unit).toBe("multiple");
    expect(body.metrics.find((m) => m.id === "gross_rent_multiplier")?.unit).toBe("multiple");
    expect(body.metrics.find((m) => m.id === "cap_rate")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBe(341_748_923);
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(
      ["closing_costs", "financing", "immediate_capex", "market_cap_rate", "other_income"].sort(),
    );
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.inputs).not.toHaveProperty("otherMonthlyIncomeCents");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("a fully answered form declares nothing", () => {
    const body = run(golden as unknown as Record<string, number>);
    expect(body.assumptions).toEqual([]);
  });

  it("100% down is the operator's answer, so no financing default is declared", () => {
    const body = run({ ...wire, downPaymentPct: 100 });
    expect(body.assumptions.map((a) => a.key)).not.toContain("financing");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("loan terms an all-cash purchase did not use are not recorded as inputs", () => {
    const body = run({ ...wire, downPaymentPct: 100, interestRatePct: 7, amortizationYears: 30 });
    expect(body.inputs).toHaveProperty("downPaymentPct", 100);
    expect(body.inputs).not.toHaveProperty("interestRatePct");
    expect(body.inputs).not.toHaveProperty("amortizationYears");
  });

  it("loan terms typed without a down payment are refused, not silently dropped", () => {
    expect(() => run({ ...wire, interestRatePct: 7, amortizationYears: 30 })).toThrow(/without a down payment/);
    expect(() => run({ ...wire, interestRatePct: 7 })).toThrow(/without a down payment/);
  });

  it("a negative NOI with a market cap rate says why there is no value", () => {
    const body = run({ ...wire, marketCapRatePct: 6.5, annualOperatingExpensesCents: 40_000_000 });
    const a = body.assumptions.find((x) => x.key === "value_at_market");
    expect(a?.origin).toBe("derived");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, vacancyPct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, unitCount: 2.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, purchasePriceCents: 1.5 })).toThrow(/integer/);
    const { unitCount: _u, ...noUnits } = wire;
    expect(() => run(noUnits)).toThrow(/unitCount/);
  });
});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    const keys = MULTIFAMILY_ACQUISITION_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(golden).sort());
    const optional = MULTIFAMILY_ACQUISITION_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(
      ["otherMonthlyIncomeCents", "closingCostsCents", "capexCents", "downPaymentPct", "interestRatePct", "amortizationYears", "marketCapRatePct"].sort(),
    );
  });
});
