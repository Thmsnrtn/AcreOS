// ============================================================================
// tests/unit/runwayModel.test.ts
// ----------------------------------------------------------------------------
// LENA #1 — the runway-to-zero scenario math. Tests the PURE exported helpers
// (projectMonthsToZero + buildScenarios) so the three-scenario arithmetic is
// proven without a database.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  projectMonthsToZero,
  buildScenarios,
  DOWNSIDE_COST_MULTIPLIER,
  RUNWAY_CAP_MONTHS,
} from "../../server/services/finance/runwayModel";

describe("projectMonthsToZero", () => {
  it("divides cash by net monthly burn", () => {
    // $12,000 cash, $1,000/mo net burn → 12 months.
    expect(projectMonthsToZero(12_000, 1_000)).toBe(12);
  });

  it("returns null when there is no cash basis (cash <= 0)", () => {
    expect(projectMonthsToZero(0, 1_000)).toBeNull();
    expect(projectMonthsToZero(-500, 1_000)).toBeNull();
  });

  it("caps unbounded runway when net burn is <= 0 (cash-positive)", () => {
    // MRR exceeds costs → net burn negative → company never runs out.
    expect(projectMonthsToZero(12_000, -200)).toBe(RUNWAY_CAP_MONTHS);
    expect(projectMonthsToZero(12_000, 0)).toBe(RUNWAY_CAP_MONTHS);
  });

  it("caps a very long but finite runway at RUNWAY_CAP_MONTHS", () => {
    // $1,200,000 cash, $1/mo burn would be 1.2M months → capped.
    expect(projectMonthsToZero(1_200_000, 1)).toBe(RUNWAY_CAP_MONTHS);
  });

  it("guards against non-finite inputs", () => {
    expect(projectMonthsToZero(NaN, 1_000)).toBeNull();
    expect(projectMonthsToZero(12_000, NaN)).toBe(RUNWAY_CAP_MONTHS);
  });
});

describe("buildScenarios", () => {
  // A pre-revenue company: $24,000 cash, $2,000/mo costs, $0 MRR, no growth.
  const preRevenue = {
    cashUsd: 24_000,
    cashUsdPriorWeek: 24_500,
    monthlyCostsUsd: 2_000,
    monthlyCostsPriorWeekUsd: 2_000,
    mrrUsd: 0,
    mrrPriorWeekUsd: 0,
    wowMrrGrowthRate: 0,
  };

  it("base = cash / costs when MRR is zero", () => {
    const { base } = buildScenarios(preRevenue);
    // 24000 / 2000 = 12 months.
    expect(base.monthsToZero).toBe(12);
    expect(base.netMonthlyBurnUsd).toBe(2_000);
    expect(base.mrrUsd).toBe(0);
  });

  it("downside applies the +20% cost multiplier and holds MRR flat", () => {
    const { downside } = buildScenarios(preRevenue);
    // costs 2000 * 1.2 = 2400 → 24000 / 2400 = 10 months.
    expect(downside.monthlyCostsUsd).toBe(2_000 * DOWNSIDE_COST_MULTIPLIER);
    expect(downside.monthsToZero).toBe(10);
    // shorter than base — the stress case must never be rosier.
    expect(downside.monthsToZero!).toBeLessThan(
      buildScenarios(preRevenue).base.monthsToZero!,
    );
  });

  it("upside is never shorter than base (more MRR offset = longer runway)", () => {
    const withGrowth = {
      ...preRevenue,
      mrrUsd: 500,
      mrrPriorWeekUsd: 400,
      wowMrrGrowthRate: 0.25, // +25%/wk
    };
    const { base, upside, downside } = buildScenarios(withGrowth);
    // base net burn = 2000 - 500 = 1500 → 16 months.
    expect(base.netMonthlyBurnUsd).toBe(1_500);
    expect(base.monthsToZero).toBe(16);
    // upside MRR = 500 * (1 + 0.25*4) = 500 * 2 = 1000 → net burn 1000 → 24mo.
    expect(upside.mrrUsd).toBe(1_000);
    expect(upside.monthsToZero!).toBeGreaterThanOrEqual(base.monthsToZero!);
    // ordering invariant: downside <= base <= upside.
    expect(downside.monthsToZero!).toBeLessThanOrEqual(base.monthsToZero!);
  });

  it("computes a WoW delta from the prior-week cash snapshot", () => {
    const { base } = buildScenarios(preRevenue);
    // prior: 24500 / 2000 = 12.25 ; now: 12 ; delta = -0.25 (runway shortened).
    expect(base.monthsToZeroPriorWeek).toBe(12.25);
    expect(base.wowDeltaMonths).toBe(-0.25);
  });

  it("net cash-positive company shows the capped ceiling, not Infinity", () => {
    const cashPositive = {
      ...preRevenue,
      mrrUsd: 5_000, // MRR > costs
    };
    const { base } = buildScenarios(cashPositive);
    expect(base.netMonthlyBurnUsd).toBeLessThan(0);
    expect(base.monthsToZero).toBe(RUNWAY_CAP_MONTHS);
  });
});
