/**
 * Realized-vs-forecast grading (fix-and-flip package, Leg 4, §8.3 #14).
 *
 * Every figure below is hand-computed. A missing input yields null and a named
 * exclusion — never an estimate, never a zero.
 */
import { describe, expect, it } from "vitest";
import { gradeRealized, type RealizedGradeInput } from "../../shared/rehab/realized";

const SCENARIO = { arvCents: 32_000_000, profitCents: 8_000_000, roiRatio: 0.4, holdMonths: 5 };

function input(over: Partial<RealizedGradeInput> = {}): RealizedGradeInput {
  return {
    facts: { salePriceCents: 30_000_000, sellingCostsCents: 1_500_000, closingDate: "2026-03-31" },
    purchasePriceCents: 12_000_000,
    purchaseClosingCents: 240_000,
    rehabSpentCents: 6_000_000,
    rehabLineCount: 3,
    holdingEntriesTotalCents: 900_000,
    holdingEntryCount: 2,
    startedAt: "2025-10-01",
    scenario: { ...SCENARIO },
    ...over,
  };
}

describe("gradeRealized — the full case", () => {
  const g = gradeRealized(input());

  it("derives hold days from the recorded start and closing dates", () => {
    // Oct 31 + Nov 30 + Dec 31 + Jan 31 + Feb 28 + Mar 31 = 182 days from Oct 1 → Apr 1; Mar 31 is one day earlier.
    expect(g.holdDays).toBe(181);
  });

  it("computes the realized net from recorded facts only", () => {
    // 30_000_000 − 1_500_000 − 12_000_000 − 240_000 − 6_000_000 − 900_000
    expect(g.realizedNetCents).toBe(9_360_000);
    expect(g.netMissing).toEqual([]);
  });

  it("computes invested and realized ROI", () => {
    expect(g.investedCents).toBe(19_140_000); // 12_000_000 + 240_000 + 6_000_000 + 900_000
    expect(g.investedParts).toEqual({ purchaseCents: 12_000_000, purchaseClosingCents: 240_000, rehabSpentCents: 6_000_000, holdingRecordedCents: 900_000 });
    expect(g.realizedRoiRatio).toBeCloseTo(9_360_000 / 19_140_000, 10);
  });

  it("states each delta as a plain difference from the scenario", () => {
    expect(g.deltas.saleVsArvCents).toBe(-2_000_000); // 30_000_000 − 32_000_000
    expect(g.deltas.holdDaysVsScenarioDays).toBe(31); // 181 − 5×30
    expect(g.deltas.netVsScenarioProfitCents).toBe(1_360_000); // 9_360_000 − 8_000_000
    expect(g.deltas.roiVsScenarioRatio).toBeCloseTo(9_360_000 / 19_140_000 - 0.4, 10);
  });
});

describe("gradeRealized — a missing input is null and named, never estimated", () => {
  it("missing purchase price: net/ROI/net-delta null, sale and hold deltas still computed", () => {
    const g = gradeRealized(input({ purchasePriceCents: null }));
    expect(g.realizedNetCents).toBeNull();
    expect(g.netMissing).toContain("purchase price");
    expect(g.investedCents).toBeNull();
    expect(g.realizedRoiRatio).toBeNull();
    expect(g.deltas.netVsScenarioProfitCents).toBeNull();
    expect(g.deltas.roiVsScenarioRatio).toBeNull();
    expect(g.deltas.saleVsArvCents).toBe(-2_000_000);
    expect(g.deltas.holdDaysVsScenarioDays).toBe(31);
  });

  it("zero holding entries: net null, naming recorded holding costs", () => {
    const g = gradeRealized(input({ holdingEntryCount: 0, holdingEntriesTotalCents: 0 }));
    expect(g.realizedNetCents).toBeNull();
    expect(g.netMissing).toEqual(["recorded holding costs"]);
    expect(g.investedParts.holdingRecordedCents).toBeNull();
  });

  it("a 0-sum WITH entries present (a +100/−100 pair) still computes the net", () => {
    const g = gradeRealized(input({ holdingEntryCount: 2, holdingEntriesTotalCents: 0 }));
    expect(g.netMissing).toEqual([]);
    expect(g.investedParts.holdingRecordedCents).toBe(0);
    // 30_000_000 − 1_500_000 − 12_000_000 − 240_000 − 6_000_000 − 0
    expect(g.realizedNetCents).toBe(10_260_000);
    expect(g.investedCents).toBe(18_240_000);
    expect(g.realizedRoiRatio).toBeCloseTo(10_260_000 / 18_240_000, 10);
  });

  it("missing purchase closing costs: net/ROI/invested null, named — never zeroed (FF-DEF-2)", () => {
    const g = gradeRealized(input({ purchaseClosingCents: null }));
    expect(g.realizedNetCents).toBeNull();
    expect(g.netMissing).toEqual(["purchase closing costs"]);
    expect(g.investedCents).toBeNull();
    expect(g.investedParts.purchaseClosingCents).toBeNull();
    expect(g.realizedRoiRatio).toBeNull();
    expect(g.deltas.netVsScenarioProfitCents).toBeNull();
    expect(g.deltas.saleVsArvCents).toBe(-2_000_000);
  });

  it("zero rehab lines: net null, naming rehab scope lines", () => {
    const g = gradeRealized(input({ rehabLineCount: 0, rehabSpentCents: 0 }));
    expect(g.realizedNetCents).toBeNull();
    expect(g.netMissing).toEqual(["rehab scope lines"]);
  });

  it("names every missing component at once", () => {
    const g = gradeRealized(input({ purchasePriceCents: null, purchaseClosingCents: null, holdingEntryCount: 0, rehabLineCount: 0 }));
    expect(g.netMissing).toEqual(["purchase price", "purchase closing costs", "recorded holding costs", "rehab scope lines"]);
    expect(g.realizedNetCents).toBeNull();
  });

  it("no start date: hold days and the hold delta are null; the net still computes", () => {
    const g = gradeRealized(input({ startedAt: null }));
    expect(g.holdDays).toBeNull();
    expect(g.deltas.holdDaysVsScenarioDays).toBeNull();
    expect(g.realizedNetCents).toBe(9_360_000);
  });
});

describe("gradeRealized — the scenario side", () => {
  it("no scenario: all four deltas null; net and ROI still computed", () => {
    const g = gradeRealized(input({ scenario: null }));
    expect(g.deltas).toEqual({
      saleVsArvCents: null,
      holdDaysVsScenarioDays: null,
      netVsScenarioProfitCents: null,
      roiVsScenarioRatio: null,
    });
    expect(g.realizedNetCents).toBe(9_360_000);
    expect(g.realizedRoiRatio).toBeCloseTo(9_360_000 / 19_140_000, 10);
    expect(g.holdDays).toBe(181);
  });

  it("a null profit nulls only the net delta", () => {
    const g = gradeRealized(input({ scenario: { ...SCENARIO, profitCents: null } }));
    expect(g.deltas.netVsScenarioProfitCents).toBeNull();
    expect(g.deltas.saleVsArvCents).toBe(-2_000_000);
    expect(g.deltas.holdDaysVsScenarioDays).toBe(31);
    expect(g.deltas.roiVsScenarioRatio).not.toBeNull();
  });

  it("a null ARV nulls only the sale delta", () => {
    const g = gradeRealized(input({ scenario: { ...SCENARIO, arvCents: null } }));
    expect(g.deltas.saleVsArvCents).toBeNull();
    expect(g.deltas.netVsScenarioProfitCents).toBe(1_360_000);
  });

  it("a null ROI nulls only the ROI delta", () => {
    const g = gradeRealized(input({ scenario: { ...SCENARIO, roiRatio: null } }));
    expect(g.deltas.roiVsScenarioRatio).toBeNull();
    expect(g.deltas.netVsScenarioProfitCents).toBe(1_360_000);
  });

  it("a null hold months nulls only the hold delta", () => {
    const g = gradeRealized(input({ scenario: { ...SCENARIO, holdMonths: null } }));
    expect(g.deltas.holdDaysVsScenarioDays).toBeNull();
    expect(g.deltas.saleVsArvCents).toBe(-2_000_000);
  });
});

describe("gradeRealized — FF-DEF-2: forecast and realized on the same basis (the 2026-11-20 walk's figures)", () => {
  // The walk (org 128, rehab on 1247 Cherokee Pl): purchase $130,000 with
  // $2,600 recorded purchase closing costs; rehab spent $15,500; recorded
  // holding $3,750; sold $289,000 with $20,230 selling costs. The frozen
  // flip_mao scenario forecast profit $61,250 on total_cost $204,100 — a
  // total that INCLUDES the $2,600 closing (price + rehab-with-contingency
  // $71,500 + closing $2,600), per computeMao's totalCashInCents.
  const g = gradeRealized({
    facts: { salePriceCents: 28_900_000, sellingCostsCents: 2_023_000, closingDate: "2026-11-20" },
    purchasePriceCents: 13_000_000,
    purchaseClosingCents: 260_000,
    rehabSpentCents: 1_550_000,
    rehabLineCount: 12,
    holdingEntriesTotalCents: 375_000,
    holdingEntryCount: 3,
    startedAt: "2026-11-23",
    scenario: { arvCents: 29_500_000, profitCents: 6_125_000, roiRatio: 0.3, holdMonths: 6 },
  });

  it("invested includes the purchase closing, like the forecast's total_cost does", () => {
    // 13_000_000 + 260_000 + 1_550_000 + 375_000 = $151,850 (pre-cure: $149,250)
    expect(g.investedCents).toBe(15_185_000);
    expect(g.investedParts).toEqual({
      purchaseCents: 13_000_000,
      purchaseClosingCents: 260_000,
      rehabSpentCents: 1_550_000,
      holdingRecordedCents: 375_000,
    });
  });

  it("net and ROI are recomputed on that same basis", () => {
    // 28_900_000 − 2_023_000 − 15_185_000 = $116,920 (pre-cure: $119,520)
    expect(g.realizedNetCents).toBe(11_692_000);
    expect(g.realizedRoiRatio).toBeCloseTo(11_692_000 / 15_185_000, 10);
  });

  it("the net-vs-scenario delta is the like-for-like figure, not overstated by the closing amount", () => {
    // 11_692_000 − 6_125_000 = +$55,670 (pre-cure it read +$58,270 — exactly $2,600 high)
    expect(g.deltas.netVsScenarioProfitCents).toBe(5_567_000);
    expect(g.deltas.saleVsArvCents).toBe(-600_000);
  });
});
