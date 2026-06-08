/**
 * Tests for the deterministic confidence-band scaffold
 * (server/services/andrei/confidenceBand.ts).
 *
 * computeConfidenceBand is pure: confidence (0-100) + cache staleness → band,
 * where staleness can only DROP the band. recordBandObservation is best-effort
 * logging (asserted to not throw).
 */

import { describe, expect, it, vi } from "vitest";

const logInfo = vi.fn();
vi.mock("../../server/utils/logger", () => ({
  logger: { info: (...a: unknown[]) => logInfo(...a), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  computeConfidenceBand,
  bandHedgePhrase,
  recordBandObservation,
} from "../../server/services/andrei/confidenceBand";

const NOW = new Date("2026-06-08T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("computeConfidenceBand", () => {
  it("high confidence + fresh → high", () => {
    expect(computeConfidenceBand({ confidence: 90, now: NOW })).toBe("high");
  });

  it("moderate confidence → moderate", () => {
    expect(computeConfidenceBand({ confidence: 70, now: NOW })).toBe("moderate");
  });

  it("low confidence → low", () => {
    expect(computeConfidenceBand({ confidence: 40, now: NOW })).toBe("low");
  });

  it("missing/NaN confidence → low (no basis to claim more)", () => {
    expect(computeConfidenceBand({ confidence: null, now: NOW })).toBe("low");
    expect(computeConfidenceBand({ confidence: NaN, now: NOW })).toBe("low");
    expect(computeConfidenceBand({ now: NOW })).toBe("low");
  });

  it("staleness drops one band past ~6 months", () => {
    // high confidence but 7 months stale → drops to moderate.
    expect(computeConfidenceBand({ confidence: 90, cachedAt: daysAgo(200), now: NOW })).toBe("moderate");
  });

  it("staleness drops two bands past ~1 year (the 14-month-stale county layer)", () => {
    // high confidence but 14 months stale → drops to low.
    expect(computeConfidenceBand({ confidence: 90, cachedAt: daysAgo(420), now: NOW })).toBe("low");
  });

  it("staleness never RAISES a band (low stays low even when fresh)", () => {
    expect(computeConfidenceBand({ confidence: 30, cachedAt: daysAgo(0), now: NOW })).toBe("low");
  });

  it("fresh lookup (no cachedAt) takes no staleness penalty", () => {
    expect(computeConfidenceBand({ confidence: 88, cachedAt: null, now: NOW })).toBe("high");
  });

  it("future cachedAt is treated as fresh, never negative-aged", () => {
    expect(computeConfidenceBand({ confidence: 88, cachedAt: daysAgo(-5), now: NOW })).toBe("high");
  });

  it("accepts ISO string cachedAt", () => {
    expect(
      computeConfidenceBand({ confidence: 90, cachedAt: daysAgo(420).toISOString(), now: NOW }),
    ).toBe("low");
  });
});

describe("bandHedgePhrase", () => {
  it("returns a distinct phrase per band", () => {
    const phrases = new Set([bandHedgePhrase("high"), bandHedgePhrase("moderate"), bandHedgePhrase("low")]);
    expect(phrases.size).toBe(3);
    expect(bandHedgePhrase("low").toLowerCase()).toContain("low-confidence");
  });
});

describe("recordBandObservation", () => {
  it("emits a structured observation and never throws", () => {
    expect(() =>
      recordBandObservation({ band: "high", wasCorrected: false, confidence: 90, cacheAgeDays: 2, orgId: 1 }),
    ).not.toThrow();
    expect(logInfo).toHaveBeenCalled();
    const meta = (logInfo.mock.calls.at(-1)?.[1] as any)?.metadata;
    expect(meta?.marker).toBe("confidence_band_observation");
    expect(meta?.band).toBe("high");
    expect(meta?.wasCorrected).toBe(false);
  });
});
