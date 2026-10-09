/**
 * The shared monthly AI allowance reaches every customer-triggered AI call,
 * not only chat (founder decision 2026-10-08).
 *
 * Chat is gated at its routes (aiByokThresholdGate). Every OTHER feature calls
 * a model through the metered gateway, so the gateway is where the allowance
 * must bite — and it must bite the way chat does: past the allowance the org's
 * own key serves the call; with no key, a recoverable 429 byok_required;
 * never a dead end, never silent overage. Background work the org did not
 * trigger is never gated and never counted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  gate: { allowed: true, mode: "platform", current: 0, threshold: 2250 as number | null, byokAvailable: true, unit: "cents" } as Record<string, unknown>,
  gateCalls: 0,
  byok: null as null | { channel: string; client: unknown; mapModel: (m: string) => string },
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("../../server/services/usageLimits", () => ({
  checkAiTurnGate: async () => { h.gateCalls++; return h.gate; },
}));
vi.mock("../../server/services/byok/aiByok", () => ({ resolveAiByokClient: async () => h.byok }));
vi.mock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: async () => {} }));
vi.mock("../../server/db", () => ({ db: { insert: () => ({ values: async (v: Record<string, unknown>) => { h.inserted.push(v); } }) } }));
vi.mock("@shared/schema", () => ({ aiTelemetryEvents: {} }));
vi.mock("../../server/services/ai-telemetry", () => ({
  recordAiCall: async () => {},
  complexityClassFromTaskType: () => "other",
  classifyError: () => "unknown",
}));
vi.mock("../../server/utils/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { meteredChatCompletion } from "../../server/services/aiSpendGuard";
import { enforceAiAllowance, AiAllowanceExhaustedError, __resetAiAllowanceCacheForTests } from "../../server/services/aiAllowance";
import { Errors } from "../../server/utils/errors";

const flush = () => new Promise((r) => setTimeout(r, 5));
const RESPONSE = { id: "gen-1", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } };
const platform = () => {
  const create = vi.fn(async (_b: any) => RESPONSE);
  return { client: { chat: { completions: { create } } }, create };
};
const exhausted = () => {
  h.gate = { allowed: false, reason: "byok_required", mode: "platform", current: 2300, threshold: 2250, byokAvailable: true, unit: "cents" };
};

beforeEach(() => {
  __resetAiAllowanceCacheForTests();
  h.gate = { allowed: true, mode: "platform", current: 100, threshold: 2250, byokAvailable: true, unit: "cents" };
  h.gateCalls = 0;
  h.byok = null;
  h.inserted.length = 0;
});

describe("enforceAiAllowance — the one decision", () => {
  it("under the allowance → the platform key (null)", async () => {
    expect(await enforceAiAllowance(7)).toBeNull();
  });
  it("past it with a key → the org's own key", async () => {
    exhausted();
    const byok = { channel: "anthropic", client: {}, mapModel: (m: string) => m };
    h.byok = byok;
    expect(await enforceAiAllowance(7)).toBe(byok);
  });
  it("past it without a key → a recoverable refusal carrying the path forward", async () => {
    exhausted();
    const err = await enforceAiAllowance(7).catch((e) => e);
    expect(err).toBeInstanceOf(AiAllowanceExhaustedError);
    expect(err).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", reason: "byok_required", byokSettingsUrl: "/settings/byok", spentCents: 2300, allowanceCents: 2250 });
  });
  it("founders are never walled", async () => {
    h.gate = { allowed: true, mode: "founder", current: 0, threshold: null, byokAvailable: true, unit: "cents" };
    expect(await enforceAiAllowance(7)).toBeNull();
  });
});

describe("the gateway applies it to every customer-triggered feature", () => {
  it("past the allowance with no key: refused BEFORE the provider is paid", async () => {
    exhausted();
    const { client, create } = platform();
    await expect(
      meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "document_intelligence", orgId: 7, origin: "customer" }),
    ).rejects.toBeInstanceOf(AiAllowanceExhaustedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("past the allowance with a key: the org's key serves it, model mapped, $0 platform cost", async () => {
    exhausted();
    const byokCreate = vi.fn(async (_b: any) => RESPONSE);
    h.byok = { channel: "anthropic", client: { chat: { completions: { create: byokCreate } } }, mapModel: () => "claude-sonnet-4-6" };
    const { client, create } = platform();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "due_diligence", orgId: 7, origin: "customer" });
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect(byokCreate).toHaveBeenCalledTimes(1);
    expect(byokCreate.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
    expect(Number(h.inserted[0].estimatedCostCents)).toBe(0);
  });

  it("under the allowance: the platform key, and the spend is recorded as the org's own (origin customer)", async () => {
    const { client, create } = platform();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "valuation", orgId: 7, origin: "customer" });
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(h.inserted[0]).toMatchObject({ organizationId: 7, origin: "customer" });
    expect(Number(h.inserted[0].estimatedCostCents)).toBeGreaterThan(0);
  });

  it("background work the org did not trigger: never gated, never counted", async () => {
    exhausted();
    const { client, create } = platform();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "voice_call_analysis", orgId: 7, origin: "background" });
    await flush();
    expect(h.gateCalls).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(h.inserted[0]).toMatchObject({ origin: "background" });
  });

  it("platform-internal AI (no org) is nobody's allowance", async () => {
    exhausted();
    const { client } = platform();
    await meteredChatCompletion(client, { model: "openai/gpt-4o", messages: [] }, { taskType: "founder_brief", orgId: null, origin: "customer" });
    await flush();
    expect(h.gateCalls).toBe(0);
    expect(h.inserted[0]).toMatchObject({ origin: null });
  });
});

describe("a refusal reaching a route is a 429 with the path forward, not a 500", () => {
  it("Errors.internal maps it to byok_required", () => {
    const sent: { status?: number; body?: any } = {};
    const res: any = {
      status(c: number) { sent.status = c; return res; },
      json(b: unknown) { sent.body = b; return res; },
      setHeader() {}, getHeader() { return undefined; }, locals: {},
    };
    Errors.internal(res, new AiAllowanceExhaustedError(7, 2300, 2250, true));
    expect(sent.status).toBe(429);
    expect(sent.body.details).toMatchObject({ reason: "byok_required", byokSettingsUrl: "/settings/byok", unit: "cents" });
  });
});
