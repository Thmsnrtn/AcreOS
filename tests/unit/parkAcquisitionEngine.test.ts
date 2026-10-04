/**
 * The mobile-home park acquisition engine, pinned by hand-computed figures.
 *
 * Golden case: 80 lots, 68 occupied, $450/mo lot rent, 6 park-owned homes at
 * $650/mo home rent on top of lot rent, $1,200/mo other income, 3% credit
 * loss, $95,000/yr operating expenses, 6% management, $100/lot/yr capex
 * reserve, $3,600,000 price, $54,000 closing, $120,000 infrastructure capex,
 * 30% down, 7% interest, 25-year amortization, 7.5% market cap rate.
 *   lot income        = 68 × 450 × 12                   = $367,200
 *   POH income        = 6 × 650 × 12                    = $46,800
 *   other income      = 1,200 × 12                      = $14,400
 *   gross             = 367,200 + 46,800 + 14,400       = $428,400
 *   EGI               = 428,400 × 0.97                  = $415,548
 *   management        = 415,548 × 6%                    = $24,932.88
 *   capex reserve     = 100 × 80 (every lot)            = $8,000
 *   opex              = 95,000 + 24,932.88 + 8,000      = $127,932.88
 *   NOI               = 415,548 − 127,932.88            = $287,615.12
 *   total cost        = 3,600,000 + 54,000 + 120,000    = $3,774,000
 *   cash req'd        = 1,080,000 down + 54,000 + 120,000 = $1,254,000
 *   loan              = 3,600,000 × 70%                 = $2,520,000
 *   payment           = $2,520,000 @ 7% / 25y: r = 0.07/12 = 0.0058333…,
 *                       (1 + r)^300 = 5.7254182, so the level-payment factor
 *                       r / (1 − (1 + r)^−300) = 0.0070677920 per dollar
 *                       → $17,810.8358 → $17,810.84/mo
 *   debt service      = 17,810.84 × 12                  = $213,730.08
 *   cash flow         = 287,615.12 − 213,730.08         = $73,885.04/yr
 *                       ÷ 12 = 6,157.0867               = $6,157.09/mo
 *   cap rate          = 287,615.12 / 3,600,000          ≈ 7.98931%
 *   CoC               = 73,885.04 / 1,254,000           ≈ 5.89195%
 *   DSCR              = 287,615.12 / 213,730.08         ≈ 1.3457×
 *   OER               = 127,932.88 / 415,548            ≈ 30.7865%
 *   value at market   = 287,615.12 / 0.075              = $3,834,868.27
 *   lot occupancy     = 68 / 80                         = 85%
 *   price per lot     = 3,600,000 / 80                  = $45,000
 */
import { describe, expect, it } from "vitest";
import {
  computeParkAcquisition,
  type ParkAcquisitionInputs,
} from "../../shared/calculators/parkAcquisition";
import { monthlyPaymentCents } from "../../shared/calculators/finance";
import { parkAcquisitionEngine } from "../../server/services/economics/engines/parkAcquisition";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { PARK_ACQUISITION_FIELDS } from "../../shared/economics/fields/parkAcquisition";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === parkAcquisitionEngine.id)).toEqual([parkAcquisitionEngine]);
});

const golden: ParkAcquisitionInputs = {
  totalLots: 80,
  occupiedLots: 68,
  monthlyLotRentCents: 45_000,
  parkOwnedHomes: 6,
  parkOwnedHomeRentCents: 65_000,
  otherMonthlyIncomeCents: 120_000,
  creditLossPct: 3,
  annualOperatingExpensesCents: 9_500_000,
  managementPct: 6,
  capexReservePerLotPerYearCents: 10_000,
  purchasePriceCents: 360_000_000,
  closingCostsCents: 5_400_000,
  infrastructureCapexCents: 12_000_000,
  downPaymentPct: 30,
  interestRatePct: 7,
  amortizationYears: 25,
  marketCapRatePct: 7.5,
};

describe("loan arithmetic it reuses", () => {
  it("$2,520,000 at 7% over 25 years is $17,810.84 a month", () => {
    expect(monthlyPaymentCents(252_000_000, 7, 25)).toBe(1_781_084);
  });
});

describe("computeParkAcquisition — golden case", () => {
  const o = computeParkAcquisition(golden);
  it("costs and cash", () => {
    expect(o.totalCostCents).toBe(377_400_000);
    expect(o.cashRequiredCents).toBe(125_400_000);
  });
  it("income, built up from occupied lots and park-owned homes separately", () => {
    expect(o.lotIncomeCents).toBe(36_720_000);
    expect(o.parkOwnedHomeIncomeCents).toBe(4_680_000);
    expect(o.otherIncomeCents).toBe(1_440_000);
    expect(o.grossIncomeCents).toBe(42_840_000);
    expect(o.effectiveGrossIncomeCents).toBe(41_554_800);
  });
  it("expense and NOI — the reserve covers every lot, occupied or not", () => {
    expect(o.managementCents).toBe(2_493_288);
    expect(o.capexReserveCents).toBe(800_000);
    expect(o.annualOperatingExpenseCents).toBe(12_793_288);
    expect(o.annualNoiCents).toBe(28_761_512);
  });
  it("debt and cash flow", () => {
    expect(o.annualDebtServiceCents).toBe(21_373_008);
    expect(o.monthlyCashFlowCents).toBe(615_709);
  });
  it("ratios and multiples", () => {
    expect(o.capRate).toBeCloseTo(0.0798931, 6);
    expect(o.cashOnCash).toBeCloseTo(0.0589195, 6);
    expect(o.dscr).toBeCloseTo(1.3457, 4);
    expect(o.operatingExpenseRatio).toBeCloseTo(0.307865, 5);
  });
  it("value at the market cap rate", () => {
    expect(o.stabilizedValueCents).toBe(383_486_827);
  });
  it("occupancy and price per lot, from the operator's own inputs", () => {
    expect(o.lotOccupancy).toBe(0.85);
    expect(o.pricePerLotCents).toBe(4_500_000);
  });
});

describe("computeParkAcquisition — the honest edges", () => {
  it("all cash: no debt service, no DSCR, cash required is price + costs", () => {
    const o = computeParkAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(377_400_000);
  });
  it("100% down is all cash by the operator's own answer", () => {
    const o = computeParkAcquisition({ ...golden, downPaymentPct: 100, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.dscr).toBeNull();
  });
  it("no park-owned homes: lot rent only, the home line is $0 of income, not invented", () => {
    const absent = computeParkAcquisition({ ...golden, parkOwnedHomes: null, parkOwnedHomeRentCents: null });
    expect(absent.parkOwnedHomeIncomeCents).toBe(0);
    expect(absent.grossIncomeCents).toBe(36_720_000 + 1_440_000);
    const zero = computeParkAcquisition({ ...golden, parkOwnedHomes: 0, parkOwnedHomeRentCents: null });
    expect(zero.grossIncomeCents).toBe(absent.grossIncomeCents);
  });
  it("a home rent with zero park-owned homes is not counted", () => {
    const o = computeParkAcquisition({ ...golden, parkOwnedHomes: 0 });
    expect(o.parkOwnedHomeIncomeCents).toBe(0);
  });
  it("park-owned homes without their home rent are refused, not guessed", () => {
    expect(() => computeParkAcquisition({ ...golden, parkOwnedHomeRentCents: null })).toThrow(/home rent/);
  });
  it("a home rent typed without a home count is refused, not silently dropped", () => {
    expect(() => computeParkAcquisition({ ...golden, parkOwnedHomes: null })).toThrow(/without the number of park-owned homes/);
  });
  it("an empty park earns no lot rent — occupancy is the input, never assumed", () => {
    const o = computeParkAcquisition({ ...golden, occupiedLots: 0, parkOwnedHomes: 0, otherMonthlyIncomeCents: null });
    expect(o.lotIncomeCents).toBe(0);
    expect(o.lotOccupancy).toBe(0);
    expect(o.effectiveGrossIncomeCents).toBe(0);
    expect(o.operatingExpenseRatio).toBeNull();
    expect(o.annualNoiCents).toBeLessThan(0);
    expect(o.stabilizedValueCents).toBeNull();
  });
  it("no market cap rate: no value at market — null, not $0", () => {
    expect(computeParkAcquisition({ ...golden, marketCapRatePct: null }).stabilizedValueCents).toBeNull();
  });
  it("a negative NOI has no value at market", () => {
    const o = computeParkAcquisition({ ...golden, annualOperatingExpensesCents: 50_000_000 });
    expect(o.annualNoiCents).toBeLessThan(0);
    expect(o.stabilizedValueCents).toBeNull();
  });
  it("omitted other income, closing and infrastructure capex are excluded", () => {
    const o = computeParkAcquisition({ ...golden, otherMonthlyIncomeCents: null, closingCostsCents: null, infrastructureCapexCents: null });
    expect(o.grossIncomeCents).toBe(36_720_000 + 4_680_000);
    expect(o.totalCostCents).toBe(360_000_000);
    expect(o.cashRequiredCents).toBe(108_000_000);
  });
  it("no cash required (0% down, no costs): cash-on-cash is undefined", () => {
    const o = computeParkAcquisition({ ...golden, downPaymentPct: 0, closingCostsCents: null, infrastructureCapexCents: null });
    expect(o.cashRequiredCents).toBe(0);
    expect(o.cashOnCash).toBeNull();
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeParkAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
    expect(() => computeParkAcquisition({ ...golden, amortizationYears: null })).toThrow(/amortization/);
  });
  it("loan terms without a down payment are refused", () => {
    expect(() => computeParkAcquisition({ ...golden, downPaymentPct: null })).toThrow(/without a down payment/);
    expect(() => computeParkAcquisition({ ...golden, downPaymentPct: null, amortizationYears: null })).toThrow(/without a down payment/);
  });
  it("total lots must be a whole number, at least 1", () => {
    expect(() => computeParkAcquisition({ ...golden, totalLots: 0 })).toThrow(/Total lots/);
    expect(() => computeParkAcquisition({ ...golden, totalLots: -4 })).toThrow(/Total lots/);
    expect(() => computeParkAcquisition({ ...golden, totalLots: 80.5 })).toThrow(/Total lots/);
  });
  it("occupied lots must be whole, from 0 up to the total lots", () => {
    expect(() => computeParkAcquisition({ ...golden, occupiedLots: 81 })).toThrow(/Occupied lots/);
    expect(() => computeParkAcquisition({ ...golden, occupiedLots: -1 })).toThrow(/Occupied lots/);
    expect(() => computeParkAcquisition({ ...golden, occupiedLots: 67.5 })).toThrow(/Occupied lots/);
  });
  it("park-owned homes must be whole, from 0 up to the occupied lots", () => {
    expect(() => computeParkAcquisition({ ...golden, parkOwnedHomes: 69 })).toThrow(/Park-owned homes/);
    expect(() => computeParkAcquisition({ ...golden, parkOwnedHomes: -1 })).toThrow(/Park-owned homes/);
    expect(() => computeParkAcquisition({ ...golden, parkOwnedHomes: 2.5 })).toThrow(/Park-owned homes/);
  });
  it("price must be positive", () => {
    expect(() => computeParkAcquisition({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
  });
  it("negative incomes and costs are refused — a typo would move every return", () => {
    for (const k of [
      "monthlyLotRentCents",
      "parkOwnedHomeRentCents",
      "otherMonthlyIncomeCents",
      "annualOperatingExpensesCents",
      "capexReservePerLotPerYearCents",
      "closingCostsCents",
      "infrastructureCapexCents",
    ] as const) {
      expect(() => computeParkAcquisition({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
    }
  });
  it("percentages outside 0–100 are refused", () => {
    expect(() => computeParkAcquisition({ ...golden, creditLossPct: -1 })).toThrow(/creditLossPct/);
    expect(() => computeParkAcquisition({ ...golden, creditLossPct: 101 })).toThrow(/creditLossPct/);
    expect(() => computeParkAcquisition({ ...golden, managementPct: -1 })).toThrow(/managementPct/);
    expect(() => computeParkAcquisition({ ...golden, managementPct: 101 })).toThrow(/managementPct/);
    expect(() => computeParkAcquisition({ ...golden, downPaymentPct: -1 })).toThrow(/Down payment/);
    expect(() => computeParkAcquisition({ ...golden, downPaymentPct: 101 })).toThrow(/Down payment/);
  });
  it("a market cap rate must be above 0 and at most 100", () => {
    expect(() => computeParkAcquisition({ ...golden, marketCapRatePct: 0 })).toThrow(/Market cap rate/);
    expect(() => computeParkAcquisition({ ...golden, marketCapRatePct: -2 })).toThrow(/Market cap rate/);
    expect(() => computeParkAcquisition({ ...golden, marketCapRatePct: 101 })).toThrow(/Market cap rate/);
  });
  it("loan terms outside any real loan are refused", () => {
    expect(() => computeParkAcquisition({ ...golden, interestRatePct: 31 })).toThrow(/Interest rate/);
    expect(() => computeParkAcquisition({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeParkAcquisition({ ...golden, amortizationYears: 0 })).toThrow(/Amortization/);
    expect(() => computeParkAcquisition({ ...golden, amortizationYears: 41 })).toThrow(/Amortization/);
    expect(() => computeParkAcquisition({ ...golden, amortizationYears: 24.5 })).toThrow(/Amortization/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() =>
      computeParkAcquisition({ ...golden, creditLossPct: 0, managementPct: 100, interestRatePct: 30, amortizationYears: 40, marketCapRatePct: 100, occupiedLots: 80, parkOwnedHomes: 80 }),
    ).not.toThrow();
    expect(() =>
      computeParkAcquisition({ ...golden, creditLossPct: 100, managementPct: 0, interestRatePct: 0, amortizationYears: 1, totalLots: 1, occupiedLots: 1, parkOwnedHomes: 1 }),
    ).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    totalLots: 80,
    occupiedLots: 68,
    monthlyLotRentCents: 45_000,
    creditLossPct: 3,
    annualOperatingExpensesCents: 9_500_000,
    managementPct: 6,
    capexReservePerLotPerYearCents: 10_000,
    purchasePriceCents: 360_000_000,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "park_acquisition", inputs }, ENGINES);

  it("declares mobile_home, under its own id and version", () => {
    expect(parkAcquisitionEngine.id).toBe("park_acquisition");
    expect(parkAcquisitionEngine.version).toBe("park-acquisition-1");
    expect(parkAcquisitionEngine.verticals).toEqual(["mobile_home"]);
  });

  it("is the only engine in the composed registry that declares mobile_home", () => {
    expect(ENGINES.filter((e) => (e.verticals ?? []).includes("mobile_home")).map((e) => e.id)).toEqual(["park_acquisition"]);
  });

  it("emits every metric it declares, and predicts total_cost so an outcome can grade it", () => {
    const body = run(wire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...parkAcquisitionEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(360_000_000);
  });

  it("every metric carries its registered unit — DSCR is a multiple, cap rate a ratio", () => {
    const body = run(golden as unknown as Record<string, number>);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    expect(body.metrics.find((m) => m.id === "dscr")?.unit).toBe("multiple");
    expect(body.metrics.find((m) => m.id === "cap_rate")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeCloseTo(1.3457, 4);
    expect(body.metrics.find((m) => m.id === "annual_noi")?.value).toBe(28_761_512);
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBe(383_486_827);
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(
      ["closing_costs", "financing", "infrastructure_capex", "market_cap_rate", "other_income", "park_owned_homes"].sort(),
    );
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.inputs).not.toHaveProperty("otherMonthlyIncomeCents");
    expect(body.inputs).not.toHaveProperty("parkOwnedHomes");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
    expect(body.metrics.find((m) => m.id === "dscr")?.value).toBeNull();
  });

  it("a fully answered form declares nothing", () => {
    const body = run(golden as unknown as Record<string, number>);
    expect(body.assumptions).toEqual([]);
  });

  it("0 park-owned homes is the operator's answer, so no home default is declared", () => {
    const body = run({ ...wire, parkOwnedHomes: 0 });
    expect(body.assumptions.map((a) => a.key)).not.toContain("park_owned_homes");
    expect(body.inputs).toHaveProperty("parkOwnedHomes", 0);
  });

  it("a home rent the park's zero homes did not use is not recorded as an input", () => {
    const body = run({ ...wire, parkOwnedHomes: 0, parkOwnedHomeRentCents: 65_000 });
    expect(body.inputs).not.toHaveProperty("parkOwnedHomeRentCents");
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
  });

  it("a home rent typed without a home count is refused as a scenario error", () => {
    expect(() => run({ ...wire, parkOwnedHomeRentCents: 65_000 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, parkOwnedHomes: 4 })).toThrow(/home rent/);
  });

  it("a negative NOI with a market cap rate says why there is no value", () => {
    const body = run({ ...wire, marketCapRatePct: 7.5, annualOperatingExpensesCents: 50_000_000 });
    const a = body.assumptions.find((x) => x.key === "value_at_market");
    expect(a?.origin).toBe("derived");
    expect(body.metrics.find((m) => m.id === "stabilized_value")?.value).toBeNull();
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, creditLossPct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, totalLots: 2.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, occupiedLots: 81 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, purchasePriceCents: 1.5 })).toThrow(/integer/);
    const { occupiedLots: _o, ...noOccupancy } = wire;
    expect(() => run(noOccupancy)).toThrow(/occupiedLots/);
  });
});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    const keys = PARK_ACQUISITION_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(golden).sort());
    const optional = PARK_ACQUISITION_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(
      [
        "parkOwnedHomes",
        "parkOwnedHomeRentCents",
        "otherMonthlyIncomeCents",
        "closingCostsCents",
        "infrastructureCapexCents",
        "downPaymentPct",
        "interestRatePct",
        "amortizationYears",
        "marketCapRatePct",
      ].sort(),
    );
  });
  it("occupancy is a required input — never assumed", () => {
    expect(PARK_ACQUISITION_FIELDS.find((f) => f.key === "occupiedLots")?.optional).toBeFalsy();
  });
});
