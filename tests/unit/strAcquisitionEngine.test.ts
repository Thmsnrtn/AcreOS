/**
 * The short-term rental acquisition engine, pinned by hand-computed figures.
 *
 * Golden case: $400,000 price, $8,000 closing, $25,000 furnishing and setup,
 * $250 average nightly rate, 70% occupancy of 360 nights available, 3-night
 * average stay, $90 cleaning cost per turnover (owner pays), $120 cleaning fee
 * per stay (guest pays), 3% platform fee, 20% management, $1,100/mo fixed
 * costs, 5% reserves, 25% down, 7% interest, 30-year amortization.
 *   booked nights     = 360 × 70%                          = 252
 *   turnovers         = 252 ÷ 3                            = 84
 *   nightly revenue   = 250 × 252                          = $63,000
 *   cleaning fees     = 120 × 84                           = $10,080
 *   EGI               = 63,000 + 10,080                    = $73,080
 *   platform fees     = 73,080 × 3%                        = $2,192.40
 *   management        = 73,080 × 20%                       = $14,616
 *   reserves          = 73,080 × 5%                        = $3,654
 *   cleaning cost     = 90 × 84                            = $7,560
 *   fixed costs       = 1,100 × 12                         = $13,200
 *   opex              = 2,192.40 + 14,616 + 3,654
 *                       + 7,560 + 13,200                   = $41,222.40
 *   NOI               = 73,080 − 41,222.40                 = $31,857.60
 *   total cost        = 400,000 + 8,000 + 25,000           = $433,000
 *   cash req'd        = 100,000 down + 8,000 + 25,000      = $133,000
 *   loan              = 400,000 × 75%                      = $300,000
 *   payment           = $300,000 @ 7% / 30y: the level-payment factor is
 *                       r / (1 − (1 + r)^−360), r = 0.07/12, = 0.0066530250
 *                       per dollar → $1,995.9075 → $1,995.91/mo
 *   debt service      = 1,995.91 × 12                      = $23,950.92
 *   cash flow         = 31,857.60 − 23,950.92              = $7,906.68/yr
 *                       ÷ 12                               = $658.89/mo
 *   cap rate          = 31,857.60 / 400,000                = 7.9644%
 *   CoC               = 7,906.68 / 133,000                 ≈ 5.94487%
 *   DSCR              = 31,857.60 / 23,950.92              ≈ 1.33012×
 *   OER               = 41,222.40 / 73,080                 ≈ 56.4072%
 *
 * Fractional volume: 365 nights × 65% = 237.25 booked nights; at a 2.5-night
 * average stay that is 94.9 turnovers. Neither is rounded:
 *   nightly revenue   = 250 × 237.25                       = $59,312.50
 *   cleaning fees     = 120 × 94.9                         = $11,388
 *   cleaning cost     = 90 × 94.9                          = $8,541
 */
import { describe, expect, it } from "vitest";
import {
  computeStrAcquisition,
  type StrAcquisitionInputs,
} from "../../shared/calculators/strAcquisition";
import { monthlyPaymentCents } from "../../shared/calculators/finance";
import { strAcquisitionEngine } from "../../server/services/economics/engines/strAcquisition";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { STR_ACQUISITION_FIELDS } from "../../shared/economics/fields/strAcquisition";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === strAcquisitionEngine.id)).toEqual([strAcquisitionEngine]);
});

const golden: StrAcquisitionInputs = {
  purchasePriceCents: 40_000_000,
  closingCostsCents: 800_000,
  furnishingCents: 2_500_000,
  averageDailyRateCents: 25_000,
  occupancyPct: 70,
  nightsAvailablePerYear: 360,
  avgStayNights: 3,
  cleaningCostPerTurnoverCents: 9_000,
  cleaningFeePerStayCents: 12_000,
  platformFeePct: 3,
  managementPct: 20,
  monthlyFixedCostsCents: 110_000,
  reservesPct: 5,
  downPaymentPct: 25,
  interestRatePct: 7,
  amortizationYears: 30,
};

describe("loan arithmetic it reuses", () => {
  it("$300,000 at 7% over 30 years is $1,995.91 a month", () => {
    expect(monthlyPaymentCents(30_000_000, 7, 30)).toBe(199_591);
  });
});

describe("computeStrAcquisition — golden case", () => {
  const o = computeStrAcquisition(golden);
  it("stay volume", () => {
    expect(o.bookedNights).toBe(252);
    expect(o.turnovers).toBe(84);
  });
  it("income, built up from nights and stays", () => {
    expect(o.nightlyRevenueCents).toBe(6_300_000);
    expect(o.cleaningFeeIncomeCents).toBe(1_008_000);
    expect(o.effectiveGrossIncomeCents).toBe(7_308_000);
  });
  it("expense lines and NOI", () => {
    expect(o.platformFeesCents).toBe(219_240);
    expect(o.managementCents).toBe(1_461_600);
    expect(o.reservesCents).toBe(365_400);
    expect(o.cleaningCostCents).toBe(756_000);
    expect(o.fixedCostsCents).toBe(1_320_000);
    expect(o.annualOperatingExpenseCents).toBe(4_122_240);
    expect(o.annualNoiCents).toBe(3_185_760);
  });
  it("costs and cash", () => {
    expect(o.totalCostCents).toBe(43_300_000);
    expect(o.cashRequiredCents).toBe(13_300_000);
  });
  it("debt and cash flow", () => {
    expect(o.annualDebtServiceCents).toBe(2_395_092);
    expect(o.monthlyCashFlowCents).toBe(65_889);
  });
  it("ratios and multiples", () => {
    expect(o.capRate).toBeCloseTo(0.079644, 6);
    expect(o.cashOnCash).toBeCloseTo(0.0594487, 6);
    expect(o.dscr).toBeCloseTo(1.33012, 5);
    expect(o.operatingExpenseRatio).toBeCloseTo(0.564072, 6);
  });
});

describe("computeStrAcquisition — the honest edges", () => {
  it("fractional nights and turnovers are expected counts, not rounded", () => {
    const o = computeStrAcquisition({ ...golden, nightsAvailablePerYear: 365, occupancyPct: 65, avgStayNights: 2.5 });
    expect(o.bookedNights).toBe(237.25);
    expect(o.turnovers).toBeCloseTo(94.9, 10);
    expect(o.nightlyRevenueCents).toBe(5_931_250);
    expect(o.cleaningFeeIncomeCents).toBe(1_138_800);
    expect(o.cleaningCostCents).toBe(854_100);
  });
  it("all cash: no debt service, no DSCR, cash required is price + costs", () => {
    const o = computeStrAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(43_300_000);
  });
  it("100% down is all cash by the operator's own answer", () => {
    const o = computeStrAcquisition({ ...golden, downPaymentPct: 100, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.dscr).toBeNull();
  });
  it("no guest cleaning fee: income is the nightly rate alone, the owner's cleaning cost still counts", () => {
    const o = computeStrAcquisition({ ...golden, cleaningFeePerStayCents: null });
    expect(o.cleaningFeeIncomeCents).toBe(0);
    expect(o.effectiveGrossIncomeCents).toBe(6_300_000);
    expect(o.cleaningCostCents).toBe(756_000);
  });
  it("omitted closing and furnishing are excluded", () => {
    const o = computeStrAcquisition({ ...golden, closingCostsCents: null, furnishingCents: null });
    expect(o.totalCostCents).toBe(40_000_000);
    expect(o.cashRequiredCents).toBe(10_000_000);
  });
  it("zero occupancy: no income, so the expense ratio is undefined and NOI is the fixed costs lost", () => {
    const o = computeStrAcquisition({ ...golden, occupancyPct: 0 });
    expect(o.effectiveGrossIncomeCents).toBe(0);
    expect(o.turnovers).toBe(0);
    expect(o.operatingExpenseRatio).toBeNull();
    expect(o.annualNoiCents).toBe(-1_320_000);
  });
  it("no cash required (0% down, no costs): cash-on-cash is undefined", () => {
    const o = computeStrAcquisition({ ...golden, downPaymentPct: 0, closingCostsCents: null, furnishingCents: null });
    expect(o.cashRequiredCents).toBe(0);
    expect(o.cashOnCash).toBeNull();
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeStrAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
    expect(() => computeStrAcquisition({ ...golden, amortizationYears: null })).toThrow(/amortization/);
  });
  it("loan terms typed without a down payment are refused", () => {
    expect(() => computeStrAcquisition({ ...golden, downPaymentPct: null })).toThrow(/without a down payment/);
    expect(() => computeStrAcquisition({ ...golden, downPaymentPct: null, amortizationYears: null })).toThrow(/without a down payment/);
  });
  it("price must be positive", () => {
    expect(() => computeStrAcquisition({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
    expect(() => computeStrAcquisition({ ...golden, purchasePriceCents: -1 })).toThrow(/Purchase price/);
  });
  it("nights available must be a whole number, 1 to 366", () => {
    expect(() => computeStrAcquisition({ ...golden, nightsAvailablePerYear: 0 })).toThrow(/Nights available/);
    expect(() => computeStrAcquisition({ ...golden, nightsAvailablePerYear: 367 })).toThrow(/Nights available/);
    expect(() => computeStrAcquisition({ ...golden, nightsAvailablePerYear: 300.5 })).toThrow(/Nights available/);
  });
  it("an average stay must be at least one night", () => {
    expect(() => computeStrAcquisition({ ...golden, avgStayNights: 0 })).toThrow(/Average stay/);
    expect(() => computeStrAcquisition({ ...golden, avgStayNights: -2 })).toThrow(/Average stay/);
    expect(() => computeStrAcquisition({ ...golden, avgStayNights: 0.5 })).toThrow(/Average stay/);
  });
  it("negative incomes and costs are refused — a typo would move every return", () => {
    for (const k of [
      "averageDailyRateCents",
      "cleaningCostPerTurnoverCents",
      "cleaningFeePerStayCents",
      "monthlyFixedCostsCents",
      "closingCostsCents",
      "furnishingCents",
    ] as const) {
      expect(() => computeStrAcquisition({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
    }
  });
  it("percentages outside 0–100 are refused", () => {
    for (const k of ["occupancyPct", "platformFeePct", "managementPct", "reservesPct"] as const) {
      expect(() => computeStrAcquisition({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
      expect(() => computeStrAcquisition({ ...golden, [k]: 101 })).toThrow(new RegExp(k));
    }
    expect(() => computeStrAcquisition({ ...golden, downPaymentPct: -1 })).toThrow(/Down payment/);
    expect(() => computeStrAcquisition({ ...golden, downPaymentPct: 101 })).toThrow(/Down payment/);
  });
  it("loan terms outside any real loan are refused", () => {
    expect(() => computeStrAcquisition({ ...golden, interestRatePct: 31 })).toThrow(/Interest rate/);
    expect(() => computeStrAcquisition({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeStrAcquisition({ ...golden, amortizationYears: 0 })).toThrow(/Amortization/);
    expect(() => computeStrAcquisition({ ...golden, amortizationYears: 41 })).toThrow(/Amortization/);
    expect(() => computeStrAcquisition({ ...golden, amortizationYears: 29.5 })).toThrow(/Amortization/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() =>
      computeStrAcquisition({ ...golden, occupancyPct: 100, platformFeePct: 0, managementPct: 100, reservesPct: 0, nightsAvailablePerYear: 366, avgStayNights: 1, interestRatePct: 30, amortizationYears: 40 }),
    ).not.toThrow();
    expect(() =>
      computeStrAcquisition({ ...golden, occupancyPct: 0, platformFeePct: 100, managementPct: 0, reservesPct: 100, nightsAvailablePerYear: 1, interestRatePct: 0, amortizationYears: 1, downPaymentPct: 0 }),
    ).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    purchasePriceCents: 40_000_000,
    averageDailyRateCents: 25_000,
    occupancyPct: 70,
    nightsAvailablePerYear: 360,
    avgStayNights: 3,
    cleaningCostPerTurnoverCents: 9_000,
    platformFeePct: 3,
    managementPct: 20,
    monthlyFixedCostsCents: 110_000,
    reservesPct: 5,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "str_acquisition", inputs }, ENGINES);

  it("declares short_term_rental, under its own id and version", () => {
    expect(strAcquisitionEngine.id).toBe("str_acquisition");
    expect(strAcquisitionEngine.version).toBe("str-acquisition-1");
    expect(strAcquisitionEngine.verticals).toEqual(["short_term_rental"]);
  });

  it("no other engine claims the short_term_rental vertical", () => {
    const claimants = ENGINES.filter((e) => (e.verticals ?? []).includes("short_term_rental")).map((e) => e.id);
    expect(claimants).toEqual(["str_acquisition"]);
  });

  it("emits every metric it declares, and predicts total_cost so an outcome can grade it", () => {
    const body = run(wire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...strAcquisitionEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(40_000_000);
  });

  it("every metric carries its registered unit — DSCR a multiple, cap rate a ratio", () => {
    const body = run(golden as unknown as Record<string, number>);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    expect(body.metrics.find((m) => m.id === "dscr")?.unit).toBe("multiple");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeCloseTo(1.33012, 5);
    expect(body.metrics.find((m) => m.id === "cap_rate")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "cap_rate")?.value).toBeCloseTo(0.079644, 6);
    expect(body.metrics.find((m) => m.id === "operating_expense_ratio")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "effective_gross_income")?.value).toBe(7_308_000);
    expect(body.metrics.find((m) => m.id === "monthly_cash_flow")?.value).toBe(65_889);
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(43_300_000);
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    const defaults = body.assumptions.filter((a) => a.origin === "platform-default").map((a) => a.key).sort();
    expect(defaults).toEqual(["cleaning_fee_income", "closing_costs", "financing", "furnishing"].sort());
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.inputs).not.toHaveProperty("furnishingCents");
    expect(body.inputs).not.toHaveProperty("cleaningFeePerStayCents");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
    expect(body.metrics.find((m) => m.id === "annual_debt_service")?.value).toBe(0);
  });

  it("a fully answered form declares no defaults — only the derived stay volume", () => {
    const body = run(golden as unknown as Record<string, number>);
    expect(body.assumptions.map((a) => [a.key, a.origin])).toEqual([["stay_volume", "derived"]]);
    expect(body.assumptions[0].value).toBe("252 booked nights, 84 turnovers a year");
  });

  it("the derived stay volume is written deterministically, to one decimal", () => {
    const body = run({ ...wire, nightsAvailablePerYear: 365, occupancyPct: 65, avgStayNights: 2.5 });
    expect(body.assumptions.find((a) => a.key === "stay_volume")?.value).toBe("237.3 booked nights, 94.9 turnovers a year");
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
    expect(() => run({ ...wire, amortizationYears: 30 })).toThrow(/without a down payment/);
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, occupancyPct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, nightsAvailablePerYear: 400 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, avgStayNights: 0 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, averageDailyRateCents: 250.5 })).toThrow(/integer/);
    const { averageDailyRateCents: _a, ...noRate } = wire;
    expect(() => run(noRate)).toThrow(/averageDailyRateCents/);
  });
});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    const keys = STR_ACQUISITION_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(golden).sort());
    const optional = STR_ACQUISITION_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(
      ["closingCostsCents", "furnishingCents", "cleaningFeePerStayCents", "downPaymentPct", "interestRatePct", "amortizationYears"].sort(),
    );
  });
});
