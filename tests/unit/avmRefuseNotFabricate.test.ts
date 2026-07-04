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
 *   2. no comps + AI path produces a value  → status "ok" but
 *      classification "ai_estimate" and methodology says AI estimate
 *   3. comps present → classification "comps_model"
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

  it("labels the LLM path as an AI estimate, never as a modeled value", async () => {
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    state.aiResponse = JSON.stringify({ pricePerAcre: 2500, lowPerAcre: 2000, highPerAcre: 3000, rationale: "test" });
    const svc = await importService();
    const result = await svc.generateValuation("42", REQUEST as any);

    expect(result.status).toBe("ok");
    expect(result.classification).toBe("ai_estimate");
    expect(result.methodology.toLowerCase()).toContain("ai estimate");
    expect(result.methodology.toLowerCase()).not.toContain("proprietary");
    expect(result.estimatedValue).toBe(25_000);
  });

  it("classifies the comps path as comps_model", async () => {
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
    const result = await svc.generateValuation("42", REQUEST as any);

    expect(result.status).toBe("ok");
    expect(result.classification).toBe("comps_model");
    expect(result.estimatedValue).toBeGreaterThan(0);
    expect(result.comparables.length).toBeGreaterThan(0);
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
});
