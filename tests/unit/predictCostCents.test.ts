/**
 * predictCostCents — pre-call cost forecast (Tahoe H5.3 / Andrei).
 *
 * Locks the centralized per-model pricing + the before-the-call estimator so a
 * pricing-drift PR can't silently change forecasts, and so the cached-prefix
 * discount math stays correct. Pricing source: aiCostRates.AI_COST_RATES
 * (reconciled against the claude-api skill 2026-06-06).
 */

import { describe, it, expect } from "vitest";
import {
  predictCostCents,
  cheapestModelWithinBudget,
  estimateTokensFromChars,
  computeCostUsd,
} from "../../server/services/aiCostRates";

describe("predictCostCents", () => {
  it("prices a known model from the centralized table (Opus 4.8 = $5/$25 per 1M)", () => {
    // 1M input only → $5.00 → 500 cents.
    expect(
      predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(500, 5);
    // 1M input + 1M output → $5 + $25 = $30 → 3000 cents.
    expect(
      predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(3000, 5);
  });

  it("prices Haiku 4.5 at the lower OpenRouter rate ($0.80/$4.00 per 1M)", () => {
    expect(
      predictCostCents({ model: "anthropic/claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(480, 5);
  });

  it("falls back to DEFAULT_RATE for unknown models (never silently $0)", () => {
    // DEFAULT_RATE = $1 in / $3 out → 1M+1M = $4 → 400 cents.
    expect(
      predictCostCents({ model: "totally/unknown-model", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(400, 5);
  });

  it("applies the prompt-prefix cache discount on the cached input fraction", () => {
    // Opus 4.8 cachedInput = $0.50/1M. 1M input fully cached, no output → 50 cents.
    expect(
      predictCostCents({
        model: "anthropic/claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputFraction: 1,
      }),
    ).toBeCloseTo(50, 5);
    // Half cached → (0.5M @ $5 + 0.5M @ $0.50)/1M = $2.75 → 275 cents.
    expect(
      predictCostCents({
        model: "anthropic/claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputFraction: 0.5,
      }),
    ).toBeCloseTo(275, 5);
  });

  it("estimates input tokens from chars (4 chars/token, conservative)", () => {
    expect(estimateTokensFromChars(4000)).toBe(1000);
    expect(estimateTokensFromChars(0)).toBe(0);
    // inputChars path matches the inputTokens path.
    expect(
      predictCostCents({ model: "anthropic/claude-opus-4-8", inputChars: 4000, outputTokens: 0 }),
    ).toBeCloseTo(
      predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 1000, outputTokens: 0 }),
      5,
    );
  });

  it("uses maxTokens as the conservative output estimate when outputTokens is unknown", () => {
    const withMax = predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 0, maxTokens: 1_000_000 });
    const withOut = predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 0, outputTokens: 1_000_000 });
    expect(withMax).toBeCloseTo(withOut, 5);
    expect(withMax).toBeCloseTo(2500, 5); // 1M output @ $25/1M
  });

  it("pads input for tool overhead", () => {
    const noTools = predictCostCents({ model: "anthropic/claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0 });
    const withTools = predictCostCents({
      model: "anthropic/claude-opus-4-8",
      inputTokens: 1_000_000,
      outputTokens: 0,
      toolOverheadTokens: 1_000_000,
    });
    expect(withTools).toBeCloseTo(noTools * 2, 5);
  });
});

describe("cheapestModelWithinBudget", () => {
  const shared = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("picks the cheapest candidate that fits the budget", () => {
    // opus = 3000c, haiku = 480c. Budget 500c → only haiku fits.
    const pick = cheapestModelWithinBudget(
      ["anthropic/claude-opus-4-8", "anthropic/claude-haiku-4-5"],
      500,
      shared,
    );
    expect(pick?.model).toBe("anthropic/claude-haiku-4-5");
    expect(pick?.predictedCents).toBeCloseTo(480, 5);
  });

  it("returns null when no candidate fits", () => {
    const pick = cheapestModelWithinBudget(
      ["anthropic/claude-opus-4-8", "anthropic/claude-haiku-4-5"],
      100, // below even haiku's 480c
      shared,
    );
    expect(pick).toBeNull();
  });
});

describe("computeCostUsd cached-token accounting (forecast/actual parity)", () => {
  it("bills cached tokens at the discounted rate and the remainder at full rate", () => {
    // Opus 4.8: 1M prompt, 0.4M cached → 0.6M @ $5 + 0.4M @ $0.50 = $3.20.
    expect(
      computeCostUsd("anthropic/claude-opus-4-8", 1_000_000, 0, 400_000),
    ).toBeCloseTo(3.2, 6);
  });
});
