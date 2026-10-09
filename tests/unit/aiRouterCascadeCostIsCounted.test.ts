/**
 * Every paid call in a cascaded routeAITask reaches telemetry.
 *
 * The quality cascade makes up to three model calls for one task: the primary
 * answer, a DeepSeek grader, and (when the grade is low) an escalated re-ask.
 * Before 2026-10 the recorded cost was ONLY the call whose answer survived —
 * the grader was never counted, and on escalation the discarded primary call
 * vanished too. ai_telemetry_events is what the cost ceilings sum, so every
 * cascaded task under-reported its spend to the very gate meant to bound it.
 *
 * Driven end-to-end through routeAITask with a scripted provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  },
}));
vi.setConfig({ testTimeout: 60_000 });

const ORIGINAL_ENV = { ...process.env };

function reply(content: string, prompt: number, completion: number) {
  return { id: `gen-${Math.random()}`, choices: [{ message: { content } }], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } };
}

async function loadRouter() {
  vi.resetModules();
  vi.doMock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined) }));
  vi.doMock("../../server/services/intelligence/budget", () => ({
    categoryFor: () => "test",
    checkBudget: vi.fn().mockResolvedValue({ withinBudget: true, capCents: 1000, spentCents: 0 }),
    BudgetExceededError: class extends Error {},
  }));
  vi.doMock("../../server/services/ai-telemetry", () => ({
    recordAiCall: vi.fn().mockResolvedValue(undefined),
    complexityClassFromTaskType: () => "other",
    classifyError: () => "unknown",
  }));
  vi.doMock("@shared/schema", () => ({
    aiRoutingOverrides: { active: "active", taskType: "taskType" },
    aiModelConfigs: { enabled: "enabled", weight: "weight" },
    aiTelemetryEvents: {},
  }));
  vi.doMock("../../server/db", () => ({
    db: { select: () => ({ from: () => ({ where: () => [] }) }), insert: () => ({ values: async () => undefined }) },
  }));
  const mod = await import("../../server/services/aiRouter");
  mod.clearAICache();
  return mod;
}

describe("routeAITask cascade — the grader and the discarded answer are paid for, and counted", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    process.env.AI_CASCADE_ENABLED = "true";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("no escalation: answer + grader", async () => {
    const r = await loadRouter();
    createMock
      .mockResolvedValueOnce(reply("A perfectly adequate answer to the question.", 1000, 200)) // primary (DeepSeek)
      .mockResolvedValueOnce(reply('{"score": 9, "reason": "fine"}', 300, 20)); // grader
    const res = await r.routeAITask({ taskType: "summarize", complexity: r.TaskComplexity.SIMPLE, messages: [{ role: "user", content: "q" }] });
    const expected = r.estimateCost(r.MODEL_SIMPLE, 1000, 200) + r.estimateCost(r.MODEL_SIMPLE, 300, 20);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.estimatedCost).toBeCloseTo(expected, 10);
  });

  it("escalation kept: escalated + grader + the DISCARDED primary", async () => {
    const r = await loadRouter();
    createMock
      .mockResolvedValueOnce(reply("A weak answer that the grader will dislike.", 1000, 200)) // primary
      .mockResolvedValueOnce(reply('{"score": 2, "reason": "vague"}', 300, 20)) // grader
      .mockResolvedValueOnce(reply("A much better and more complete escalated answer to the question.", 1100, 300)); // escalated (Haiku)
    const res = await r.routeAITask({ taskType: "summarize", complexity: r.TaskComplexity.SIMPLE, messages: [{ role: "user", content: "q" }] });
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(res.model).toBe(r.MODEL_MODERATE);
    const expected =
      r.estimateCost(r.MODEL_MODERATE, 1100, 300) +
      r.estimateCost(r.MODEL_SIMPLE, 300, 20) +
      r.estimateCost(r.MODEL_SIMPLE, 1000, 200);
    expect(res.estimatedCost).toBeCloseTo(expected, 10);
  });

  it("escalation discarded: primary + grader + the DISCARDED escalated call", async () => {
    const r = await loadRouter();
    createMock
      .mockResolvedValueOnce(reply("A long enough primary answer that will be kept in the end.", 1000, 200))
      .mockResolvedValueOnce(reply('{"score": 3, "reason": "meh"}', 300, 20))
      .mockResolvedValueOnce(reply("x", 1100, 5)); // too short → primary kept
    const res = await r.routeAITask({ taskType: "summarize", complexity: r.TaskComplexity.SIMPLE, messages: [{ role: "user", content: "q" }] });
    expect(res.model).toBe(r.MODEL_SIMPLE);
    const expected =
      r.estimateCost(r.MODEL_SIMPLE, 1000, 200) +
      r.estimateCost(r.MODEL_SIMPLE, 300, 20) +
      r.estimateCost(r.MODEL_MODERATE, 1100, 5);
    expect(res.estimatedCost).toBeCloseTo(expected, 10);
  });
});
