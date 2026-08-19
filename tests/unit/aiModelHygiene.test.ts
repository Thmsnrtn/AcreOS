import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// AI substrate hygiene (andrei/ai-hygiene):
//   1. SINGLE MODEL SOURCE — server/services/models.ts is the one place that
//      names model IDs; aiRouter (MODEL_*) and paxModelTier (PAX_ROUTE_MODEL_*)
//      both resolve to it, so they can never disagree on which Opus is "best".
//      Opus is pinned to claude-opus-4-8; prices resolve through the central
//      aiCostRates table with the corrected $5/$25 Opus figure (not the stale
//      $15/$75), and estimateCost has no silent fallback for KNOWN models.
//   2. MODEL-BACKED CONFIDENCE — paxObserver.recordModelObservation stamps a
//      model's real self-reported confidence (0.91 → 91) into the observation,
//      and keeps honest-null (no row) when the model didn't report one.
//   3. (retired 2026-08-01) modelTraining's real-or-null metrics pin — the
//      module and its tables were deleted; see the dated note at the bottom.
// ============================================================================

import { MODELS, KNOWN_MODELS, isKnownModel, priceFor } from "../../server/services/models";
import {
  MODEL_CRITICAL,
  MODEL_COMPLEX,
  MODEL_MODERATE,
  MODEL_SIMPLE,
  MODEL_VISION,
  MODEL_REASONING,
} from "../../server/services/aiRouter";
import {
  PAX_ROUTE_MODEL_OPUS,
  PAX_ROUTE_MODEL_SONNET,
  PAX_ROUTE_MODEL_HAIKU,
} from "../../server/ai/paxModelTier";
import { computeCostUsd } from "../../server/services/aiCostRates";

describe("models.ts — single source of truth for model IDs", () => {
  it("pins Opus to the current best (claude-opus-4.8)", () => {
    // The version separator is a DOT. This assertion read `claude-opus-4-8`
    // until 2026-08-19 and was pinning a string absent from OpenRouter's
    // catalogue — 18 dotted Anthropic ids there, zero hyphenated — so the test
    // that existed to keep the model pinned was holding it pinned to a name the
    // provider does not serve. Rewritten to the measured truth rather than
    // deleted: the invariant it was written for (Opus stays pinned to the
    // current best, not floated) survives. See modelIdsAreReal.test.ts.
    expect(MODELS.OPUS).toBe("anthropic/claude-opus-4.8");
  });

  it("aiRouter MODEL_* resolve to the single source (no independent strings)", () => {
    expect(MODEL_CRITICAL).toBe(MODELS.OPUS);
    expect(MODEL_COMPLEX).toBe(MODELS.SONNET);
    expect(MODEL_MODERATE).toBe(MODELS.HAIKU);
    expect(MODEL_SIMPLE).toBe(MODELS.DEEPSEEK_CHAT);
    expect(MODEL_VISION).toBe(MODELS.VISION);
    expect(MODEL_REASONING).toBe(MODELS.DEEPSEEK_REASONER);
  });

  it("aiRouter and paxModelTier agree on the SAME top model (the bug this fixes)", () => {
    // Before: aiRouter pinned opus-4-6, paxModelTier pinned opus-4-7. Now both
    // resolve through models.MODELS.OPUS, so they are byte-identical.
    expect(MODEL_CRITICAL).toBe(PAX_ROUTE_MODEL_OPUS);
    expect(MODEL_COMPLEX).toBe(PAX_ROUTE_MODEL_SONNET);
    expect(MODEL_MODERATE).toBe(PAX_ROUTE_MODEL_HAIKU);
  });

  it("isKnownModel covers every routed model and rejects junk", () => {
    for (const id of KNOWN_MODELS) expect(isKnownModel(id)).toBe(true);
    expect(isKnownModel("anthropic/claude-opus-4-6")).toBe(false); // stale id
    expect(isKnownModel("totally-made-up")).toBe(false);
  });
});

describe("cost table — corrected prices, no silent fallback for known models", () => {
  it("Opus is priced at the corrected $5/$25 (not the stale $15/$75)", () => {
    const p = priceFor(MODELS.OPUS);
    expect(p.input).toBe(5.0);
    expect(p.output).toBe(25.0);
    // A 1M-in / 1M-out call = $5 + $25 = $30 — NOT the old $90.
    expect(computeCostUsd(MODELS.OPUS, 1_000_000, 1_000_000)).toBeCloseTo(30, 5);
  });

  it("Sonnet $3/$15, Haiku via OpenRouter, are all priced (never $0, never {1,3})", () => {
    expect(priceFor(MODELS.SONNET).input).toBe(3.0);
    expect(priceFor(MODELS.SONNET).output).toBe(15.0);
    // Every known model has a real, non-default rate.
    for (const id of KNOWN_MODELS) {
      const usd = computeCostUsd(id, 1_000_000, 1_000_000);
      expect(usd).toBeGreaterThan(0);
    }
  });
});

// ── Model-backed confidence → observation ────────────────────────────────────
// recordModelObservation must stamp the model's REAL confidence (0..1 → 0..100)
// and keep honest-null (no row) when the model reported nothing.
describe("paxObserver.recordModelObservation — real model confidence lands", () => {
  const recordSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    recordSpy.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function loadObserver() {
    // db is only touched by recordObservation, which we spy on — but stub it so
    // importing paxObserver never opens a real connection.
    vi.doMock("../../server/db", () => ({ db: {} }));
    const mod = await import("../../server/services/paxObserver");
    // Spy on the underlying recordObservation so we assert the stamped score
    // without a DB round-trip.
    vi.spyOn(mod.paxObserver, "recordObservation").mockImplementation(
      async (opts: any) => {
        recordSpy(opts);
        return { id: 1, ...opts } as any;
      },
    );
    return mod;
  }

  it("stamps a real model confidence (0.91 → 91) with a model:* basis", async () => {
    const { paxObserver } = await loadObserver();
    const result = await paxObserver.recordModelObservation({
      organizationId: 7,
      type: "opportunity",
      modelConfidence: 0.91,
      modelSource: "pax_response_quality",
      severity: "info",
      title: "t",
      description: "d",
    });
    expect(result).not.toBeNull();
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const passed = recordSpy.mock.calls[0][0];
    expect(passed.confidenceScore).toBe(91); // 0.91 × 100, NOT a constant
    expect(passed.metadata.confidenceBasis).toMatch(/^model:pax_response_quality/);
  });

  it("keeps honest-null: no row when the model omitted confidence", async () => {
    const { paxObserver } = await loadObserver();
    const result = await paxObserver.recordModelObservation({
      organizationId: 7,
      type: "opportunity",
      modelConfidence: null,
      modelSource: "pax_response_quality",
      severity: "info",
      title: "t",
      description: "d",
    });
    expect(result).toBeNull();
    expect(recordSpy).not.toHaveBeenCalled(); // no fabricated number, no row
  });

  it("rejects out-of-range confidence as honest-null (never clamps to a constant)", async () => {
    const { paxObserver } = await loadObserver();
    for (const bad of [1.5, -0.1, NaN, Infinity]) {
      const r = await paxObserver.recordModelObservation({
        organizationId: 7,
        type: "opportunity",
        modelConfidence: bad as number,
        modelSource: "s",
        severity: "info",
        title: "t",
        description: "d",
      });
      expect(r).toBeNull();
    }
    expect(recordSpy).not.toHaveBeenCalled();
  });
});

// ── modelTraining block removed 2026-08-01 ───────────────────────────────────
// The describe that lived here pinned modelTraining's simulated run to
// real-or-null metrics (never Math.random()). modelTraining.ts was deleted by
// founder-authorized ruling — it was unreached (its only importer was the dead
// services/ai barrel, itself imported by nothing) and its tables
// model_versions / training_metrics were dropped. The no-fabrication invariant
// it enforced did not lapse: the module that could have fabricated no longer
// exists, and the repo-wide `lint:no-fabrication` gate still covers live code.
