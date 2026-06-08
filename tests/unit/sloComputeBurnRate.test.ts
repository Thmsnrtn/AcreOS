/**
 * Burn-rate window math tests (Tess #3 — burn-rate SLO alerting).
 *
 * Locks in the multi-window burn-rate arithmetic that powers the 5-minute
 * worker job. The job pages on fast-burn (≥2% of the monthly error budget
 * burned in 1h) and warns on slow-burn (≥10% in 6h), so the % math has to be
 * exactly right — an off-by-projection error here either spams the founder's
 * phone or stays silent through a real outage.
 *
 * The DB-touching `aiSuccessBurnRate` / `jobSuccessBurnRate` wrappers are NOT
 * tested here (they only assemble counts and delegate); the pure
 * `computeBurnRateWindow` carries all the math and is fully covered.
 */

import { describe, it, expect } from "vitest";
import {
  computeBurnRateWindow,
  buildRequestSlo,
  classify,
  MONTH_MS,
} from "../../server/services/reliability/sloCompute";

const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

describe("computeBurnRateWindow", () => {
  it("reports zero burn when there are no failures", () => {
    const w = computeBurnRateWindow({
      sloId: "ai_request_success",
      target: 0.999,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 1000,
      failed: 0,
    });
    expect(w.observedFailureFraction).toBe(0);
    expect(w.allowedFailureFraction).toBeCloseTo(0.001, 10);
    expect(w.burnRate).toBe(0);
    expect(w.monthlyBudgetBurnedPct).toBe(0);
  });

  it("reports null burn rate and 0% when the window has no traffic", () => {
    const w = computeBurnRateWindow({
      sloId: "ai_request_success",
      target: 0.999,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 0,
      failed: 0,
    });
    expect(w.burnRate).toBeNull();
    expect(w.monthlyBudgetBurnedPct).toBe(0);
  });

  it("classic burn rate = observed/allowed (14.4x is the canonical fast pair)", () => {
    // 1.44% observed failure on a 0.1% allowance = 14.4x burn rate.
    const w = computeBurnRateWindow({
      sloId: "ai_request_success",
      target: 0.999,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 10000,
      failed: 144,
    });
    expect(w.burnRate).toBeCloseTo(14.4, 5);
  });

  it("monthlyBudgetBurnedPct projects window traffic onto a 30-day month", () => {
    // 1h window: monthly-equivalent total = total × (MONTH_MS / HOUR_MS) = ×720.
    // allowed fraction = 0.001 → monthlyAllowedFailures = 10000×720×0.001 = 7200.
    // burnedPct = failed / 7200 × 100. For failed=144 → 2.0%.
    const w = computeBurnRateWindow({
      sloId: "ai_request_success",
      target: 0.999,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 10000,
      failed: 144,
    });
    const ratio = MONTH_MS / HOUR_MS;
    expect(ratio).toBe(720);
    expect(w.monthlyBudgetBurnedPct).toBeCloseTo(2.0, 5);
  });

  it("fast-burn threshold: 2% of monthly budget in 1h is reached at the page line", () => {
    // Construct exactly the 2%-in-1h boundary and assert it is >= 2.
    const w = computeBurnRateWindow({
      sloId: "ai_request_success",
      target: 0.999,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 10000,
      failed: 145, // just over the 144 boundary
    });
    expect(w.monthlyBudgetBurnedPct).toBeGreaterThanOrEqual(2.0);
  });

  it("slow-burn threshold: 10% of monthly budget in 6h on the job SLO", () => {
    // 6h window, target 0.99 → allowed 0.01. monthly-equiv ratio = MONTH/6h = 120.
    // monthlyAllowed = total×120×0.01. To burn 10% we need failed = 0.10×that.
    const total = 1000;
    const monthlyAllowed = total * (MONTH_MS / SIX_HOURS_MS) * 0.01;
    const failed = Math.ceil(0.1 * monthlyAllowed);
    const w = computeBurnRateWindow({
      sloId: "background_job_success",
      target: 0.99,
      windowMs: SIX_HOURS_MS,
      windowLabel: "6h",
      total,
      failed,
    });
    expect(w.monthlyBudgetBurnedPct).toBeGreaterThanOrEqual(10.0);
  });

  it("a perfect-SLO target (1.0) with failures yields Infinity burned (zero allowance)", () => {
    const w = computeBurnRateWindow({
      sloId: "zero_sev1_per_month",
      target: 1.0,
      windowMs: HOUR_MS,
      windowLabel: "1h",
      total: 100,
      failed: 1,
    });
    expect(w.allowedFailureFraction).toBe(0);
    expect(w.burnRate).toBeNull();
    expect(w.monthlyBudgetBurnedPct).toBe(Infinity);
  });
});

describe("buildRequestSlo (month-to-date shape) — unchanged after extraction", () => {
  it("clean month = 0% consumed, status ok", () => {
    const s = buildRequestSlo("ai_request_success", 0.999, 100000, 0);
    expect(s.budgetConsumedPct).toBe(0);
    expect(s.status).toBe("ok");
    expect(s.remainingBudgetEvents).toBe(100); // floor(100000 × 0.001)
  });

  it("80% of budget consumed = warning", () => {
    // budgetEvents = floor(100000 × 0.001) = 100. 80 failures = 80%.
    const s = buildRequestSlo("ai_request_success", 0.999, 100000, 80);
    expect(s.budgetConsumedPct).toBe(80);
    expect(s.status).toBe("warning");
  });

  it("budget exhausted = critical", () => {
    const s = buildRequestSlo("ai_request_success", 0.999, 100000, 150);
    expect(s.budgetConsumedPct).toBe(150);
    expect(s.status).toBe("critical");
    expect(s.remainingBudgetEvents).toBe(0);
  });

  it("failures with zero traffic budget = 100% consumed", () => {
    // total too small for any allowed failures, but a failure occurred.
    const s = buildRequestSlo("ai_request_success", 0.999, 10, 1);
    expect(s.budgetConsumedPct).toBe(100);
    expect(s.status).toBe("critical");
  });
});

describe("classify", () => {
  it("maps consumption to status bands", () => {
    expect(classify(0)).toBe("ok");
    expect(classify(79.9)).toBe("ok");
    expect(classify(80)).toBe("warning");
    expect(classify(99.9)).toBe("warning");
    expect(classify(100)).toBe("critical");
    expect(classify(250)).toBe("critical");
  });
});
