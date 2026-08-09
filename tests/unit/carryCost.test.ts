/**
 * Carry-cost engine (developer vertical, Stage 1c) — the carry of a plat in the
 * county queue, projected honestly. A subdivider BIDS on this number, so:
 *   • p50/p90 carry is the linear projection of recorded costs over the county
 *     lead time (holding by the month, debt + opportunity by months ÷ 12);
 *   • a null lead time yields a null projection — the timeline is NEVER assumed;
 *   • timelineFound tells "no timeline on file" apart from a real zero.
 */
import { describe, it, expect } from "vitest";
import {
  projectCarryCost,
  projectCarryForMonths,
  type CarryCostInputs,
} from "../../shared/subdivision/carryCost";

function inputs(overrides: Partial<CarryCostInputs> = {}): CarryCostInputs {
  return {
    holdingCostMonthlyCents: 1_000_000, // $10,000/mo
    debtPrincipalCents: 100_000_000, // $1,000,000
    debtRateBps: 800, // 8%/yr → $80,000/yr debt interest
    purchaseBasisCents: 50_000_000, // $500,000
    opportunityCostBps: 800, // 8%/yr → $40,000/yr opportunity
    ...overrides,
  };
}

describe("projectCarryForMonths — the linear carry math", () => {
  it("returns null when the month count is unknown (no timeline)", () => {
    expect(projectCarryForMonths(null, inputs())).toBeNull();
  });

  it("scales holding by the month and debt/opportunity by months ÷ 12", () => {
    // 14 months: holding 14×$10k = $140k; debt $80k/yr × 14/12 = $93,333.33;
    // opportunity $40k/yr × 14/12 = $46,666.67. Total = $280,000.
    const p = projectCarryForMonths(14, inputs());
    expect(p).not.toBeNull();
    expect(p!.months).toBe(14);
    expect(p!.holdingCostCents).toBe(14_000_000);
    expect(p!.debtInterestCents).toBe(9_333_333);
    expect(p!.opportunityCostCents).toBe(4_666_667);
    expect(p!.totalCarryCents).toBe(28_000_000);
  });

  it("is holding-only when there is no debt and no opportunity cost", () => {
    const p = projectCarryForMonths(4, inputs({ debtPrincipalCents: 0, purchaseBasisCents: 0 }));
    expect(p!.holdingCostCents).toBe(4_000_000);
    expect(p!.debtInterestCents).toBe(0);
    expect(p!.opportunityCostCents).toBe(0);
    expect(p!.totalCarryCents).toBe(4_000_000);
  });
});

describe("projectCarryCost — p50/p90 over county lead-days", () => {
  it("projects both percentiles independently over seeded lead-days", () => {
    // p50 = 420 days = 14 months; p90 = 600 days = 20 months.
    const r = projectCarryCost({ p50TotalDays: 420, p90TotalDays: 600, inputs: inputs() });
    expect(r.timelineFound).toBe(true);
    expect(r.p50!.months).toBe(14);
    expect(r.p50!.totalCarryCents).toBe(28_000_000);
    expect(r.p90!.months).toBe(20);
    // p90: holding 20×$10k = $200k; debt $80k×20/12 = $133,333.33; opp $40k×20/12 = $66,666.67.
    expect(r.p90!.holdingCostCents).toBe(20_000_000);
    expect(r.p90!.debtInterestCents).toBe(13_333_333);
    expect(r.p90!.opportunityCostCents).toBe(6_666_667);
    expect(r.p90!.totalCarryCents).toBe(40_000_000);
  });

  it("timeline-not-found path: both lead times null → timelineFound false, both projections null", () => {
    const r = projectCarryCost({ p50TotalDays: null, p90TotalDays: null, inputs: inputs() });
    expect(r.timelineFound).toBe(false);
    expect(r.p50).toBeNull();
    expect(r.p90).toBeNull();
  });

  it("projects the percentile that IS known and leaves the unknown one null", () => {
    const r = projectCarryCost({ p50TotalDays: 420, p90TotalDays: null, inputs: inputs() });
    expect(r.timelineFound).toBe(true);
    expect(r.p50).not.toBeNull();
    expect(r.p90).toBeNull();
  });
});
