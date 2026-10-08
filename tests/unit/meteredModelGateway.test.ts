/**
 * The metered raw-call path (aiSpendGuard.meteredChatCompletion /
 * meteredAnthropicMessage) — the tool-aware half of the one AI gateway.
 *
 * Every property is pinned BEHAVIOURALLY against a provider double, because
 * the gateway's whole value is what it does around a call that otherwise looks
 * identical:
 *   - the ceiling runs BEFORE the provider is touched, and an exceeded ceiling
 *     means the provider is never called (not "called and then reported");
 *   - read-error posture: customer-facing fails open, background fails closed;
 *   - telemetry lands in ai_telemetry_events (what the ceilings SUM) with the
 *     cost computed from the real price table, cache reads at the cached rate;
 *   - BYOK skips the ceiling and records $0;
 *   - a failed call is recorded as a failure and re-thrown unchanged;
 *   - a long stable system prompt gets an Anthropic cache breakpoint, and
 *     nothing else about the request changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  assertWithinAiCostCeiling: vi.fn(async (_org: number | null, _o?: unknown) => {}),
  inserted: [] as Record<string, unknown>[],
  aiCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../server/services/aiCostCeiling", () => ({
  assertWithinAiCostCeiling: h.assertWithinAiCostCeiling,
}));
vi.mock("../../server/db", () => ({
  db: { insert: () => ({ values: async (v: Record<string, unknown>) => { h.inserted.push(v); } }) },
}));
vi.mock("@shared/schema", () => ({ aiTelemetryEvents: { __table: "ai_telemetry_events" } }));
vi.mock("../../server/services/ai-telemetry", () => ({
  recordAiCall: async (o: Record<string, unknown>) => { h.aiCalls.push(o); },
  complexityClassFromTaskType: () => "other",
  classifyError: () => "unknown",
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  meteredChatCompletion,
  meteredAnthropicMessage,
  withPromptCache,
} from "../../server/services/aiSpendGuard";
import { computeCostUsd } from "../../server/services/aiCostRates";

const flush = () => new Promise((r) => setTimeout(r, 5));
const ceilingErr = () => Object.assign(new Error("over"), { code: "AI_COST_CEILING_EXCEEDED" });

function openaiDouble(response: unknown = {
  id: "gen-1",
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 600 } },
}) {
  const create = vi.fn(async (_b: any, _o?: any) => response);
  return { client: { chat: { completions: { create } } }, create };
}

const LONG = "x".repeat(2000);

describe("meteredChatCompletion", () => {
  beforeEach(() => {
    h.assertWithinAiCostCeiling.mockReset();
    h.assertWithinAiCostCeiling.mockResolvedValue(undefined);
    h.inserted.length = 0;
    h.aiCalls.length = 0;
    delete process.env.AI_COST_CEILING_BYPASS;
  });

  it("checks the ceiling for the org BEFORE calling the provider", async () => {
    const { client, create } = openaiDouble();
    const order: string[] = [];
    h.assertWithinAiCostCeiling.mockImplementation(async () => { order.push("ceiling"); });
    create.mockImplementation(async () => { order.push("provider"); return { choices: [] }; });
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }, { taskType: "due_diligence", orgId: 7, origin: "customer" });
    expect(order).toEqual(["ceiling", "provider"]);
    expect(h.assertWithinAiCostCeiling).toHaveBeenCalledWith(7, undefined);
  });

  it("background callers ask the ceiling to fail closed", async () => {
    const { client } = openaiDouble();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: null, origin: "background" });
    expect(h.assertWithinAiCostCeiling).toHaveBeenCalledWith(null, { failClosed: true });
  });

  it("an exceeded ceiling refuses — the provider is never called", async () => {
    const { client, create } = openaiDouble();
    h.assertWithinAiCostCeiling.mockRejectedValue(ceilingErr());
    await expect(
      meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: 7, origin: "customer" }),
    ).rejects.toMatchObject({ code: "AI_COST_CEILING_EXCEEDED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a ceiling READ error: customer-facing proceeds, background refuses", async () => {
    h.assertWithinAiCostCeiling.mockRejectedValue(new Error("db down"));
    const a = openaiDouble();
    await expect(
      meteredChatCompletion(a.client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: 7, origin: "customer" }),
    ).resolves.toBeDefined();
    const b = openaiDouble();
    await expect(
      meteredChatCompletion(b.client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: 7, origin: "background" }),
    ).rejects.toThrow("db down");
    expect(b.create).not.toHaveBeenCalled();
  });

  it("records the call where the ceilings can see it, priced from the real table with cache reads discounted", async () => {
    const { client } = openaiDouble();
    await meteredChatCompletion(client, { model: "anthropic/claude-sonnet-4-6", messages: [] }, { taskType: "document_intelligence", orgId: 7, origin: "customer" });
    await flush();
    expect(h.inserted).toHaveLength(1);
    const row = h.inserted[0];
    expect(row).toMatchObject({ organizationId: 7, taskType: "document_intelligence", promptTokens: 1000, completionTokens: 200, success: true });
    const expectedUsd = computeCostUsd("anthropic/claude-sonnet-4-6", 1000, 200, 600);
    expect(Number(row.estimatedCostCents)).toBeCloseTo(expectedUsd * 100, 4);
    expect(Number(row.estimatedCostCents)).toBeGreaterThan(0);
    // …and the cascade/ledger record carries the response id for idempotency.
    expect(h.aiCalls[0]).toMatchObject({ organizationId: 7, feature: "document_intelligence", openrouterResponseId: "gen-1", cachedInputTokens: 600 });
  });

  it("BYOK: no ceiling, and $0 recorded", async () => {
    const { client } = openaiDouble();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: 7, origin: "customer", byok: true });
    await flush();
    expect(h.assertWithinAiCostCeiling).not.toHaveBeenCalled();
    expect(Number(h.inserted[0].estimatedCostCents)).toBe(0);
  });

  it("a failed call is recorded as a failure and re-thrown unchanged", async () => {
    const { client, create } = openaiDouble();
    const boom = new Error("provider 500");
    create.mockRejectedValue(boom);
    await expect(
      meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "x", orgId: 7, origin: "customer" }),
    ).rejects.toBe(boom);
    await flush();
    expect(h.inserted[0]).toMatchObject({ success: false });
    expect(Number(h.inserted[0].estimatedCostCents)).toBe(0);
  });

  it("passes the request through unchanged apart from the cache breakpoint", async () => {
    const { client, create } = openaiDouble();
    const tools = [{ type: "function", function: { name: "t", parameters: {} } }] as any;
    await meteredChatCompletion(
      client,
      { model: "anthropic/claude-sonnet-4-6", messages: [{ role: "system", content: LONG }, { role: "user", content: "q" }], tools, max_tokens: 99 },
      { taskType: "x", orgId: 7, origin: "customer" },
      { timeout: 5 },
    );
    const [body, opts] = create.mock.calls[0];
    expect(body.model).toBe("anthropic/claude-sonnet-4-6");
    expect(body.tools).toBe(tools);
    expect(body.max_tokens).toBe(99);
    expect(body.messages[0]).toEqual({ role: "system", content: LONG, cache_control: { type: "ephemeral" } });
    expect(body.messages[1]).toEqual({ role: "user", content: "q" });
    expect(opts).toEqual({ timeout: 5 });
  });
});

describe("withPromptCache", () => {
  it("stamps only Anthropic models with a long string system prompt, once", () => {
    const p = withPromptCache({ model: "anthropic/claude-haiku-4.5", messages: [{ role: "system", content: LONG }, { role: "system", content: LONG }] });
    expect((p.messages[0] as any).cache_control).toEqual({ type: "ephemeral" });
    expect((p.messages[1] as any).cache_control).toBeUndefined();
  });
  it("leaves OpenAI models (provider-side automatic caching), short prompts, and pre-stamped prompts alone", () => {
    const a = { model: "openai/gpt-4o", messages: [{ role: "system", content: LONG }] };
    expect(withPromptCache(a)).toBe(a);
    const b = { model: "anthropic/claude-sonnet-4-6", messages: [{ role: "system", content: "short" }] };
    expect(withPromptCache(b)).toBe(b);
    const c = { model: "anthropic/claude-sonnet-4-6", messages: [{ role: "system", content: LONG, cache_control: { type: "ephemeral" } }] };
    expect(withPromptCache(c)).toBe(c);
  });
});

describe("meteredAnthropicMessage", () => {
  beforeEach(() => {
    h.assertWithinAiCostCeiling.mockReset();
    h.assertWithinAiCostCeiling.mockResolvedValue(undefined);
    h.inserted.length = 0;
    h.aiCalls.length = 0;
  });

  it("costs input + cache read + cache write as the prompt, cache read at the cached rate", async () => {
    const create = vi.fn(async () => ({
      id: "msg_1",
      content: [],
      usage: { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200 },
    }));
    await meteredAnthropicMessage({ messages: { create } }, { model: "claude-sonnet-4-6", system: "s", messages: [] }, { taskType: "solene_dispatch", orgId: null, origin: "background" });
    await flush();
    const row = h.inserted[0];
    expect(row).toMatchObject({ model: "anthropic/claude-sonnet-4-6", promptTokens: 5500, completionTokens: 100 });
    const expected = computeCostUsd("anthropic/claude-sonnet-4-6", 5500, 100, 5000);
    expect(Number(row.estimatedCostCents)).toBeCloseTo(expected * 100, 4);
    expect(h.assertWithinAiCostCeiling).toHaveBeenCalledWith(null, { failClosed: true });
  });

  it("a long string system becomes one cached text block with identical text", async () => {
    const create = vi.fn(async (_b: any, _o?: any) => ({ usage: {} }));
    await meteredAnthropicMessage({ messages: { create } }, { model: "claude-haiku-4-5-20251001", system: LONG, messages: [] }, { taskType: "x", orgId: null, origin: "background" }, { timeout: 1 });
    const [body, opts] = create.mock.calls[0];
    expect(body.system).toEqual([{ type: "text", text: LONG, cache_control: { type: "ephemeral" } }]);
    expect(opts).toEqual({ timeout: 1 });
  });

  it("an array system (already cache-shaped by the caller) is untouched", async () => {
    const create = vi.fn(async (_b: any) => ({ usage: {} }));
    const system = [{ type: "text", text: LONG, cache_control: { type: "ephemeral" } }, { type: "text", text: "dyn" }];
    await meteredAnthropicMessage({ messages: { create } }, { model: "claude-opus-4-8", system, messages: [] }, { taskType: "x", orgId: null, origin: "background" });
    expect(create.mock.calls[0][0].system).toBe(system);
  });

  it("an exceeded ceiling means the model is never called", async () => {
    const create = vi.fn();
    h.assertWithinAiCostCeiling.mockRejectedValue(ceilingErr());
    await expect(
      meteredAnthropicMessage({ messages: { create } }, { model: "claude-opus-4-8", messages: [] }, { taskType: "x", orgId: null, origin: "background" }),
    ).rejects.toMatchObject({ code: "AI_COST_CEILING_EXCEEDED" });
    expect(create).not.toHaveBeenCalled();
  });
});
