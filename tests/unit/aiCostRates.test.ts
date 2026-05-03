/**
 * aiCostRates + aiQuotaService — unit tests.
 *
 * Phase 3 Week 9. Covers:
 *   1. computeCostUsd — input/output token math; cached-input discount;
 *      unknown-model fallback; non-finite inputs guarded.
 *   2. AIQuotaExceeded throw path and the cap=0 (unlimited) skip path,
 *      using a stubbed sumTodayUsd via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the db module so aiQuotaService can be loaded without a real Postgres
// connection. The mock is hoisted to the top of the module by vitest, so it
// must precede any import of aiQuotaService.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../server/db", () => {
  return {
    db: {
      // The select chain returns a configurable thenable. Each test sets
      // (globalThis as any).__nextRow before invoking the service.
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => (globalThis as any).__nextRow ?? []),
          })),
        })),
      })),
      execute: vi.fn(async () => ({ rows: [] })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(async () => undefined),
        })),
      })),
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCostUsd
// ─────────────────────────────────────────────────────────────────────────────

import {
  computeCostUsd,
  getRate,
  knownModels,
  AI_COST_RATES,
  DEFAULT_RATE,
} from "../../server/services/aiCostRates";

describe("aiCostRates.computeCostUsd", () => {
  it("computes USD for a known Anthropic model (Sonnet 4.6)", () => {
    // 1M input + 0M output @ $3.00 / $15.00 = $3.00
    expect(computeCostUsd("anthropic/claude-sonnet-4-6", 1_000_000, 0)).toBeCloseTo(3.0, 6);

    // 0M input + 1M output @ $15.00 = $15.00
    expect(computeCostUsd("anthropic/claude-sonnet-4-6", 0, 1_000_000)).toBeCloseTo(15.0, 6);

    // mixed
    expect(computeCostUsd("anthropic/claude-sonnet-4-6", 1_000, 500))
      .toBeCloseTo((1_000 * 3.0 + 500 * 15.0) / 1_000_000, 9);
  });

  it("computes USD for DeepSeek Chat (cheap tier)", () => {
    // 1M input @ $0.14 = $0.14
    expect(computeCostUsd("deepseek/deepseek-chat", 1_000_000, 0)).toBeCloseTo(0.14, 6);
  });

  it("applies the cached-input discount when supplied", () => {
    // Sonnet: input $3.00, cachedInput $0.30
    // 1M input total of which 800k is cached → 200k * 3.00 + 800k * 0.30 = 0.6 + 0.24 = 0.84
    const cost = computeCostUsd("anthropic/claude-sonnet-4-6", 1_000_000, 0, 800_000);
    expect(cost).toBeCloseTo(0.84, 6);
  });

  it("falls back to DEFAULT_RATE for unknown models", () => {
    const cost = computeCostUsd("vendor/unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(DEFAULT_RATE.input + DEFAULT_RATE.output, 6);
  });

  it("treats negative or non-finite inputs as zero", () => {
    expect(computeCostUsd("openai/gpt-4o", -10, -10)).toBe(0);
    expect(computeCostUsd("openai/gpt-4o", NaN, Infinity)).toBe(0);
  });

  it("returns 0 when both token counts are 0", () => {
    expect(computeCostUsd("anthropic/claude-sonnet-4-6", 0, 0)).toBe(0);
  });

  it("getRate returns DEFAULT_RATE for missing / undefined model", () => {
    expect(getRate("")).toEqual(DEFAULT_RATE);
    expect(getRate("not-a-model")).toEqual(DEFAULT_RATE);
  });

  it("knownModels lists the registered models", () => {
    const list = knownModels();
    expect(list).toContain("anthropic/claude-sonnet-4-6");
    expect(list).toContain("deepseek/deepseek-chat");
    expect(list.length).toBe(Object.keys(AI_COST_RATES).length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// aiQuotaService.checkQuota — uses the mocked db sumTodayUsd path
// ─────────────────────────────────────────────────────────────────────────────

import { checkQuota, AIQuotaExceeded, sumTodayUsd } from "../../server/services/aiQuotaService";

describe("aiQuotaService.checkQuota", () => {
  beforeEach(() => {
    (globalThis as any).__nextRow = [];
  });

  it("does nothing when cap is 0 (unlimited)", async () => {
    (globalThis as any).__nextRow = [{ total: "999999" }];
    await expect(checkQuota(42, 0)).resolves.toBeUndefined();
  });

  it("does nothing when cap is negative", async () => {
    (globalThis as any).__nextRow = [{ total: "100" }];
    await expect(checkQuota(42, -10)).resolves.toBeUndefined();
  });

  it("allows the call when usage is below the cap", async () => {
    (globalThis as any).__nextRow = [{ total: "10.50" }];
    await expect(checkQuota(42, 50)).resolves.toBeUndefined();
  });

  it("allows the call when there is no usage row yet", async () => {
    (globalThis as any).__nextRow = [];
    await expect(checkQuota(42, 50)).resolves.toBeUndefined();
  });

  it("throws AIQuotaExceeded when usage equals the cap", async () => {
    (globalThis as any).__nextRow = [{ total: "50.00" }];
    await expect(checkQuota(42, 50)).rejects.toBeInstanceOf(AIQuotaExceeded);
  });

  it("throws AIQuotaExceeded when usage is above the cap", async () => {
    (globalThis as any).__nextRow = [{ total: "73.42" }];
    let thrown: unknown;
    try {
      await checkQuota(42, 50);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AIQuotaExceeded);
    const e = thrown as AIQuotaExceeded;
    expect(e.statusCode).toBe(429);
    expect(e.code).toBe("AI_QUOTA_EXCEEDED");
    expect(e.usedUsdToday).toBeCloseTo(73.42, 6);
    expect(e.capUsd).toBe(50);
  });

  it("sumTodayUsd returns 0 when no row exists", async () => {
    (globalThis as any).__nextRow = [];
    const v = await sumTodayUsd(42);
    expect(v).toBe(0);
  });

  it("sumTodayUsd parses string-typed numerics from the pg driver", async () => {
    (globalThis as any).__nextRow = [{ total: "12.345678" }];
    const v = await sumTodayUsd(42);
    expect(v).toBeCloseTo(12.345678, 6);
  });
});
