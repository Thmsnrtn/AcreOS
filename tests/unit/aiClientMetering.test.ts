import { describe, it, expect, vi } from "vitest";
import {
  extractAiUsage,
  meterChatCompletions,
  type AiUsageSample,
} from "../../server/utils/aiClientMetering";

/**
 * AI-spend metering shim (Phase 0 audit — FP&A / Staff ML). The raw platform AI
 * client is wrapped so bypass callsites' token spend becomes visible in
 * telemetry. This verifies the wrap meters non-streaming calls, passes through
 * streaming, stays transparent to the caller, and never lets a metering error
 * escape.
 */

function fakeCompletion(over: Record<string, unknown> = {}) {
  return {
    id: "gen-123",
    model: "anthropic/claude-haiku-4-5-20251001",
    usage: { prompt_tokens: 100, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 10 } },
    choices: [{ message: { role: "assistant", content: "ok" } }],
    ...over,
  };
}

// Minimal client shape with a stub chat.completions.create.
function fakeClient(createImpl: (body: any, options?: any) => any) {
  return { chat: { completions: { create: createImpl } } } as any;
}

describe("extractAiUsage", () => {
  it("pulls model, tokens (incl. cached), and response id", () => {
    expect(extractAiUsage(fakeCompletion())).toEqual<AiUsageSample>({
      model: "anthropic/claude-haiku-4-5-20251001",
      promptTokens: 100,
      completionTokens: 40,
      cachedInputTokens: 10,
      responseId: "gen-123",
    });
  });

  it("returns null when usage or model is missing", () => {
    expect(extractAiUsage({ model: "x" })).toBeNull();
    expect(extractAiUsage({ usage: {} })).toBeNull();
    expect(extractAiUsage(null)).toBeNull();
  });
});

describe("meterChatCompletions", () => {
  it("records usage for a non-streaming call and returns the real response", async () => {
    const rec = vi.fn();
    const client = fakeClient(async () => fakeCompletion());
    meterChatCompletions(client, rec);

    const res = await client.chat.completions.create({ model: "m", messages: [] });
    expect(res.id).toBe("gen-123"); // caller gets the untouched response
    await new Promise((r) => setTimeout(r, 0)); // let the detached metering chain run
    expect(rec).toHaveBeenCalledTimes(1);
    expect(rec.mock.calls[0][0]).toMatchObject({ model: "anthropic/claude-haiku-4-5-20251001", promptTokens: 100, completionTokens: 40 });
  });

  it("does NOT meter streaming calls", async () => {
    const rec = vi.fn();
    const client = fakeClient(() => ({ async *[Symbol.asyncIterator]() {} })); // fake stream
    meterChatCompletions(client, rec);

    client.chat.completions.create({ model: "m", messages: [], stream: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(rec).not.toHaveBeenCalled();
  });

  it("never lets a recorder error surface to the caller", async () => {
    const client = fakeClient(async () => fakeCompletion());
    meterChatCompletions(client, () => {
      throw new Error("telemetry is down");
    });
    // Must resolve normally despite the recorder throwing.
    const res = await client.chat.completions.create({ model: "m", messages: [] });
    expect(res.id).toBe("gen-123");
    await new Promise((r) => setTimeout(r, 0));
  });

  it("is idempotent — wrapping twice does not double-record", async () => {
    const rec = vi.fn();
    const client = fakeClient(async () => fakeCompletion());
    meterChatCompletions(client, rec);
    meterChatCompletions(client, rec); // second wrap is a no-op
    await client.chat.completions.create({ model: "m", messages: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(rec).toHaveBeenCalledTimes(1);
  });
});
