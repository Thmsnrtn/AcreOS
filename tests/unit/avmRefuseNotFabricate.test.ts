/**
 * W3.1 — AVM refuse-not-fabricate (2026-07 audit).
 *
 * The old fallback ladder ended in a fabricated flat $1,000/acre branded
 * "AcreOS Proprietary Valuation Model" — a number an investor might bid
 * real money on. These tests lock the corrected contract on the REAL
 * service (not a local reimplementation):
 *
 *   1. no comps + no trained GBM + no AI key → status "insufficient_data",
 *      estimatedValue 0, `missing` names what's absent, NOTHING persisted
 *   2. no comps + an LLM that WOULD return a $/acre → still refused, no LLM
 *      call is made, nothing persisted. (This test used to pin the LLM rung
 *      as status "ok" / "ai_estimate" — a language model asked for a number
 *      with no sales data invents one; P1-C 2026-10 removed the rung.)
 *   3. comps present → classification "comps_model", and the value is the
 *      comps baseline × exactly the reported marketAdjustments — no hidden
 *      LLM "market momentum" multiplier (P1-C 2026-10).
 *   4. comp query screens out outlier / low-quality rows (arm's-length
 *      discipline — the WHERE carries isOutlier=false + quality != low)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  compRows: [] as any[],
  aiKeySet: false,
  aiResponse: null as string | null,
  predictionInserts: 0,
  lastFindManyWhere: null as unknown,
  llmCalls: 0,
  propRows: [] as any[],
};

vi.mock("../../server/db", () => {
  const insertChain = {
    values: () => {
      state.predictionInserts += 1;
      const p: any = Promise.resolve([]);
      p.returning = async () => [{ id: 1 }];
      return p;
    },
  };
  return {
    db: {
      query: {
        transactionTraining: {
          findMany: async (opts: any) => {
            state.lastFindManyWhere = opts?.where ?? null;
            return state.compRows;
          },
        },
        valuationPredictions: { findMany: async () => [] },
        properties: { findMany: async () => state.propRows },
      },
      insert: () => insertChain,
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    },
  };
});

vi.mock("../../server/services/gradientBoosting", () => ({
  // No trained model available in any of these scenarios.
  GradientBoostingRegressor: { fromJSON: () => null },
  extractLandFeatures: (x: any) => x,
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: () => ({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: state.aiResponse } }],
        }),
      },
    },
  }),
}));

// The metered LLM seam the valuation service calls. Mocked so that IF the
// service asks an LLM anything, it gets a confident number back — a $/acre
// for the no-comps prompt, a +20% "market momentum" for the adjustment prompt.
// The contract under test is that neither ever reaches a value.
vi.mock("../../server/services/aiSpendGuard", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    meteredChatCompletion: async (_client: unknown, params: any) => {
      state.llmCalls += 1;
      const prompt = String(params?.messages?.[0]?.content ?? "");
      const content = /percentage adjustment/i.test(prompt)
        ? JSON.stringify({ adjustment: 20, reasoning: "momentum" })
        : state.aiResponse ?? JSON.stringify({ pricePerAcre: 2500, lowPerAcre: 2000, highPerAcre: 3000, rationale: "guess" });
      return { choices: [{ message: { content } }] };
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/utils/landStatus", () => ({
  assertFeeSimpleOrThrow: () => {},
}));

const REQUEST = {
  propertyId: "0", // non-positive → skips the landStatus DB read
  acres: 10,
  location: { state: "TX", county: "Llano", zipCode: "78643", latitude: 0, longitude: 0 },
  characteristics: {},
};

async function importService() {
  const mod = await import("../../server/services/acreOSValuation");
  return mod.acreOSValuation;
}

beforeEach(() => {
  vi.resetModules();
  state.compRows = [];
  state.aiKeySet = false;
  state.aiResponse = null;
  state.predictionInserts = 0;
  state.lastFindManyWhere = null;
  state.llmCalls = 0;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  delete process.env.GBM_MODEL_JSON;
});

describe("AVM refuse-not-fabricate (W3.1)", () => {
  it("refuses honestly when no comps, no trained model, and no AI path", async () => {
    const svc = await importService();
    const result = await svc.generateValuation("42", REQUEST as any);

    expect(result.status).toBe("insufficient_data");
    expect(result.classification).toBe("insufficient_data");
    expect(result.estimatedValue).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.missing?.length).toBeGreaterThan(0);
    expect(result.missing?.join(" ")).toContain("Llano");
    // The banned fabrication: 10 acres * $1,000 = $10,000 must NOT appear.
    expect(result.estimatedValue).not.toBe(10_000);
    // A refusal is not a prediction — nothing persisted.
    expect(state.predictionInserts).toBe(0);
  });

  it("no comps + an LLM ready to answer with a $/acre → still refused; the LLM never supplies a number", async () => {
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    state.aiResponse = JSON.stringify({ pricePerAcre: 2500, lowPerAcre: 2000, highPerAcre: 3000, rationale: "test" });
    const svc = await importService();
    const result = await svc.generateValuation("42", REQUEST as any);

    expect(result.status).toBe("insufficient_data");
    expect(result.classification).not.toBe("ai_estimate");
    expect(result.estimatedValue).toBe(0);
    expect(result.estimatedValue).not.toBe(25_000);
    expect(result.pricePerAcre).toBe(0);
    expect(state.llmCalls).toBe(0);
    expect(state.predictionInserts).toBe(0);
    // The refusal names the real fix path.
    expect(result.missing?.join(" ").toLowerCase()).toMatch(/enter comps/);
    expect(result.missing?.join(" ").toLowerCase()).toMatch(/blind-offer comps/);
  });

  it("classifies the comps path as comps_model, valued from comps × REPORTED adjustments only", async () => {
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    state.compRows = Array.from({ length: 5 }, (_, i) => ({
      transactionHash: `h${i}`,
      state: "TX",
      county: "Llano",
      salePrice: "50000",
      pricePerAcre: "5000",
      sizeAcres: "10",
      saleDate: new Date(),
    }));
    const svc = await importService();
    const result = await svc.generateValuation("42", {
      ...REQUEST,
      characteristics: { waterRights: true },
    } as any);

    expect(result.status).toBe("ok");
    expect(result.classification).toBe("comps_model");
    expect(result.comparables.length).toBeGreaterThan(0);
    // Every comp is $5,000/acre × 10 acres = $50,000 baseline; the only
    // adjustment is Water Rights +15% → $57,500. The mocked LLM's +20%
    // "momentum" (→ $69,000) must not be in the number.
    expect(result.marketAdjustments).toEqual([{ factor: "Water Rights", adjustment: 15 }]);
    const reproduced = result.marketAdjustments.reduce((v, a) => v * (1 + a.adjustment / 100), 50_000);
    expect(result.estimatedValue).toBe(Math.round(reproduced));
    expect(result.estimatedValue).toBe(57_500);
    expect(state.llmCalls).toBe(0);
  });

  it("comp query carries the arm's-length screens (outlier + quality)", async () => {
    const svc = await importService();
    await svc.generateValuation("42", REQUEST as any);
    // The drizzle `and(...)` condition tree must include the isOutlier and
    // dataQuality screens — inspect (handles the circular table refs) and
    // look for the column names.
    const { inspect } = await import("node:util");
    const where = inspect(state.lastFindManyWhere ?? {}, { depth: 10 });
    expect(where).toContain("is_outlier");
    expect(where).toContain("data_quality");
  });

  it("bulk valuation counts a refusal as refused, never as valuated (P1-C item 3)", async () => {
    state.propRows = [
      // No comps on file → generateValuation refuses.
      { id: 0, sizeAcres: "10", state: "TX", county: "Llano", landStatus: "fee" },
      // Missing county → skipped, not "failed" and not valued.
      { id: 0, sizeAcres: "5", state: "TX", county: null, landStatus: "fee" },
    ];
    const svc = await importService();
    const counts = await svc.generateBulkValuations("42");
    expect(counts).toEqual({ total: 2, valuated: 0, refused: 1, skipped: 1, failed: 0 });
  });
});
