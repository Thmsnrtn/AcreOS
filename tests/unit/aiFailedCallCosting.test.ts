/**
 * P1-5 / I-5 R5 — failed attempts stop recording $0.
 *
 * Before P1-5 every metered path wrote estimatedCostCents: 0 for a
 * failed call, so provider-billed tokens on timed-out / retried /
 * mid-stream-failed attempts were invisible to every ceiling. Pins:
 *   - the floor estimate itself (input priced via the central table,
 *     output 0; empty request → honestly 0; unknown model → the
 *     table's dearest rate, never a silent cheap fallback);
 *   - the metered chat wrapper records the estimate (≥1¢) for a failed
 *     non-empty request, keeps $0 for a genuinely empty one, and keeps
 *     $0 for BYOK failures (the customer's key paid, not the platform);
 *   - recordExternalAiSpend's explicit override wins over its
 *     token-derived computation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { estimateFailedCallCostCents, estimateTokensFromChars, getRate } from "../../server/services/aiCostRates";

describe("estimateFailedCallCostCents — the named floor estimate", () => {
  it("an empty request is honestly 0", () => {
    expect(estimateFailedCallCostCents("openai/gpt-4o", 0)).toBe(0);
  });

  it("prices the input in full and the output at 0", () => {
    const chars = 40_000; // 10,000 estimated tokens
    const tokens = estimateTokensFromChars(chars);
    const expected = (tokens * getRate("openai/gpt-4o").input) / 1_000_000 * 100;
    expect(estimateFailedCallCostCents("openai/gpt-4o", chars)).toBeCloseTo(expected, 6);
    expect(estimateFailedCallCostCents("openai/gpt-4o", chars)).toBeGreaterThan(0);
  });

  it("an unknown model is priced at the dearest known rate, never $0-cheap", () => {
    const known = estimateFailedCallCostCents("anthropic/claude-opus-4", 40_000);
    const unknown = estimateFailedCallCostCents("mystery/model-x", 40_000);
    expect(unknown).toBe(known);
  });
});

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

import { meteredChatCompletion, recordExternalAiSpend } from "../../server/services/aiSpendGuard";

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("metered wrappers — a failed attempt is not $0 (R5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.inserted.length = 0;
    delete process.env.AI_COST_CEILING_BYPASS;
  });

  it("records the floor estimate (≥1¢) for a failed non-empty request, success=false", async () => {
    const create = vi.fn(async () => { throw new Error("provider timeout after generation"); });
    await expect(
      meteredChatCompletion(
        { chat: { completions: { create } } },
        { model: "openai/gpt-4o", messages: [{ role: "user", content: "x".repeat(4000) }] },
        { taskType: "x", orgId: 7, origin: "customer" },
      ),
    ).rejects.toThrow("provider timeout");
    await flush();
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].success).toBe(false);
    expect(Number(h.inserted[0].estimatedCostCents)).toBeGreaterThanOrEqual(1);
  });

  it("keeps $0 for a genuinely empty failed request (nothing was sent to price)", async () => {
    const create = vi.fn(async () => { throw new Error("provider 500"); });
    await expect(
      meteredChatCompletion(
        { chat: { completions: { create } } },
        { model: "openai/gpt-4o", messages: [] },
        { taskType: "x", orgId: 7, origin: "customer" },
      ),
    ).rejects.toThrow("provider 500");
    await flush();
    expect(Number(h.inserted[0].estimatedCostCents)).toBe(0);
  });

  it("keeps $0 for a BYOK failure (the customer's key paid, not the platform)", async () => {
    const create = vi.fn(async () => { throw new Error("provider 500"); });
    await expect(
      meteredChatCompletion(
        { chat: { completions: { create } } },
        { model: "openai/gpt-4o", messages: [{ role: "user", content: "x".repeat(4000) }] },
        { taskType: "x", orgId: 7, origin: "customer", byok: true },
      ),
    ).rejects.toThrow("provider 500");
    await flush();
    expect(Number(h.inserted[0].estimatedCostCents)).toBe(0);
  });

  it("recordExternalAiSpend's override wins over the token-derived cost", async () => {
    recordExternalAiSpend({
      orgId: null,
      taskType: "solene_chat",
      model: "anthropic/claude-sonnet-4.6",
      promptTokens: 0,
      completionTokens: 0,
      success: false,
      estimatedCostCentsOverride: 3,
    });
    await flush();
    expect(h.inserted).toHaveLength(1);
    expect(Number(h.inserted[0].estimatedCostCents)).toBeCloseTo(3, 4);
    expect(h.inserted[0].organizationId).toBeNull();
  });
});
