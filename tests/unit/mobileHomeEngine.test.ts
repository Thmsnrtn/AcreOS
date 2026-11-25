/**
 * The mobile-home park acquisition engine, pinned by hand-computed figures.
 *
 * Golden case (recorded-style fixtures — the flattened form of the recorded
 * pads, their recorded lot rents, the recorded POH home rents, a recorded
 * utility billback recovery and the measured expense ledger):
 *   price            $500,000 operator-entered
 *   closing          $5,000
 *   pads             50 recorded, 45 occupied (10 park-owned, 35 tenant-owned)
 *   lot rent         45 × $400/mo recorded          = $18,000/mo
 *   POH home rent    10 × $350/mo recorded          = $3,500/mo
 *   utility recovery $900/mo from recorded billback statements
 *   measured op-ex   $8,000/mo, 36 rows over 12 months
 *   financing        25% down, 0% recorded rate, 25-year amortisation
 *   EGI        = (18,000 + 3,500 + 900) × 12        = $268,800
 *   NOI        = 268,800 − 96,000                   = $172,800
 *   cap rate   = 172,800 / 500,000                  = 34.56%
 *   OER        = 96,000 / 268,800                   ≈ 35.71%
 *   loan       = $375,000 → payment 375,000/300     = $1,250/mo
 *   debt svc   = $15,000/yr
 *   profit     = 172,800 − 15,000                   = $157,800
 *   cash req'd = 125,000 + 5,000                    = $130,000
 *   cash-on-cash = 157,800 / 130,000                ≈ 121.38%
 *   occupancy  = 45 / 50                            = 90%
 */
import { describe, expect, it } from "vitest";
import {
  computeScenario,
  metricValue,
  ScenarioEngineError,
} from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { mobileHomeAcquisitionEngine } from "../../server/services/economics/engines/mobileHomeAcquisition";

const golden = {
  purchasePriceCents: 50_000_000,
  closingCostsCents: 500_000,
  lotCount: 50,
  occupiedLotCount: 45,
  parkOwnedHomeCount: 10,
  monthlyLotRentCents: 1_800_000,
  monthlyPohHomeRentCents: 350_000,
  utilityRecoveryMonthlyCents: 90_000,
  measuredOpExRowCount: 36,
  measuredOpExMonthsCovered: 12,
  measuredOpExMonthlyCents: 800_000,
  downPaymentPct: 25,
  interestRatePct: 0,
  amortizationYears: 25,
};

function run(inputs: Record<string, number | string>) {
  return computeScenario(
    { subjectType: "property", subjectId: 1, label: "t", engineId: "mobile_home_acquisition", inputs },
    ALL_ENGINES,
  );
}

describe("the registered engine", () => {
  it("is in ALL_ENGINES and declares mobile_home — and only mobile_home", () => {
    expect(ALL_ENGINES.find((e) => e.id === "mobile_home_acquisition")).toBe(
      mobileHomeAcquisitionEngine,
    );
    expect(mobileHomeAcquisitionEngine.verticals).toEqual(["mobile_home"]);
  });

  it("emits every metric it declares, so a decision citing it is gradeable", () => {
    const body = run(golden);
    expect(body.metrics.map((m) => m.id).sort()).toEqual(
      [...mobileHomeAcquisitionEngine.produces].sort(),
    );
    expect(body.engineVersion).toBe(mobileHomeAcquisitionEngine.version);
  });

  it("is deterministic: same recorded inputs, same body out", () => {
    expect(run(golden)).toEqual(run(golden));
  });
});

describe("the golden case", () => {
  const body = run(golden);
  it("income, NOI and cap rate on the operator-entered price", () => {
    expect(metricValue(body, "effective_gross_income")).toBe(26_880_000);
    expect(metricValue(body, "annual_noi")).toBe(17_280_000);
    expect(metricValue(body, "cap_rate")).toBeCloseTo(0.3456, 8);
    expect(metricValue(body, "annual_operating_expense")).toBe(9_600_000);
    expect(metricValue(body, "operating_expense_ratio")).toBeCloseTo(0.357143, 5);
    expect(metricValue(body, "utility_recoveries_annual")).toBe(1_080_000);
  });
  it("profit and cash-on-cash after the recorded financing", () => {
    expect(metricValue(body, "total_cost")).toBe(50_500_000);
    expect(metricValue(body, "cash_required")).toBe(13_000_000);
    expect(metricValue(body, "annual_debt_service")).toBe(1_500_000);
    expect(metricValue(body, "profit")).toBe(15_780_000);
    expect(metricValue(body, "monthly_cash_flow")).toBe(1_315_000);
    expect(metricValue(body, "cash_on_cash")).toBeCloseTo(1.213846, 5);
  });
  it("occupancy is the recorded share, nothing projected", () => {
    expect(metricValue(body, "occupancy_rate")).toBeCloseTo(0.9, 8);
  });
  it("declares the price basis, the no-comps rule and the mix as assumptions", () => {
    const keys = body.assumptions.map((a) => a.key);
    expect(keys).toContain("valuation_basis");
    expect(keys).toContain("no_comps");
    expect(keys).toContain("occupancy_basis");
    expect(keys).toContain("poh_toh_mix");
    expect(body.assumptions.find((a) => a.key === "valuation_basis")?.origin).toBe("user");
    const mix = body.assumptions.find((a) => a.key === "poh_toh_mix");
    expect(mix?.value).toContain("10 park-owned / 35 tenant-owned");
    expect(mix?.basis).toContain("no chattel, title or lien assertion");
  });
});

describe("financing", () => {
  it("all cash when no down payment is entered — declared, never silent", () => {
    const { downPaymentPct: _d, interestRatePct: _i, amortizationYears: _a, ...rest } = golden;
    const body = run(rest);
    expect(metricValue(body, "annual_debt_service")).toBe(0);
    expect(metricValue(body, "profit")).toBe(17_280_000);
    expect(metricValue(body, "cash_required")).toBe(50_500_000);
    expect(metricValue(body, "cash_on_cash")).toBeCloseTo(0.342178, 5);
    expect(body.assumptions.find((a) => a.key === "financing")?.value).toBe("all cash");
  });

  it("a positive recorded rate raises debt service above the 0% figure", () => {
    const body = run({ ...golden, interestRatePct: 7 });
    expect(metricValue(body, "annual_debt_service") as number).toBeGreaterThan(1_500_000);
    expect(metricValue(body, "profit") as number).toBeLessThan(15_780_000);
  });

  it("a loan with no recorded terms is refused, not assumed", () => {
    const { interestRatePct: _i, amortizationYears: _a, ...rest } = golden;
    expect(() => run(rest)).toThrow(/no debt service this engine will assume/);
  });

  it("100% down is the operator's own all-cash answer and needs no loan terms", () => {
    const { interestRatePct: _i, amortizationYears: _a, ...rest } = golden;
    const body = run({ ...rest, downPaymentPct: 100 });
    expect(metricValue(body, "annual_debt_service")).toBe(0);
    expect(metricValue(body, "cash_required")).toBe(50_500_000);
  });
});

describe("utility pass-through recovery", () => {
  it("recorded recoveries raise income; unrecorded recoveries are excluded, never assumed", () => {
    const { utilityRecoveryMonthlyCents: _u, ...rest } = golden;
    const body = run(rest);
    expect(metricValue(body, "effective_gross_income")).toBe(25_800_000);
    expect(metricValue(body, "utility_recoveries_annual")).toBeNull();
    expect(body.assumptions.map((a) => a.key)).toContain("utility_recoveries");
  });
});

describe("an all-TOH park", () => {
  it("underwrites on lot rent alone with no home-rent input", () => {
    const { monthlyPohHomeRentCents: _h, ...rest } = golden;
    const body = run({ ...rest, parkOwnedHomeCount: 0 });
    // Income = (18,000 + 900) × 12; NOI = that − 96,000.
    expect(metricValue(body, "effective_gross_income")).toBe(22_680_000);
    expect(metricValue(body, "annual_noi")).toBe(13_080_000);
    expect(
      body.assumptions.find((a) => a.key === "poh_toh_mix")?.value,
    ).toContain("0 park-owned / 45 tenant-owned");
  });
});

describe("the refusal legs", () => {
  it("unmeasured op-ex: NOI, cap rate, profit and cash-on-cash are null — no rule-of-thumb ratio for a park", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    const body = run({ ...rest, measuredOpExRowCount: 0, measuredOpExMonthsCovered: 0 });
    expect(metricValue(body, "annual_noi")).toBeNull();
    expect(metricValue(body, "cap_rate")).toBeNull();
    expect(metricValue(body, "annual_operating_expense")).toBeNull();
    expect(metricValue(body, "operating_expense_ratio")).toBeNull();
    expect(metricValue(body, "profit")).toBeNull();
    expect(metricValue(body, "cash_on_cash")).toBeNull();
    // Income does not depend on op-ex and still computes.
    expect(metricValue(body, "effective_gross_income")).toBe(26_880_000);
    const refusal = body.assumptions.find((a) => a.key === "operating_expense");
    expect(refusal?.value).toContain("refused");
  });

  it("an operator-supplied ratio is the operator's own answer and does compute", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    const body = run({ ...rest, measuredOpExRowCount: 0, measuredOpExMonthsCovered: 0, opExBps: 3000 });
    // 30% of $22,400/mo income = $6,720/mo op-ex → NOI = $188,160/yr.
    expect(metricValue(body, "annual_noi")).toBe(18_816_000);
    expect(body.assumptions.find((a) => a.key === "operating_expense")?.origin).toBe("user");
  });

  it("measured rows without a measured figure are refused", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    expect(() => run(rest)).toThrow(/measuredOpExMonthlyCents is required/);
  });

  it("missing price is refused — there is no fallback denominator", () => {
    const { purchasePriceCents: _p, ...rest } = golden;
    expect(() => run(rest)).toThrow(ScenarioEngineError);
    expect(() => run({ ...golden, purchasePriceCents: 0 })).toThrow(/positive/);
    expect(() => run({ ...golden, purchasePriceCents: 1.5 })).toThrow(/integer/);
  });

  it("no recorded pads, or pads with no recorded occupancy, are refused", () => {
    expect(() => run({ ...golden, lotCount: 0 })).toThrow(/No recorded pads/);
    expect(() => run({ ...golden, occupiedLotCount: 0, parkOwnedHomeCount: 0 })).toThrow(
      /No recorded occupancy/,
    );
    const { lotCount: _l, ...rest } = golden;
    expect(() => run(rest)).toThrow(ScenarioEngineError);
  });

  it("counts that contradict the recorded pads are refused as incoherent", () => {
    expect(() => run({ ...golden, occupiedLotCount: 51 })).toThrow(/cannot exceed/);
    expect(() => run({ ...golden, parkOwnedHomeCount: 46 })).toThrow(/cannot exceed/);
    expect(() => run({ ...golden, lotCount: 50.5 })).toThrow(/non-negative integer/);
  });

  it("no recorded lot rent is refused — there is no income to underwrite", () => {
    expect(() => run({ ...golden, monthlyLotRentCents: 0 })).toThrow(/No recorded lot rent/);
    const { monthlyLotRentCents: _r, ...rest } = golden;
    expect(() => run(rest)).toThrow(ScenarioEngineError);
  });

  it("POH pads with only a lump sum are refused — the split is never invented", () => {
    const { monthlyPohHomeRentCents: _h, ...rest } = golden;
    expect(() => run(rest)).toThrow(/no split this engine will invent/);
  });

  it("home rent with no recorded park-owned home is refused as incoherent", () => {
    expect(() => run({ ...golden, parkOwnedHomeCount: 0 })).toThrow(/incoherent/);
  });

  it("negative recorded figures are refused", () => {
    expect(() => run({ ...golden, utilityRecoveryMonthlyCents: -1 })).toThrow(/negative/);
    expect(() => run({ ...golden, monthlyLotRentCents: -1 })).toThrow(/negative/);
    expect(() => run({ ...golden, opExBps: 10001 })).toThrow(/between 0 and 10000/);
  });
});

describe("thin measured coverage is disclosed", () => {
  it("measured op-ex covering 3 of 12 months carries the coverage assumption", () => {
    const body = run({ ...golden, measuredOpExMonthsCovered: 3 });
    expect(metricValue(body, "annual_noi")).toBe(17_280_000);
    expect(body.assumptions.map((a) => a.key)).toContain("operating_expense_coverage");
  });
});

describe("omitted closing costs are excluded, and declared", () => {
  it("total cost falls back to the price alone with the exclusion on the record", () => {
    const { closingCostsCents: _c, ...rest } = golden;
    const body = run(rest);
    expect(metricValue(body, "total_cost")).toBe(50_000_000);
    expect(body.assumptions.find((a) => a.key === "closing_costs")?.value).toContain(
      "excluded",
    );
  });
});
