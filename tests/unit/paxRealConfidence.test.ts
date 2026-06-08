import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// PROOF that Pax confidence now derives from REAL signals, not constants.
//
//  1. aiRouter.extractModelConfidence — parses MODEL self-reported confidence
//     out of a JSON response, returns honest-null when absent/malformed.
//  2. routeAITask(requestConfidence) — a mocked model that emits a known
//     confidence flows that exact value through to AIResponse.confidence; a
//     model that omits it yields honest-null.
//  3. paxObserver.detectorConfidence — evidence-derived (signal strength +
//     sample size), monotonic, never a fixed constant.
//  4. aiRouter env knobs default to current behavior (no change when unset).
// ============================================================================

import {
  extractModelConfidence,
  CONFIDENCE_SCHEMA_INSTRUCTION,
} from "../../server/services/aiRouter";
import { detectorConfidence } from "../../server/services/paxObserver";

describe("aiRouter.extractModelConfidence — model self-reported confidence parse", () => {
  it("extracts a valid 0..1 confidence from a JSON object", () => {
    expect(extractModelConfidence('{"answer":"x","confidence":0.73}')).toBe(0.73);
    expect(extractModelConfidence('{"confidence":0}')).toBe(0);
    expect(extractModelConfidence('{"confidence":1}')).toBe(1);
  });

  it("coerces a numeric string confidence", () => {
    expect(extractModelConfidence('{"confidence":"0.5"}')).toBe(0.5);
  });

  it("extracts from a JSON object embedded in prose", () => {
    expect(
      extractModelConfidence('Here is my answer.\n{"confidence":0.42}\nThanks.'),
    ).toBe(0.42);
  });

  it("returns honest-null (NOT a constant) when confidence is absent", () => {
    expect(extractModelConfidence('{"answer":"no confidence here"}')).toBeNull();
  });

  it("returns honest-null on out-of-range / malformed values", () => {
    expect(extractModelConfidence('{"confidence":1.5}')).toBeNull();
    expect(extractModelConfidence('{"confidence":-0.2}')).toBeNull();
    expect(extractModelConfidence('{"confidence":"high"}')).toBeNull();
    expect(extractModelConfidence("not json at all")).toBeNull();
    expect(extractModelConfidence("")).toBeNull();
  });

  it("the schema instruction asks for a 0..1 confidence field", () => {
    expect(CONFIDENCE_SCHEMA_INSTRUCTION.toLowerCase()).toContain("confidence");
    expect(CONFIDENCE_SCHEMA_INSTRUCTION).toMatch(/0\.0 to 1\.0|0\.\.1|0 to 1/i);
  });
});

describe("paxObserver.detectorConfidence — evidence-derived, not constant", () => {
  it("is monotonic in signal strength (stronger condition ⇒ higher confidence)", () => {
    const weak = detectorConfidence({ signalStrength: 0.1, sampleSize: 3 });
    const strong = detectorConfidence({ signalStrength: 0.9, sampleSize: 3 });
    expect(strong).toBeGreaterThan(weak);
  });

  it("is monotonic in sample size (more corroboration ⇒ higher confidence)", () => {
    const few = detectorConfidence({ signalStrength: 0.5, sampleSize: 1 });
    const many = detectorConfidence({ signalStrength: 0.5, sampleSize: 20 });
    expect(many).toBeGreaterThan(few);
  });

  it("stays within [floor, ceiling] and returns an integer", () => {
    const c = detectorConfidence({ signalStrength: 2, sampleSize: 1000 });
    expect(c).toBeLessThanOrEqual(95);
    expect(c).toBeGreaterThanOrEqual(50);
    expect(Number.isInteger(c)).toBe(true);
  });

  it("respects custom floor/ceiling", () => {
    const c = detectorConfidence({
      signalStrength: 0,
      sampleSize: 0,
      floor: 70,
      ceiling: 98,
    });
    expect(c).toBe(70); // zero evidence pins to the floor, not a magic constant
  });

  it("does NOT collapse to a single constant across different inputs", () => {
    const values = new Set([
      detectorConfidence({ signalStrength: 0.2, sampleSize: 1 }),
      detectorConfidence({ signalStrength: 0.5, sampleSize: 3 }),
      detectorConfidence({ signalStrength: 0.8, sampleSize: 10 }),
      detectorConfidence({ signalStrength: 1, sampleSize: 30 }),
    ]);
    expect(values.size).toBeGreaterThan(1);
  });
});

// ── End-to-end: a mocked model's confidence flows through routeAITask ────────
// We mock the OpenAI client constructor so routeAITask uses our fake completion.
const createMock = vi.fn();
vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: createMock } };
      constructor() {}
    },
  };
});

describe("routeAITask(requestConfidence) — real model confidence end-to-end", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    createMock.mockReset();
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    // Skip all the budget/quota/ceiling DB gates for a pure unit test.
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  async function loadRouter() {
    vi.resetModules();
    // Stub the gate modules routeAITask dynamically imports so no DB is touched.
    vi.doMock("../../server/services/aiCostCeiling", () => ({
      assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../server/services/intelligence/budget", () => ({
      categoryFor: () => "test",
      checkBudget: vi
        .fn()
        .mockResolvedValue({ withinBudget: true, capCents: 1000, spentCents: 0 }),
      BudgetExceededError: class extends Error {},
    }));
    // No routing overrides / db model configs.
    vi.doMock("../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: () => [] }) }) } }));
    return await import("../../server/services/aiRouter");
  }

  it("flows the model's self-reported confidence through to AIResponse.confidence", async () => {
    const router = await loadRouter();
    createMock.mockResolvedValue({
      id: "resp_1",
      choices: [{ message: { content: '{"answer":"42","confidence":0.91}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const res = await router.routeAITask(
      {
        taskType: "simple_qa",
        complexity: router.TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: "You answer questions." },
          { role: "user", content: "What is the answer?" },
        ],
        requestConfidence: true,
        temperature: 0.7,
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(res.confidence).toBe(0.91);

    // And the router actually asked the model for confidence (JSON mode + instruction).
    const sent = createMock.mock.calls[0][0];
    expect(sent.response_format).toEqual({ type: "json_object" });
    const sysMsg = sent.messages.find((m: any) => m.role === "system");
    expect(sysMsg.content).toContain("confidence");
  });

  it("returns honest-null when confidence was requested but the model omitted it", async () => {
    const router = await loadRouter();
    createMock.mockResolvedValue({
      id: "resp_2",
      choices: [{ message: { content: '{"answer":"no confidence field here at all"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const res = await router.routeAITask(
      {
        taskType: "simple_qa",
        complexity: router.TaskComplexity.SIMPLE,
        messages: [{ role: "user", content: "Q?" }],
        requestConfidence: true,
        temperature: 0.7,
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(res.confidence).toBeNull();
  });

  it("AI_CASCADE_ENABLED=false disables the quality-cascade (single model call)", async () => {
    process.env.AI_CASCADE_ENABLED = "false";
    const router = await loadRouter();
    // A SIMPLE task with a long response would normally trigger a quality check
    // (a SECOND model call). With the cascade disabled, only the primary call
    // should happen.
    createMock.mockResolvedValue({
      id: "resp_c",
      choices: [{ message: { content: "x".repeat(200) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await router.routeAITask(
      {
        taskType: "simple_qa",
        complexity: router.TaskComplexity.SIMPLE,
        messages: [{ role: "user", content: "Q?" }],
        temperature: 0.7,
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(createMock).toHaveBeenCalledTimes(1); // no quality-check call
  });

  it("default (unset AI_CASCADE_ENABLED) runs the quality check — current behavior", async () => {
    delete process.env.AI_CASCADE_ENABLED;
    const router = await loadRouter();
    createMock.mockResolvedValue({
      id: "resp_d",
      choices: [{ message: { content: "x".repeat(200) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await router.routeAITask(
      {
        taskType: "simple_qa",
        complexity: router.TaskComplexity.SIMPLE,
        messages: [{ role: "user", content: "Q?" }],
        temperature: 0.7,
      },
      { skipQuota: true, skipBudget: true },
    );

    // Primary call + quality-check call = 2 (the cascade default is unchanged).
    expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves confidence undefined (feature off) when not requested", async () => {
    const router = await loadRouter();
    createMock.mockResolvedValue({
      id: "resp_3",
      choices: [{ message: { content: '{"answer":"hi","confidence":0.5}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const res = await router.routeAITask(
      {
        taskType: "simple_qa",
        complexity: router.TaskComplexity.SIMPLE,
        messages: [{ role: "user", content: "Q?" }],
        temperature: 0.7,
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(res.confidence).toBeUndefined();
  });
});
