/**
 * F-16 Phase 1 (Wave 0 item 0.3, 2026-08-09) — tool-aware routeAITask.
 *
 * The router is the platform's AI cost chokepoint (ceiling / quota / budget /
 * telemetry / tier selection). Phase 1 of the F-16 migration plan
 * (docs/audit-2026-08/F-16-router-tool-migration-plan.md) makes it TOOL-AWARE
 * so the tool-calling agents can eventually route through it instead of their
 * own OpenAI clients. Phase 1 is additive and opt-in; this suite pins:
 *
 *   1. `task.tools` / `task.toolChoice` pass through onto the request body
 *      (tool_choice defaults to "auto").
 *   2. A tool_calls response surfaces as AIResponse.toolCalls + finishReason.
 *   3. The multi-turn loop shape round-trips: assistant tool_calls → tool-role
 *      result message → second call carries both verbatim.
 *   4. Opt-in-ness / regression pin: a NO-TOOLS call produces the exact
 *      pre-tool request body key set and a response object with NEITHER
 *      toolCalls NOR finishReason keys — existing callers see byte-identical
 *      shapes.
 *   5. The platform cost ceiling is consulted BEFORE the client call on the
 *      tools path too (ceiling exhausted ⇒ zero model calls).
 *   6. Tools force-disable incompatible features (responseFormat=json /
 *      requestConfidence / useExtendedThinking) — the tool-call decision is
 *      never corrupted by the confidence-schema injection or JSON mode.
 *   7. Tool-calling turns never cache-serve or cache-store (a cached text
 *      entry would strip tool_calls from an agent loop).
 *   8. Tool-calling turns never cascade (the escalated re-ask carries no
 *      tools and would replace a tool decision with prose).
 *
 * HONESTY: everything here runs against a MOCKED OpenAI-compatible client.
 * These tests verify the router's request/response plumbing only — tool
 * routing has NOT been validated against live models; the F-16 plan gates the
 * actual agent migrations (Phases 2–3) on a keyed environment + eval.
 *
 * idempotent: true — client, DB, ceiling, and budget gates are all mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the OpenAI client constructor so routeAITask uses our fake completion
// (same pattern as tests/unit/aiRouterCacheOrgScope.test.ts).
const createMock = vi.fn();
vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: createMock } };
      constructor() {}
    },
  };
});

// The platform cost-ceiling gate, observable so we can assert ordering.
const ceilingMock = vi.fn();

// Module re-imports after vi.resetModules() can be slow under vite-ssr; give
// each test generous headroom.
vi.setConfig({ testTimeout: 60_000 });

describe("routeAITask — tool-aware Phase 1 (F-16)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    createMock.mockReset();
    ceilingMock.mockReset();
    ceilingMock.mockResolvedValue(undefined);
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
    // Cascade off by default — individual tests flip it on (read per call).
    process.env.AI_CASCADE_ENABLED = "false";
    delete process.env.AI_COST_CEILING_BYPASS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  async function loadRouter() {
    vi.resetModules();
    // Stub the gate modules routeAITask dynamically imports so no DB is
    // touched (mirrors aiRouterCacheOrgScope.test.ts).
    vi.doMock("../../server/services/aiCostCeiling", () => ({
      assertWithinAiCostCeiling: ceilingMock,
    }));
    vi.doMock("../../server/services/intelligence/budget", () => ({
      categoryFor: () => "test",
      checkBudget: vi
        .fn()
        .mockResolvedValue({ withinBudget: true, capCents: 1000, spentCents: 0 }),
      BudgetExceededError: class extends Error {},
    }));
    vi.doMock("../../server/services/ai-telemetry", () => ({
      recordAiCall: vi.fn().mockResolvedValue(undefined),
      complexityClassFromTaskType: () => "simple",
      classifyError: () => "unknown",
    }));
    vi.doMock("@shared/schema", () => ({
      aiRoutingOverrides: { active: "active", taskType: "taskType" },
      aiModelConfigs: { enabled: "enabled", weight: "weight" },
      aiTelemetryEvents: {},
      aiUsageDaily: {},
      organizations: {},
    }));
    vi.doMock("../../server/db", () => ({
      db: {
        select: () => ({ from: () => ({ where: () => [] }) }),
        insert: () => ({ values: async () => undefined }),
      },
    }));
    const mod = await import("../../server/services/aiRouter");
    mod.clearAICache();
    return mod;
  }

  const TOOL_DEF = {
    type: "function" as const,
    function: {
      name: "lookup_lead",
      description: "Look up a lead by id",
      parameters: {
        type: "object",
        properties: { leadId: { type: "number" } },
        required: ["leadId"],
      },
    },
  };

  const TOOL_CALL = {
    id: "call_1",
    type: "function" as const,
    function: { name: "lookup_lead", arguments: '{"leadId":7}' },
  };

  function mockToolCallResponse() {
    createMock.mockResolvedValueOnce({
      id: "resp_tools_1",
      choices: [
        {
          message: { content: null, tool_calls: [TOOL_CALL] },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
    });
  }

  function mockTextResponse(text: string) {
    createMock.mockResolvedValueOnce({
      id: "resp_text_1",
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
    });
  }

  it("(1) tools + tool_choice pass through to the request body; tool_choice defaults to auto", async () => {
    const router = await loadRouter();
    mockToolCallResponse();

    await router.routeAITask(
      {
        taskType: "va_agent",
        complexity: router.TaskComplexity.MODERATE,
        messages: [
          { role: "system", content: "You are the VA agent." },
          { role: "user", content: "Score lead 7" },
        ],
        tools: [TOOL_DEF],
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0][0];
    expect(body.tools).toEqual([TOOL_DEF]);
    expect(body.tool_choice).toBe("auto");

    // Explicit toolChoice passes through untouched.
    mockToolCallResponse();
    await router.routeAITask(
      {
        taskType: "va_agent",
        complexity: router.TaskComplexity.MODERATE,
        messages: [{ role: "user", content: "Score lead 7 again" }],
        tools: [TOOL_DEF],
        toolChoice: { type: "function", function: { name: "lookup_lead" } },
      },
      { skipQuota: true, skipBudget: true },
    );
    const body2 = createMock.mock.calls[1][0];
    expect(body2.tool_choice).toEqual({
      type: "function",
      function: { name: "lookup_lead" },
    });
  });

  it("(2) a tool_calls response surfaces as AIResponse.toolCalls + finishReason", async () => {
    const router = await loadRouter();
    mockToolCallResponse();

    const res = await router.routeAITask(
      {
        taskType: "va_agent",
        complexity: router.TaskComplexity.MODERATE,
        messages: [{ role: "user", content: "Score lead 7" }],
        tools: [TOOL_DEF],
      },
      { skipQuota: true, skipBudget: true },
    );

    expect(res.toolCalls).toEqual([TOOL_CALL]);
    expect(res.finishReason).toBe("tool_calls");
    // Pure tool-call turn: content is empty string (null on the wire).
    expect(res.content).toBe("");
    expect(res.usage).toEqual({
      promptTokens: 20,
      completionTokens: 6,
      totalTokens: 26,
    });
  });

  it("(3) the multi-turn loop round-trips: assistant tool_calls → tool result → second call", async () => {
    const router = await loadRouter();
    mockToolCallResponse();

    const baseTask = {
      taskType: "va_agent",
      complexity: router.TaskComplexity.MODERATE,
      tools: [TOOL_DEF],
    };
    const messages: import("../../server/services/aiRouter").AIMessage[] = [
      { role: "system", content: "You are the VA agent." },
      { role: "user", content: "Score lead 7" },
    ];

    const first = await router.routeAITask(
      { ...baseTask, messages },
      { skipQuota: true, skipBudget: true },
    );
    expect(first.toolCalls?.length).toBe(1);

    // Feed the tool turn back exactly the way an agent loop would.
    messages.push(
      { role: "assistant", content: null, tool_calls: first.toolCalls },
      { role: "tool", tool_call_id: "call_1", content: '{"score":82}' },
    );

    mockTextResponse("Lead 7 scores 82 — worth a call.");
    const second = await router.routeAITask(
      { ...baseTask, messages },
      { skipQuota: true, skipBudget: true },
    );

    // The second request carried the full tool turn verbatim.
    expect(createMock).toHaveBeenCalledTimes(2);
    const body2 = createMock.mock.calls[1][0];
    expect(body2.messages).toEqual(messages);
    expect(body2.tools).toEqual([TOOL_DEF]);

    // And the text answer terminates the loop shape.
    expect(second.content).toBe("Lead 7 scores 82 — worth a call.");
    expect(second.toolCalls).toBeUndefined();
    expect(second.finishReason).toBe("stop");
  });

  it("(4) REGRESSION PIN: a no-tools call produces the exact pre-tool request and response shapes", async () => {
    const router = await loadRouter();
    mockTextResponse("plain answer");

    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "hello" },
    ];
    const res = await router.routeAITask(
      {
        taskType: "basic_analysis",
        complexity: router.TaskComplexity.MODERATE,
        messages,
      },
      { skipQuota: true, skipBudget: true },
    );

    // Request: exactly the four pre-tool keys — no tools, no tool_choice.
    const body = createMock.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "temperature",
    ]);
    expect(body.messages).toEqual(messages);
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.7);

    // Response: NEITHER tool field exists — not even as an undefined key.
    expect("toolCalls" in res).toBe(false);
    expect("finishReason" in res).toBe(false);
    expect(res.content).toBe("plain answer");
  });

  it("(5) the cost ceiling is consulted BEFORE the client call on the tools path", async () => {
    const router = await loadRouter();

    // Happy path first: ceiling runs, and strictly before the model call.
    mockToolCallResponse();
    await router.routeAITask(
      {
        taskType: "va_agent",
        complexity: router.TaskComplexity.MODERATE,
        messages: [{ role: "user", content: "Score lead 7" }],
        tools: [TOOL_DEF],
      },
      { skipQuota: true, skipBudget: true },
    );
    expect(ceilingMock).toHaveBeenCalledTimes(1);
    expect(ceilingMock.mock.invocationCallOrder[0]).toBeLessThan(
      createMock.mock.invocationCallOrder[0],
    );

    // Exhausted ceiling: the coded error propagates and the client is NEVER
    // called — tools are not a bypass lane around the envelope.
    createMock.mockClear();
    ceilingMock.mockRejectedValueOnce(
      Object.assign(new Error("platform AI ceiling exhausted"), {
        code: "AI_COST_CEILING_EXCEEDED",
      }),
    );
    await expect(
      router.routeAITask(
        {
          taskType: "va_agent",
          complexity: router.TaskComplexity.MODERATE,
          messages: [{ role: "user", content: "Score lead 7" }],
          tools: [TOOL_DEF],
        },
        { skipQuota: true, skipBudget: true },
      ),
    ).rejects.toMatchObject({ code: "AI_COST_CEILING_EXCEEDED" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(6) tools force-disable responseFormat=json / requestConfidence / useExtendedThinking", async () => {
    const router = await loadRouter();
    mockToolCallResponse();

    const res = await router.routeAITask(
      {
        taskType: "va_agent",
        complexity: router.TaskComplexity.MODERATE,
        messages: [
          { role: "system", content: "short sys" },
          { role: "user", content: "Score lead 7" },
        ],
        tools: [TOOL_DEF],
        responseFormat: "json",
        requestConfidence: true,
        useExtendedThinking: true,
        thinkingBudget: 2000,
      },
      { skipQuota: true, skipBudget: true },
    );

    const body = createMock.mock.calls[0][0];
    expect(body.response_format).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    // Thinking would force temperature 1 — disabled, so the default holds.
    expect(body.temperature).toBe(0.7);
    // The confidence-schema instruction was NOT injected into the system msg.
    expect(body.messages[0].content).toBe("short sys");
    // Confidence stays off (undefined = feature off, never fabricated).
    expect(res.confidence).toBeUndefined();
    expect(res.toolCalls).toEqual([TOOL_CALL]);
  });

  it("(7) tool-calling turns never cache-serve or cache-store", async () => {
    const router = await loadRouter();

    // Would-be-cacheable shape (SIMPLE + temp ≤ 0.3) — but tools opt out.
    const task = () => ({
      taskType: "simple_qa",
      complexity: router.TaskComplexity.SIMPLE,
      messages: [{ role: "user" as const, content: "Score lead 7" }],
      temperature: 0.2,
      tools: [TOOL_DEF],
    });

    mockToolCallResponse();
    await router.routeAITask(task(), { skipQuota: true, skipBudget: true });
    mockToolCallResponse();
    await router.routeAITask(task(), { skipQuota: true, skipBudget: true });

    // Identical calls, TWO model invocations — nothing served from cache,
    // and nothing was stored either.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(router.getAICacheStats().size).toBe(0);
    expect(router.getAICacheStats().hits).toBe(0);
  });

  it("(8) tool-calling turns never cascade — and the guard is non-vacuous", async () => {
    const router = await loadRouter();
    process.env.AI_CASCADE_ENABLED = "true";

    // Non-vacuity: a NO-TOOLS call under the same conditions DOES trigger the
    // quality-check client call (≥ 2 create calls), proving the cascade is
    // live in this configuration.
    mockTextResponse(
      "A long enough plain answer that clears the twenty character bar.",
    );
    createMock.mockResolvedValueOnce({
      id: "resp_quality",
      choices: [{ message: { content: '{"score":9,"reason":"ok"}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });
    await router.routeAITask(
      {
        taskType: "basic_analysis",
        complexity: router.TaskComplexity.MODERATE,
        messages: [{ role: "user", content: "Explain lead 7 in detail" }],
      },
      { skipQuota: true, skipBudget: true },
    );
    expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Same conditions WITH tools: exactly one model call — no quality check,
    // no escalated re-ask that would strip the tool_calls decision.
    createMock.mockClear();
    createMock.mockResolvedValueOnce({
      id: "resp_tools_long",
      choices: [
        {
          message: {
            content:
              "Thinking out loud before calling a tool, well past twenty chars.",
            tool_calls: [TOOL_CALL],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
    });
    const res = await router.routeAITask(
      {
        taskType: "basic_analysis",
        complexity: router.TaskComplexity.MODERATE,
        messages: [{ role: "user", content: "Explain lead 7 in detail" }],
        tools: [TOOL_DEF],
      },
      { skipQuota: true, skipBudget: true },
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.toolCalls).toEqual([TOOL_CALL]);
  });
});
