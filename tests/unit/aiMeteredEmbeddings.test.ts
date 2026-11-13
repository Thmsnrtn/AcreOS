/**
 * P1-5 / I-5 R2 (metered half) — embeddings go through the gateway now.
 * Pins meteredEmbeddingsCreate: the ceiling runs BEFORE the provider,
 * telemetry lands priced by the embedding rate ($0.02/1M input), and a
 * provider failure records the R5 floor estimate and rethrows so the
 * caller's existing fallback (null / simple embedding) still engages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  assertWithinAiCostCeiling: vi.fn(async () => {}),
  inserted: [] as Record<string, unknown>[],
}));
vi.mock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: h.assertWithinAiCostCeiling }));
vi.mock("../../server/db", () => ({
  db: { insert: () => ({ values: async (v: Record<string, unknown>) => { h.inserted.push(v); } }) },
}));
vi.mock("@shared/schema", () => ({ aiTelemetryEvents: { __table: "ai_telemetry_events" } }));
vi.mock("../../server/services/ai-telemetry", () => ({
  recordAiCall: async () => {},
  complexityClassFromTaskType: () => "other",
  classifyError: () => "unknown",
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { meteredEmbeddingsCreate } from "../../server/services/aiSpendGuard";
import { computeCostUsd } from "../../server/services/aiCostRates";

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("meteredEmbeddingsCreate (R2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.inserted.length = 0;
    delete process.env.AI_COST_CEILING_BYPASS;
  });

  it("checks the ceiling before the provider and records telemetry at the embedding rate", async () => {
    const order: string[] = [];
    h.assertWithinAiCostCeiling.mockImplementation(async () => { order.push("ceiling"); });
    const create = vi.fn(async () => {
      order.push("provider");
      return { data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 500_000, total_tokens: 500_000 } };
    });
    const res = await meteredEmbeddingsCreate(
      { embeddings: { create } },
      { model: "text-embedding-3-small", input: "hello" },
      { taskType: "embedding_query", origin: "customer" },
    );
    expect(res.data[0].embedding).toEqual([0.1, 0.2]);
    expect(order).toEqual(["ceiling", "provider"]);
    await flush();
    expect(h.inserted).toHaveLength(1);
    const row = h.inserted[0];
    expect(row).toMatchObject({ taskType: "embedding_query", model: "text-embedding-3-small", promptTokens: 500_000, success: true });
    // 500k tokens × $0.02/1M = $0.01 = 1¢.
    expect(Number(row.estimatedCostCents)).toBeCloseTo(computeCostUsd("text-embedding-3-small", 500_000, 0) * 100, 4);
    expect(Number(row.estimatedCostCents)).toBeGreaterThan(0);
  });

  it("a provider failure records the floor estimate (not $0) and rethrows for the caller's fallback", async () => {
    const create = vi.fn(async () => { throw new Error("embeddings 429"); });
    await expect(
      meteredEmbeddingsCreate(
        { embeddings: { create } },
        { model: "text-embedding-3-small", input: "x".repeat(8000) },
        { taskType: "embedding_batch", origin: "background" },
      ),
    ).rejects.toThrow("embeddings 429");
    await flush();
    expect(h.inserted[0].success).toBe(false);
    expect(Number(h.inserted[0].estimatedCostCents)).toBeGreaterThanOrEqual(1);
  });

  it("an exceeded ceiling refuses before the provider is touched", async () => {
    h.assertWithinAiCostCeiling.mockRejectedValue(Object.assign(new Error("over"), { code: "AI_COST_CEILING_EXCEEDED" }));
    const create = vi.fn();
    await expect(
      meteredEmbeddingsCreate(
        { embeddings: { create } },
        { model: "text-embedding-3-small", input: "hi" },
        { taskType: "embedding_query", origin: "customer" },
      ),
    ).rejects.toMatchObject({ code: "AI_COST_CEILING_EXCEEDED" });
    expect(create).not.toHaveBeenCalled();
  });
});
