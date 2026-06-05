/**
 * Tests for providerSelector — primary + failover ordering, token-stream
 * recovery boundary, env-knob ordering.
 *
 * Both client modules are mocked to return crafted async iterables.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const anthropicGen = vi.fn();
const openRouterGen = vi.fn();

vi.mock("./anthropicClient", () => ({
  streamChatCompletionAnthropic: (...args: unknown[]) => anthropicGen(...args),
}));
vi.mock("./openRouterClient", () => ({
  streamChatCompletion: (...args: unknown[]) => openRouterGen(...args),
}));

import {
  resolveProviderOrder,
  streamChatWithFailover,
  type ProviderStreamEvent,
} from "./providerSelector";

beforeEach(() => {
  anthropicGen.mockReset();
  openRouterGen.mockReset();
  delete process.env.SOLENE_CHAT_PROVIDER_PRIMARY;
});

afterEach(() => {
  delete process.env.SOLENE_CHAT_PROVIDER_PRIMARY;
});

function makeIter<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const it of items) yield it;
    },
  };
}

async function collect(
  gen: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// ============================================================================
// resolveProviderOrder
// ============================================================================

describe("resolveProviderOrder", () => {
  it("defaults to anthropic_direct primary", () => {
    expect(resolveProviderOrder({})).toEqual({
      primary: "anthropic_direct",
      secondary: "openrouter",
    });
  });

  it("honors SOLENE_CHAT_PROVIDER_PRIMARY=openrouter", () => {
    expect(
      resolveProviderOrder({ SOLENE_CHAT_PROVIDER_PRIMARY: "openrouter" } as any),
    ).toEqual({
      primary: "openrouter",
      secondary: "anthropic_direct",
    });
  });

  it("falls back to anthropic on unknown values", () => {
    expect(
      resolveProviderOrder({ SOLENE_CHAT_PROVIDER_PRIMARY: "gemini" } as any),
    ).toMatchObject({ primary: "anthropic_direct" });
  });
});

// ============================================================================
// streamChatWithFailover — happy path
// ============================================================================

describe("streamChatWithFailover", () => {
  it("uses anthropic_direct primary on happy path", async () => {
    anthropicGen.mockReturnValueOnce(
      makeIter([
        { type: "text_delta", delta: "hi" },
        {
          type: "message_done",
          stopReason: "end_turn",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedReadTokens: 0,
            cacheCreationTokens: 0,
          },
        },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "anthropic/claude-opus-4-7",
        messages: [],
      }),
    );

    expect(anthropicGen).toHaveBeenCalledTimes(1);
    expect(openRouterGen).not.toHaveBeenCalled();
    expect(evs.map((e) => e.type)).toEqual(["text_delta", "message_done"]);
    expect(evs.every((e) => e._provider === "anthropic_direct")).toBe(true);
  });

  it("fails over to openrouter when anthropic emits a retryable error pre-token", async () => {
    anthropicGen.mockReturnValueOnce(
      makeIter([
        { type: "error", message: "503", status: 503, retryable: true },
      ]),
    );
    openRouterGen.mockReturnValueOnce(
      makeIter([
        { type: "text_delta", delta: "recovered" },
        {
          type: "message_done",
          stopReason: "end_turn",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedReadTokens: 0,
            cacheCreationTokens: 0,
          },
        },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "anthropic/claude-opus-4-7",
        messages: [],
      }),
    );

    expect(anthropicGen).toHaveBeenCalledTimes(1);
    expect(openRouterGen).toHaveBeenCalledTimes(1);

    // The error should NOT have surfaced to the caller (it triggered failover).
    expect(evs.find((e) => e.type === "error")).toBeUndefined();
    // Recovered output is tagged with the failover provider tag.
    expect(evs.find((e) => e.type === "text_delta")?._provider).toBe(
      "openrouter_failover",
    );
  });

  it("does NOT fail over if a non-retryable error fires (e.g. 401 auth)", async () => {
    anthropicGen.mockReturnValueOnce(
      makeIter([
        { type: "error", message: "401", status: 401, retryable: false },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );

    expect(openRouterGen).not.toHaveBeenCalled();
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe("error");
    expect(evs[0]._provider).toBe("anthropic_direct");
  });

  it("does NOT fail over if an error fires AFTER tokens have streamed", async () => {
    anthropicGen.mockReturnValueOnce(
      makeIter([
        { type: "text_delta", delta: "partial" },
        { type: "error", message: "mid-stream", retryable: true },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );

    expect(openRouterGen).not.toHaveBeenCalled();
    expect(evs.map((e) => e.type)).toEqual(["text_delta", "error"]);
    expect(evs[1]._provider).toBe("anthropic_direct");
  });

  it("emits a combined error when both providers fail pre-token", async () => {
    anthropicGen.mockReturnValueOnce(
      makeIter([
        { type: "error", message: "anthropic 503", status: 503, retryable: true },
      ]),
    );
    openRouterGen.mockReturnValueOnce(
      makeIter([
        { type: "error", message: "openrouter 503", retryable: true },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );

    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe("error");
    expect((evs[0] as any).message).toContain("both providers failed");
  });

  it("respects SOLENE_CHAT_PROVIDER_PRIMARY=openrouter", async () => {
    process.env.SOLENE_CHAT_PROVIDER_PRIMARY = "openrouter";
    openRouterGen.mockReturnValueOnce(
      makeIter([
        { type: "text_delta", delta: "via-or" },
        {
          type: "message_done",
          stopReason: "end_turn",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedReadTokens: 0,
            cacheCreationTokens: 0,
          },
        },
      ]),
    );

    const evs = await collect(
      streamChatWithFailover({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(openRouterGen).toHaveBeenCalledTimes(1);
    expect(anthropicGen).not.toHaveBeenCalled();
    expect(evs.find((e) => e.type === "text_delta")?._provider).toBe("openrouter");
  });

  it("fails over when the primary generator throws synchronously pre-token", async () => {
    anthropicGen.mockReturnValueOnce(
      (async function* () {
        throw new Error("network exploded");
        // eslint-disable-next-line no-unreachable
        yield 0 as any;
      })(),
    );
    openRouterGen.mockReturnValueOnce(
      makeIter([
        { type: "text_delta", delta: "ok" },
        {
          type: "message_done",
          stopReason: "end_turn",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedReadTokens: 0,
            cacheCreationTokens: 0,
          },
        },
      ]),
    );
    const evs = await collect(
      streamChatWithFailover({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(openRouterGen).toHaveBeenCalledTimes(1);
    expect(evs.find((e) => e.type === "text_delta")?._provider).toBe(
      "openrouter_failover",
    );
  });
});
