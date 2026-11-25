/**
 * The short-term-rental acquisition/hold engine, pinned by hand-computed
 * figures.
 *
 * Golden case: $300,000 price, $6,000 closing, $180 ADR, 60% occupancy,
 * $75 guest fees per stay, $120 cleaning cost per stay, 15% platform fee,
 * 3-night average stay, $9,000/yr fixed expenses, 25% down, 7%, 30 years.
 *   booked nights = 365 × 0.60                       = 219
 *   stays/year    = 219 ÷ 3                          = 73
 *   gross room    = 219 × $180                       = $39,420
 *   guest fees    = 73 × $75                         = $5,475
 *   EGI                                              = $44,895
 *   platform fee  = 15% × $39,420                    = $5,913
 *   cleaning      = 73 × $120                        = $8,760
 *   opex          = 5,913 + 8,760 + 9,000            = $23,673
 *   NOI           = 44,895 − 23,673                  = $21,222
 *   total cost    = 300,000 + 6,000                  = $306,000
 *   cash required = 75,000 down + 6,000              = $81,000
 *   cap rate      = 21,222 / 300,000                 = 7.074%
 *   GRM           = 300,000 / 39,420                 ≈ 7.61
 *
 * Every input is operator-entered. There is no market ADR anywhere in this
 * file or the engine — each missing-input leg below is a refusal, and that
 * refusal IS the residential-comps / no-fabrication fence doing its job.
 */
import { describe, expect, it } from "vitest";
import { computeStrAcquisition, type StrAcquisitionInputs } from "../../shared/calculators/strAcquisition";
import { monthlyPaymentCents } from "../../shared/calculators/finance";
import { strAcquisitionEngine } from "../../server/services/economics/engines/strAcquisition";
import { computeScenario, engineById, metricValue, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";

const golden: StrAcquisitionInputs = {
  purchasePriceCents: 30_000_000,
  closingCostsCents: 600_000,
  adrCents: 18_000,
  occupancyPct: 60,
  guestFeesPerStayCents: 7_500,
  cleaningCostPerStayCents: 12_000,
  platformFeePct: 15,
  averageStayNights: 3,
  annualFixedExpensesCents: 900_000,
  downPaymentPct: 25,
  interestRatePct: 7,
  amortizationYears: 30,
};

const wire: Record<string, number> = { ...golden };

function scenario(inputs: Record<string, number>) {
  return computeScenario(
    { subjectType: "property", subjectId: 1, label: "t", engineId: "str_acquisition", inputs },
    ALL_ENGINES,
  );
}

describe("computeStrAcquisition — golden case", () => {
  const o = computeStrAcquisition(golden);
  it("nights, stays and revenue", () => {
    expect(o.bookedNights).toBe(219);
    expect(o.staysPerYear).toBe(73);
    expect(o.grossRoomRevenueCents).toBe(3_942_000);
    expect(o.effectiveGrossIncomeCents).toBe(4_489_500);
  });
  it("platform fee is on room revenue only; cleaning is per stay", () => {
    // 591,300 platform + 876,000 cleaning + 900,000 fixed.
    expect(o.annualOperatingExpenseCents).toBe(2_367_300);
    expect(o.annualNoiCents).toBe(2_122_200);
  });
  it("costs, cash and debt", () => {
    expect(o.totalCostCents).toBe(30_600_000);
    expect(o.cashRequiredCents).toBe(8_100_000);
    expect(o.annualDebtServiceCents).toBe(monthlyPaymentCents(22_500_000, 7, 30) * 12);
    expect(o.monthlyCashFlowCents).toBe(Math.round((o.annualNoiCents - o.annualDebtServiceCents) / 12));
  });
  it("ratios", () => {
    expect(o.capRate).toBeCloseTo(0.07074, 6);
    expect(o.cashOnCash).toBeCloseTo((2_122_200 - o.annualDebtServiceCents) / 8_100_000, 8);
    expect(o.dscr).toBeCloseTo(2_122_200 / o.annualDebtServiceCents, 6);
    expect(o.operatingExpenseRatio).toBeCloseTo(2_367_300 / 4_489_500, 6);
    expect(o.grossRentMultiplier).toBeCloseTo(30_000_000 / 3_942_000, 6);
  });
});

describe("computeStrAcquisition — the honest edges", () => {
  it("all cash: no debt service, no DSCR, cash required is price + closing", () => {
    const o = computeStrAcquisition({ ...golden, downPaymentPct: null, interestRatePct: null, amortizationYears: null });
    expect(o.financed).toBe(false);
    expect(o.annualDebtServiceCents).toBe(0);
    expect(o.dscr).toBeNull();
    expect(o.cashRequiredCents).toBe(30_600_000);
    expect(o.cashOnCash).toBeCloseTo(2_122_200 / 30_600_000, 8);
  });
  it("zero occupancy: no revenue, expense ratio and GRM are null — never 0% or 0x", () => {
    const o = computeStrAcquisition({ ...golden, occupancyPct: 0 });
    expect(o.effectiveGrossIncomeCents).toBe(0);
    expect(o.operatingExpenseRatio).toBeNull();
    expect(o.grossRentMultiplier).toBeNull();
    expect(o.annualNoiCents).toBe(-900_000);
  });
  it("a financed purchase without terms is refused, not guessed", () => {
    expect(() => computeStrAcquisition({ ...golden, interestRatePct: null })).toThrow(/interest rate/);
  });
  it("out-of-range and negative inputs are refused", () => {
    expect(() => computeStrAcquisition({ ...golden, occupancyPct: 120 })).toThrow(/occupancyPct/);
    expect(() => computeStrAcquisition({ ...golden, platformFeePct: -1 })).toThrow(/platformFeePct/);
    expect(() => computeStrAcquisition({ ...golden, cleaningCostPerStayCents: -1 })).toThrow(/cleaningCostPerStayCents/);
    expect(() => computeStrAcquisition({ ...golden, adrCents: 0 })).toThrow(/ADR/);
    expect(() => computeStrAcquisition({ ...golden, averageStayNights: 0 })).toThrow(/averageStayNights/);
  });
});

describe("strAcquisitionEngine — registration and scenario output", () => {
  it("is in ALL_ENGINES, declaring short_term_rental", () => {
    expect(ALL_ENGINES.find((e) => e.id === "str_acquisition")).toBe(strAcquisitionEngine);
    expect(engineById("str_acquisition", ALL_ENGINES)?.verticals).toContain("short_term_rental");
  });
  it("produces a gradeable scenario: versioned engine, verbatim inputs, declared assumptions", () => {
    const body = scenario(wire);
    expect(body.engineId).toBe("str_acquisition");
    expect(body.engineVersion).toBe("str-acquisition-1");
    expect(body.inputs).toEqual(wire);
    expect(metricValue(body, "annual_noi")).toBe(2_122_200);
    expect(metricValue(body, "cash_on_cash")).not.toBeNull();
    const adr = body.assumptions.find((a) => a.key === "adr");
    expect(adr?.origin).toBe("user");
    expect(adr?.basis).toMatch(/No market ADR/);
  });
  it("an omitted down payment is declared as the all-cash substitution", () => {
    const { downPaymentPct: _d, interestRatePct: _r, amortizationYears: _a, ...cashWire } = wire;
    const body = scenario(cashWire);
    expect(body.assumptions.find((a) => a.key === "financing")?.value).toBe("all cash");
    expect(metricValue(body, "dscr")).toBeNull();
  });
  it("fractional cents are refused", () => {
    expect(() => scenario({ ...wire, adrCents: 18000.5 })).toThrow(/integer/);
  });
});

describe("strAcquisitionEngine — EVERY required input refuses when absent", () => {
  const required = [
    "purchasePriceCents",
    "closingCostsCents",
    "adrCents",
    "occupancyPct",
    "guestFeesPerStayCents",
    "cleaningCostPerStayCents",
    "platformFeePct",
    "averageStayNights",
    "annualFixedExpensesCents",
  ] as const;
  for (const key of required) {
    it(`missing ${key} refuses, naming the input`, () => {
      const inputs: Record<string, number> = { ...wire };
      delete inputs[key];
      expect(() => scenario(inputs)).toThrow(ScenarioEngineError);
      expect(() => scenario(inputs)).toThrow(new RegExp(key));
    });
  }
});
