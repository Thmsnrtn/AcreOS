/**
 * The commercial acquisition engine, pinned by hand-computed figures.
 *
 * Golden case: 40,000 rentable sq ft, $800,000/yr base rent in place,
 * $200,000/yr expense recoveries, $10,000/yr other income, 8% vacancy & credit
 * loss, $260,000/yr operating expenses, 4% management, $16,000/yr reserves,
 * $150,000 TI/LC + capex, $7,000,000 price, $140,000 closing, 30% down, 7%
 * interest, 25-year amortization, 7.5% market cap rate.
 *   PGI               = 800,000 + 200,000 + 10,000      = $1,010,000
 *   EGI               = 1,010,000 × 0.92                = $929,200
 *   management        = 929,200 × 4%                    = $37,168
 *   opex              = 260,000 + 37,168 + 16,000       = $313,168
 *   NOI               = 929,200 − 313,168               = $616,032
 *   total cost        = 7,000,000 + 140,000 + 150,000   = $7,290,000
 *   cash req'd        = 2,100,000 down + 140,000 + 150,000 = $2,390,000
 *   loan              = 7,000,000 × 70%                 = $4,900,000
 *   payment           = $4,900,000 @ 7% / 25y: the level-payment factor is
 *                       r / (1 − (1 + r)^−300), r = 0.07/12, = 0.0070677920
 *                       per dollar → $34,632.1807 → $34,632.18/mo
 *   debt service      = 34,632.18 × 12                  = $415,586.16
 *   cash flow         = 616,032 − 415,586.16            = $200,445.84/yr
 *                       ÷ 12 = 16,703.82                = $16,703.82/mo
 *   cap rate          = 616,032 / 7,000,000             ≈ 8.80046%
 *   CoC               = 200,445.84 / 2,390,000          ≈ 8.38686%
 *   DSCR              = 616,032 / 415,586.16            ≈ 1.48232×
 *   OER               = 313,168 / 929,200               ≈ 33.7030%
 *   value at market   = 616,032 / 0.075                 = $8,213,760
 *   price per sq ft   = 7,000,000 / 40,000              = $175.00
 *   base rent / sq ft = 800,000 / 40,000                = $20.00
 */
import { describe, expect, it } from "vitest";
import {
  computeCommercialAcquisition,
  type CommercialAcquisitionInputs,
} from "../../shared/calculators/commercialAcquisition";
import { monthlyPaymentCents } from "../../shared/calculators/finance";
import { commercialAcquisitionEngine } from "../../server/services/economics/engines/commercialAcquisition";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { COMMERCIAL_ACQUISITION_FIELDS } from "../../shared/economics/fields/commercialAcquisition";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === commercialAcquisitionEngine.id)).toEqual([commercialAcquisitionEngine]);
});
it("appears in the composed registry exactly once", () => {
  expect(ENGINES.filter((e) => e.id === commercialAcquisitionEngine.id)).toHaveLength(1);
});

const golden: CommercialAcquisitionInputs = {
  rentableSqft: 40_000,
  annualBaseRentCents: 80_000_000,
  annualRecoveriesCents: 20_000_000,
  otherAnnualIncomeCents: 1_000_000,
  vacancyPct: 8,
  annualOperatingExpensesCents: 26_000_000,
  managementPct: 4,
  annualReservesCents: 1_600_000,
  tiLcCapexCents: 15_000_000,
  purchasePriceCents: 700_000_000,
  closingCostsCents: 14_000_000,
  downPaymentPct: 30,
  interestRatePct: 7,
  amortizationYears: 25,
  marketCapRatePct: 7.5,
};

describe("loan arithmetic it reuses", () => {
  it("$4,900,000 at 7% over 25 years is $34,632.18 a month", () => {
    expect(monthlyPaymentCents(490_000_000, 7, 25)).toBe(3_463_218);
  });
});

describe("computeCommercialAcquisition — golden case", () => {
  const o = computeCommercialAcquisition(golden);
  it("costs and cash", () => {
    expect(o.totalCostCents).toBe(729_000_000);
    expect(o.cashRequiredCents).toBe(239_000_000);
  });
  it("income: base rent plus recoveries plus other, after vacancy", () => {
    expect(o.potentialGrossIncomeCents).toBe(101_000_000);
    expect(o.effectiveGrossIncomeCents).toBe(92_920_000);
  });
  it("expense and NOI", () => {
    expect(o.managementCents).toBe(3_716_800);
    expect(o.annualOperatingExpenseCents).toBe(31_316_800);
    expect(o.annualNoiCents).toBe(61_603_200);
  });
  it("debt and cash flow", () => {
    expect(o.annualDebtServiceCents).toBe(41_558_616);
    expect(o.monthlyCashFlowCents).toBe(1_670_382);
  });
  it("ratios and multiples", () => {
    expect(o.capRate).toBeCloseTo(0.0880046, 7);
    expect(o.cashOnCash).toBeCloseTo(0.0838686, 7);
    expect(o.dscr).toBeCloseTo(1.48232, 5);
    expect(o.operatingExpenseRatio).toBeCloseTo(0.337030, 6);
  });
  it("value at the market cap rate", () => {
    expect(o.stabilizedValueCents).toBe(821_376_000);
  });
  it("per square foot, from the operator's own area", () => {
    expect(o.pricePerSqftCents).toBe(17_500);
    expect(o.baseRentPerSqftCents).toBe(2_000);
  });
});

describe("computeCommercialAcquisition — the honest edges", () => {
  it("all cash: no debt service, no DSCR, cash required is price + costs", () => {
    const o = computeCommercialAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(729_000_000);
  });
  it("100% down is all cash by the operator's own answer", () => {
    const o = computeCommercialAcquisition({ ...golden, downPaymentPct: 100, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.dscr).toBeNull();
  });
  it("no market cap rate: no value at market — null, not $0", () => {
    expect(computeCommercialAcquisition({ ...golden, marketCapRatePct: null }).stabilizedValueCents).toBeNull();
  });
  it("a negative NOI has no value at market", () => {
    const o = computeCommercialAcquisition({ ...golden, annualOperatingExpensesCents: 100_000_000 });
    expect(o.annualNoiCents).toBeLessThan(0);
    expect(o.stabilizedValueCents).toBeNull();
  });
  it("a NOI of exactly zero has no value at market either", () => {
    const o = computeCommercialAcquisition({
      ...golden,
      annualRecoveriesCents: null,
      otherAnnualIncomeCents: null,
      vacancyPct: 0,
      managementPct: 0,
      annualReservesCents: 0,
      annualOperatingExpensesCents: 80_000_000,
    });
    expect(o.annualNoiCents).toBe(0);
    expect(o.stabilizedValueCents).toBeNull();
  });
  it("vacancy applies to recoveries too: an empty suite recovers nothing", () => {
    const o = computeCommercialAcquisition({ ...golden, otherAnnualIncomeCents: null, vacancyPct: 50 });
    expect(o.effectiveGrossIncomeCents).toBe(50_000_000);
  });
  it("omitted recoveries, other income, closing and TI/LC are excluded", () => {
    const o = computeCommercialAcquisition({
      ...golden,
      annualRecoveriesCents: null,
      otherAnnualIncomeCents: null,
      closingCostsCents: null,
      tiLcCapexCents: null,
    });
    expect(o.potentialGrossIncomeCents).toBe(80_000_000);
    expect(o.effectiveGrossIncomeCents).toBe(73_600_000);
    expect(o.totalCostCents).toBe(700_000_000);
    expect(o.cashRequiredCents).toBe(210_000_000);
  });
  it("zero income: expense ratio is undefined, not a number", () => {
    const o = computeCommercialAcquisition({ ...golden, annualBaseRentCents: 0, annualRecoveriesCents: null, otherAnnualIncomeCents: null });
    expect(o.operatingExpenseRatio).toBeNull();
  });
  it("no cash required (0% down, no costs): cash-on-cash is undefined", () => {
    const o = computeCommercialAcquisition({ ...golden, downPaymentPct: 0, closingCostsCents: null, tiLcCapexCents: null });
    expect(o.cashRequiredCents).toBe(0);
    expect(o.cashOnCash).toBeNull();
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeCommercialAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
    expect(() => computeCommercialAcquisition({ ...golden, amortizationYears: null })).toThrow(/amortization/);
  });
  it("loan terms without a down payment are refused, not silently dropped", () => {
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: null })).toThrow(/without a down payment/);
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: null, amortizationYears: null })).toThrow(/without a down payment/);
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null })).toThrow(/without a down payment/);
  });
  it("rentable square feet must be a whole number, at least 1", () => {
    expect(() => computeCommercialAcquisition({ ...golden, rentableSqft: 0 })).toThrow(/Rentable square feet/);
    expect(() => computeCommercialAcquisition({ ...golden, rentableSqft: -400 })).toThrow(/Rentable square feet/);
    expect(() => computeCommercialAcquisition({ ...golden, rentableSqft: 1200.5 })).toThrow(/Rentable square feet/);
  });
  it("price must be positive", () => {
    expect(() => computeCommercialAcquisition({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
    expect(() => computeCommercialAcquisition({ ...golden, purchasePriceCents: -1 })).toThrow(/Purchase price/);
  });
  it("negative incomes and costs are refused — a typo would move every return", () => {
    for (const k of [
      "annualBaseRentCents",
      "annualRecoveriesCents",
      "otherAnnualIncomeCents",
      "annualOperatingExpensesCents",
      "annualReservesCents",
      "tiLcCapexCents",
      "closingCostsCents",
    ] as const) {
      expect(() => computeCommercialAcquisition({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
    }
  });
  it("percentages outside 0–100 are refused", () => {
    expect(() => computeCommercialAcquisition({ ...golden, vacancyPct: -1 })).toThrow(/vacancyPct/);
    expect(() => computeCommercialAcquisition({ ...golden, vacancyPct: 101 })).toThrow(/vacancyPct/);
    expect(() => computeCommercialAcquisition({ ...golden, managementPct: -1 })).toThrow(/managementPct/);
    expect(() => computeCommercialAcquisition({ ...golden, managementPct: 101 })).toThrow(/managementPct/);
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: -1 })).toThrow(/Down payment/);
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: 101 })).toThrow(/Down payment/);
  });
  it("a market cap rate must be above 0 and at most 100", () => {
    expect(() => computeCommercialAcquisition({ ...golden, marketCapRatePct: 0 })).toThrow(/Market cap rate/);
    expect(() => computeCommercialAcquisition({ ...golden, marketCapRatePct: -2 })).toThrow(/Market cap rate/);
    expect(() => computeCommercialAcquisition({ ...golden, marketCapRatePct: 101 })).toThrow(/Market cap rate/);
  });
  it("loan terms outside any real loan are refused", () => {
    expect(() => computeCommercialAcquisition({ ...golden, interestRatePct: 31 })).toThrow(/Interest rate/);
    expect(() => computeCommercialAcquisition({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeCommercialAcquisition({ ...golden, amortizationYears: 0 })).toThrow(/Amortization/);
    expect(() => computeCommercialAcquisition({ ...golden, amortizationYears: 41 })).toThrow(/Amortization/);
    expect(() => computeCommercialAcquisition({ ...golden, amortizationYears: 24.5 })).toThrow(/Amortization/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() => computeCommercialAcquisition({ ...golden, vacancyPct: 0, managementPct: 100, interestRatePct: 30, amortizationYears: 40, marketCapRatePct: 100 })).not.toThrow();
    expect(() => computeCommercialAcquisition({ ...golden, vacancyPct: 100, managementPct: 0, interestRatePct: 0, amortizationYears: 1, rentableSqft: 1 })).not.toThrow();
    expect(() => computeCommercialAcquisition({ ...golden, downPaymentPct: 0 })).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    rentableSqft: 40_000,
    annualBaseRentCents: 80_000_000,
    vacancyPct: 8,
    annualOperatingExpensesCents: 26_000_000,
    managementPct: 4,
    annualReservesCents: 1_600_000,
    purchasePriceCents: 700_000_000,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "commercial_acquisition", inputs }, ENGINES);

  it("declares commercial, under its own id and version", () => {
    expect(commercialAcquisitionEngine.id).toBe("commercial_acquisition");
    expect(commercialAcquisitionEngine.version).toBe("commercial-acquisition-1");
    expect(commercialAcquisitionEngine.verticals).toEqual(["commercial"]);
  });

  it("is the only engine in the registry that declares commercial", () => {
    expect(ENGINES.filter((e) => (e.verticals ?? []).includes("commercial")).map((e) => e.id)).toEqual(["commercial_acquisition"]);
  });

  it("emits every metric it declares, and predicts total_cost so an outcome can grade it", () => {
    const body = run(wire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...commercialAcquisitionEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(700_000_000);
    expect(body.metrics.find((m) => m.id === "effective_gross_income")?.value).toBe(73_600_000);
  });

  it("every metric carries its registered unit — DSCR is a multiple, cap rate a ratio", () => {
    const body = run(golden as unknown as Record<string, number>);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    expect(body.metrics.find((m) => m.id === "dscr")?.unit).toBe("multiple");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeCloseTo(1.48232, 5);
    expect(body.metrics.find((m) => m.id === "cap_rate")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "cap_rate")?.value).toBeCloseTo(0.0880046, 7);
    expect(body.metrics.find((m) => m.id === "operating_expense_ratio")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBe(821_376_000);
    expect(body.metrics.find((m) => m.id === "monthly_cash_flow")?.value).toBe(1_670_382);
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(
      ["closing_costs", "expense_recoveries", "financing", "market_cap_rate", "other_income", "ti_lc_capex"].sort(),
    );
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.inputs).not.toHaveProperty("annualRecoveriesCents");
    expect(body.inputs).not.toHaveProperty("otherAnnualIncomeCents");
    expect(body.inputs).not.toHaveProperty("tiLcCapexCents");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("a fully answered form declares nothing", () => {
    const body = run(golden as unknown as Record<string, number>);
    expect(body.assumptions).toEqual([]);
  });

  it("an explicit $0 of recoveries is the operator's answer, not a default", () => {
    const body = run({ ...wire, annualRecoveriesCents: 0 });
    expect(body.assumptions.map((a) => a.key)).not.toContain("expense_recoveries");
    expect(body.inputs).toHaveProperty("annualRecoveriesCents", 0);
  });

  it("100% down is the operator's answer, so no financing default is declared", () => {
    const body = run({ ...wire, downPaymentPct: 100 });
    expect(body.assumptions.map((a) => a.key)).not.toContain("financing");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("loan terms an all-cash purchase did not use are not recorded as inputs", () => {
    const body = run({ ...wire, downPaymentPct: 100, interestRatePct: 7, amortizationYears: 25 });
    expect(body.inputs).toHaveProperty("downPaymentPct", 100);
    expect(body.inputs).not.toHaveProperty("interestRatePct");
    expect(body.inputs).not.toHaveProperty("amortizationYears");
  });

  it("loan terms typed without a down payment are refused, not silently dropped", () => {
    expect(() => run({ ...wire, interestRatePct: 7, amortizationYears: 25 })).toThrow(/without a down payment/);
    expect(() => run({ ...wire, interestRatePct: 7 })).toThrow(/without a down payment/);
    expect(() => run({ ...wire, amortizationYears: 25 })).toThrow(ScenarioEngineError);
  });

  it("a non-positive NOI with a market cap rate says why there is no value, in a deterministic dollar figure", () => {
    const body = run({ ...wire, marketCapRatePct: 7.5, annualOperatingExpensesCents: 100_000_000 });
    const a = body.assumptions.find((x) => x.key === "value_at_market");
    expect(a?.origin).toBe("derived");
    // EGI 736,000 − (1,000,000 + 29,440 mgmt + 16,000 reserves) = −309,440
    expect(a?.basis).toContain("-$309,440.00");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, vacancyPct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, rentableSqft: 2.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, purchasePriceCents: 1.5 })).toThrow(/integer/);
    const { rentableSqft: _s, ...noArea } = wire;
    expect(() => run(noArea)).toThrow(/rentableSqft/);
    const { annualReservesCents: _r, ...noReserves } = wire;
    expect(() => run(noReserves)).toThrow(/annualReservesCents/);
  });
});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    const keys = COMMERCIAL_ACQUISITION_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(golden).sort());
    const optional = COMMERCIAL_ACQUISITION_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(
      [
        "annualRecoveriesCents",
        "otherAnnualIncomeCents",
        "tiLcCapexCents",
        "closingCostsCents",
        "downPaymentPct",
        "interestRatePct",
        "amortizationYears",
        "marketCapRatePct",
      ].sort(),
    );
  });
});
