/**
 * T0-12 (elevation-blueprint-2026-06-10.md) — fabricated industry benchmarks.
 *
 * AcreOS sells truth. Until real network-cohort percentiles exist (Tier-2
 * item 2A), every industry-benchmark method MUST return a typed
 * insufficient-data result ({ available: false, reason }) — never invented
 * medians, default rates, percentiles, or "5,000+ transactions" sample
 * sizes. These tests pin that contract so a hardcoded benchmark table can
 * never silently come back.
 */

import { describe, it, expect, vi } from "vitest";

// Chainable thenable DB mock — queries resolve to [] (no scored rows).
// The honest-absence methods under test never touch the DB; the portfolio
// methods do, and must compute from real (here: empty) data only.
vi.mock("../../server/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then?: unknown }).then = (resolve: (rows: unknown[]) => void) => resolve([]);
  return { db: { select: vi.fn(() => chain) } };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { creditBenchmarkingService } from "../../server/services/creditBenchmarking";
import { landCredit } from "../../server/services/landCredit";

describe("CreditBenchmarkingService — honest absence until real cohort data exists", () => {
  it("getBenchmarks returns insufficient-data, not invented percentiles", () => {
    const result = creditBenchmarkingService.getBenchmarks("agricultural", "TX");
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe("string");
    // No fabricated numbers may leak through.
    expect(result).not.toHaveProperty("median");
    expect(result).not.toHaveProperty("p25");
    expect(result).not.toHaveProperty("p75");
    expect(result).not.toHaveProperty("sampleSize");
  });

  it("getBenchmarks is insufficient-data for every state/type (no hidden TX/FL/GA tables)", () => {
    for (const state of ["TX", "FL", "GA", "ZZ"]) {
      for (const type of ["agricultural", "residential", "commercial", "timberland"]) {
        const result = creditBenchmarkingService.getBenchmarks(type, state);
        expect(result.available).toBe(false);
      }
    }
  });

  it("compareToIndustry returns insufficient-data, not an invented percentile rank", () => {
    const result = creditBenchmarkingService.compareToIndustry(72, "residential", "FL");
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("percentile");
    expect(result).not.toHaveProperty("vsMedian");
    expect(result).not.toHaveProperty("relativePosition");
  });

  it("getHistoricalPerformance returns insufficient-data, not invented default/appreciation rates", () => {
    const result = creditBenchmarkingService.getHistoricalPerformance(60, 80);
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("avgDefaultRate");
    expect(result).not.toHaveProperty("avgAppreciationRate");
  });

  it("getIndustryTrends returns insufficient-data, not synthetic time-series", () => {
    const result = creditBenchmarkingService.getIndustryTrends("GA");
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("trends");
    expect(result).not.toHaveProperty("outlook");
  });

  it("generateBenchmarkReport keeps real portfolio sections but marks the national comparison unavailable", async () => {
    const report = await creditBenchmarkingService.generateBenchmarkReport(1);
    expect(report.nationalComparison.available).toBe(false);
    expect(report.nationalComparison.reason).toBeTruthy();
    expect(report.nationalComparison).not.toHaveProperty("nationalMedian");
    expect(report.nationalComparison).not.toHaveProperty("percentileRank");
    // Real (empty) portfolio data — zeros from absence, not fabricated values.
    expect(report.distribution.totalScored).toBe(0);
    expect(report.distribution.avgScore).toBe(0);
    expect(report.underperformers).toEqual([]);
    // No recommendation may reference an invented national median.
    for (const rec of report.recommendations) {
      expect(rec.toLowerCase()).not.toContain("national median");
    }
  });

  it("backtestScoring carries real scores only and marks performance predictions unavailable", async () => {
    const result = await creditBenchmarkingService.backtestScoring([1, 2, 3]);
    expect(result.results).toEqual([]);
    expect(result.summary.avgPredictedScore).toBe(0);
    expect(result.summary).not.toHaveProperty("highRiskCount");
  });
});

describe("landCredit.compareToIndustryBenchmarks — the live /api/land-credit/benchmark handler", () => {
  it("returns insufficient-data, not hardcoded benchmark averages with state bonuses", () => {
    const result = landCredit.compareToIndustryBenchmarks(650, "agricultural", "TX");
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toBeTruthy();
    expect(result).not.toHaveProperty("percentile");
    expect(result).not.toHaveProperty("benchmarkAvg");
    expect(result).not.toHaveProperty("benchmarkMedian");
  });
});
