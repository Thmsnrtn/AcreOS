import { describe, it, expect } from "vitest";

// ============================================================================
// Prompt-cache cost discount must flow through BOTH cost paths (lena/finance).
//
// The defect: prompt caching is auto-enabled on Anthropic calls with a large
// system prompt, and the router extracts the cache-read token count — but both
// cost calculations discarded the discount:
//   • LEDGER debit  → estimateCost(model, prompt, completion)  (aiRouter)
//     charged ALL prompt tokens at the full input rate (no cached param).
//   • QUOTA debit   → computeCostUsd(model, prompt, completion) (aiCostRates)
//     called 3-arg, so the 4th param cachedInputTokens defaulted to 0.
// Result: cache-warmed calls overcharged AI COGS up to ~8× → contribution
// margin understated in financial_ledger AND per-org daily AI quota
// (ai_usage_daily) over-consumed (customers throttled 5–8× early).
//
// These tests assert the cached portion of the prompt now bills at the
// discounted Anthropic prompt-cache READ rate (~0.1× input) in BOTH numbers.
// ============================================================================

import { MODELS, priceFor } from "../../server/services/models";
import { computeCostUsd } from "../../server/services/aiCostRates";
import { estimateCost } from "../../server/services/aiRouter";

describe("prompt-cache discount — LEDGER path (aiRouter.estimateCost)", () => {
  const model = MODELS.OPUS; // input $5/M, cachedInput $0.50/M (0.1×), output $25/M
  const rate = priceFor(model);

  it("charges the cached portion at ~0.1× input, the rest fresh", () => {
    // 1,000,000 prompt tokens, 900,000 of them cache-read, 0 output.
    const cost = estimateCost(model, 1_000_000, 0, 900_000);
    const expected =
      (100_000 * rate.input + 900_000 * (rate.cachedInput ?? rate.input)) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 8);
    // Sanity: $5.00 fresh-only vs $0.95 fully-warmed.
    expect(expected).toBeCloseTo(0.5 + 0.45, 8); // 0.1M×$5 + 0.9M×$0.50 = $0.95
  });

  it("a fully-cached prompt costs ~0.1× the full-rate charge (the ~8x→correct fix)", () => {
    const fullRate = estimateCost(model, 1_000_000, 0, 0);        // no discount
    const allCached = estimateCost(model, 1_000_000, 0, 1_000_000); // all cached
    expect(fullRate).toBeCloseTo(5.0, 8);
    expect(allCached).toBeCloseTo(0.5, 8);
    // The discount is the cachedInput/input ratio (0.1×) — i.e. the prior
    // overcharge was 10× on a fully-warmed prompt.
    expect(allCached / fullRate).toBeCloseTo(
      (rate.cachedInput ?? rate.input) / rate.input,
      8,
    );
  });

  it("ledger and quota paths agree exactly for the same cached call", () => {
    const ledger = estimateCost(model, 800_000, 5_000, 750_000);
    const quota = computeCostUsd(model, 800_000, 5_000, 750_000);
    expect(ledger).toBeCloseTo(quota, 10);
  });

  it("with no cached tokens the discount is a no-op (backward compatible)", () => {
    expect(estimateCost(model, 1_000, 200)).toBeCloseTo(
      computeCostUsd(model, 1_000, 200),
      10,
    );
  });

  it("guards negative / non-finite cached counts (never undercount to garbage)", () => {
    expect(estimateCost(model, 1_000, 0, -50)).toBeCloseTo(
      estimateCost(model, 1_000, 0, 0),
      10,
    );
    expect(estimateCost(model, 1_000, 0, NaN)).toBeCloseTo(
      estimateCost(model, 1_000, 0, 0),
      10,
    );
  });
});

describe("prompt-cache discount — QUOTA path (computeCostUsd, 4-arg)", () => {
  const model = MODELS.SONNET; // input $3/M, cachedInput $0.30/M, output $15/M
  const rate = priceFor(model);

  it("4-arg call discounts the cached portion vs the 3-arg full charge", () => {
    const fresh = computeCostUsd(model, 1_000_000, 0);            // 3-arg → no discount
    const cached = computeCostUsd(model, 1_000_000, 0, 1_000_000); // fully warmed
    expect(fresh).toBeCloseTo(3.0, 8);
    expect(cached).toBeCloseTo(rate.cachedInput ?? rate.input, 8); // $0.30
    expect(cached).toBeLessThan(fresh);
  });
});
