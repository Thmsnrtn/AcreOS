/**
 * The AI cost-savings figures are computed from evidence, or not computed.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/ai/cost-savings` backs a Settings card that tells the customer
 * "what you paid" and "what the same work would have cost". Its loop defaulted
 * a missing `provider` to `"openai"`, a missing `model` to `"gpt-4o"`, and —
 * for a usage row carrying neither a recorded cost nor token counts — assumed
 *
 *     const AVG_TOKENS_PER_CALL = 1000; // Conservative estimate
 *
 * and priced that. Three invented inputs feeding a dollar figure labelled as
 * money the customer actually spent. "Conservative" is not a defence: nobody
 * asked for a conservative estimate of their bill, they were told a number.
 *
 * It also priced an unknown model at the premium rate
 * (`MODEL_COSTS[model] || GPT4O_RATE`), which inflated the spend AND the
 * "savings" computed against it — the two errors pointing the same way.
 *
 * And it declared a SECOND cost table inline, four hardcoded blended rates,
 * two of them keyed on ids no provider serves (`gpt-4o`, `gpt-4o-mini` are
 * OpenAI's bare names; the platform calls OpenRouter) and one on the retired
 * `deepseek/deepseek-reasoner` — beneath a canonical table whose own docblock
 * says "This is the ONLY price surface callers should use — there is no second
 * cost table."
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 * Every case runs the REAL `summariseCostSavings` against the REAL price table.
 * No mocks: the function is pure, which is why it was extracted. The
 * load-bearing assertions are the refusals — a row with no evidence must
 * contribute **exactly zero** dollars, which is the assertion the old
 * implementation could not pass.
 */

import { describe, expect, it } from "vitest";
import { summariseCostSavings, type AiUsageRecord } from "../../server/services/aiCostSavings";
import { MODELS, priceFor } from "../../server/services/models";

const CHEAP = MODELS.DEEPSEEK_CHAT;
const PREMIUM = MODELS.VISION;

function row(metadata: AiUsageRecord["metadata"], quantity = 1): AiUsageRecord {
  return { quantity, metadata };
}

describe("a call with no evidence contributes nothing", () => {
  it("no cost and no token counts is UNPRICED, not estimated at 1,000 tokens", () => {
    const s = summariseCostSavings([row({ provider: "openrouter", model: CHEAP })]);
    expect(s.unpricedCalls).toBe(1);
    expect(s.totalCalls, "an unpriced call must not be counted as priced").toBe(0);
    expect(
      s.totalActualCost,
      "a dollar figure was produced for a call carrying no cost and no tokens — " +
        "this is the AVG_TOKENS_PER_CALL fabrication",
    ).toBe(0);
    expect(s.totalPotentialCost).toBe(0);
    expect(s.totalSavings).toBe(0);
    expect(s.byProvider, "an unpriced call must not appear under a provider").toEqual([]);
  });

  it("no model recorded is UNPRICED, not assumed to be the premium model", () => {
    const s = summariseCostSavings([
      row({ provider: "openrouter", promptTokens: 1000, completionTokens: 1000 }),
    ]);
    expect(s.unpricedCalls).toBe(1);
    expect(s.totalActualCost).toBe(0);
  });

  it("an UNKNOWN model is unpriced, not silently priced at the premium rate", () => {
    // The old `MODEL_COSTS[model] || GPT4O_RATE` inflated spend and savings in
    // the same direction, so the card looked both more expensive and more
    // impressive than the truth.
    const s = summariseCostSavings([
      row({
        provider: "openrouter",
        model: "acme/some-model-that-does-not-exist",
        promptTokens: 1000,
        completionTokens: 1000,
      }),
    ]);
    expect(s.unpricedCalls).toBe(1);
    expect(s.totalActualCost).toBe(0);
  });

  it("no provider recorded is unpriced, not assumed to be OpenAI", () => {
    const s = summariseCostSavings([
      row({ model: CHEAP, promptTokens: 1000, completionTokens: 1000 }),
    ]);
    expect(s.unpricedCalls).toBe(1);
    expect(s.totalActualCost).toBe(0);
  });

  it("unpriced rows carry their quantity, so the count is calls and not rows", () => {
    const s = summariseCostSavings([row({ provider: "openrouter", model: CHEAP }, 7)]);
    expect(s.unpricedCalls).toBe(7);
  });
});

describe("a call with token counts is priced from the real table", () => {
  it("uses the model's input AND output rates, not a 1:1 blend", () => {
    // The old code blended (input+output)/2 even when it had both counts, so an
    // output-heavy call was under-priced and an input-heavy one over-priced.
    const rate = priceFor(CHEAP);
    const s = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, promptTokens: 1_000_000, completionTokens: 0 }),
    ]);
    expect(s.totalCalls).toBe(1);
    expect(s.unpricedCalls).toBe(0);
    expect(s.totalActualCost).toBeCloseTo(rate.input, 4);

    const outputHeavy = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, promptTokens: 0, completionTokens: 1_000_000 }),
    ]);
    expect(outputHeavy.totalActualCost).toBeCloseTo(rate.output, 4);
    expect(
      outputHeavy.totalActualCost,
      "input and output are priced identically — the blend is back",
    ).not.toBeCloseTo(s.totalActualCost, 4);
  });

  it("the counterfactual is the premium model on the same tokens, and shows a saving", () => {
    const s = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, promptTokens: 500_000, completionTokens: 500_000 }),
    ]);
    expect(s.totalPotentialCost).toBeGreaterThan(s.totalActualCost);
    expect(s.totalSavings).toBeCloseTo(s.totalPotentialCost - s.totalActualCost, 4);
    expect(s.savingsPercent).toBeGreaterThan(0);
    expect(s.savingsPercent).toBeLessThanOrEqual(100);
  });

  it("the premium model saves nothing against itself", () => {
    // Vacuity from the other side: if `potentialCost` were computed from
    // anything but the same tokens at the baseline rate, this would drift.
    const s = summariseCostSavings([
      row({ provider: "openai", model: PREMIUM, promptTokens: 100_000, completionTokens: 100_000 }),
    ]);
    expect(s.totalSavings).toBeCloseTo(0, 4);
  });
});

describe("a recorded cost with no tokens is used as-is", () => {
  it("takes the recorded cost and scales the counterfactual by blended rates", () => {
    const s = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, estimatedCost: 0.01 }),
    ]);
    expect(s.totalActualCost).toBeCloseTo(0.01, 4);
    expect(s.totalPotentialCost).toBeGreaterThan(0.01);
    expect(s.unpricedCalls).toBe(0);
  });

  it("a zero recorded cost is not evidence — it is unpriced", () => {
    // `estimatedCost: 0` means nobody wrote one down, not that the call was
    // free. Pricing it as free would understate the bill.
    const s = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, estimatedCost: 0 }),
    ]);
    expect(s.unpricedCalls).toBe(1);
    expect(s.totalCalls).toBe(0);
  });
});

describe("mixed months report both halves", () => {
  it("totals cover only what was priced, and the rest is stated", () => {
    const s = summariseCostSavings([
      row({ provider: "openrouter", model: CHEAP, promptTokens: 1000, completionTokens: 1000 }, 3),
      row({ provider: "openrouter", model: CHEAP }, 5), // no evidence
      row({ provider: "openai", model: PREMIUM, estimatedCost: 0.5 }, 2),
    ]);
    expect(s.totalCalls).toBe(5);
    expect(s.unpricedCalls).toBe(5);
    expect(s.totalActualCost).toBeGreaterThan(0);

    const providers = s.byProvider.map((p) => p.provider).sort();
    expect(providers).toEqual(["openai", "openrouter"]);
    const summed = s.byProvider.reduce((a, p) => a + p.calls, 0);
    expect(summed, "per-provider calls must reconcile with the priced total").toBe(s.totalCalls);
  });

  it("vacuity: an empty month is zeroes, not NaN or a divide-by-zero percent", () => {
    const s = summariseCostSavings([]);
    expect(s).toMatchObject({
      totalCalls: 0,
      unpricedCalls: 0,
      totalActualCost: 0,
      totalSavings: 0,
      savingsPercent: 0,
      byProvider: [],
    });
    expect(Number.isNaN(s.savingsPercent)).toBe(false);
  });
});

describe("there is no second cost table", () => {
  it("prices through services/models.ts, which is what the boot guard covers", async () => {
    // The canonical table throws at server boot if a pinned model has no price
    // row. A second table inline in a route has no such guard, which is how
    // this surface came to hold rates for two ids no provider serves.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripCommentsPreservingLines } = await import("../../scripts/lib/strip-comments.mjs");
    const src = stripCommentsPreservingLines(
      fs.readFileSync(path.resolve(__dirname, "../../server/routes-ai.ts"), "utf8"),
    );
    expect(src, "routes-ai.ts declares its own model cost table again").not.toMatch(
      /MODEL_COSTS\s*:/,
    );
    expect(src, "the 1,000-token assumption is back").not.toContain("AVG_TOKENS_PER_CALL");
    expect(src, "the route no longer calls the canonical summariser").toContain(
      "summariseCostSavings",
    );
  });
});
