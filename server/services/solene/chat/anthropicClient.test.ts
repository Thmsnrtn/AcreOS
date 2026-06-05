/**
 * Tests for anthropicClient — Anthropic-direct streaming.
 *
 * The Anthropic SDK is mocked so no network call leaves the test.
 * Verifies the async-generator shape matches openRouterClient's contract.
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

// Mock the Anthropic SDK at module-load time. The default export is the
// Anthropic class; messages.create() returns an async-iterable.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    public messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

import {
  classifyAnthropicError,
  streamChatCompletionAnthropic,
  toAnthropicModelName,
  type AnthropicStreamEvent,
} from "./anthropicClient";

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-12345";
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

// ============================================================================
// toAnthropicModelName
// ============================================================================

describe("toAnthropicModelName", () => {
  it("strips the anthropic/ prefix", () => {
    expect(toAnthropicModelName("anthropic/claude-opus-4-7")).toBe(
      "claude-opus-4-7",
    );
    expect(toAnthropicModelName("anthropic/claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("returns unprefixed names unchanged", () => {
    expect(toAnthropicModelName("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001",
    );
  });
});

// ============================================================================
// classifyAnthropicError
// ============================================================================

describe("classifyAnthropicError", () => {
  it("marks 5xx as retryable", () => {
    expect(classifyAnthropicError({ status: 500, message: "boom" })).toEqual({
      message: "boom",
      status: 500,
      retryable: true,
    });
    expect(classifyAnthropicError({ status: 503, message: "down" })).toEqual({
      message: "down",
      status: 503,
      retryable: true,
    });
  });

  it("marks 429 + 408 as retryable", () => {
    expect(classifyAnthropicError({ status: 429, message: "rate" })).toMatchObject({
      retryable: true,
    });
    expect(classifyAnthropicError({ status: 408, message: "to" })).toMatchObject({
      retryable: true,
    });
  });

  it("marks other 4xx as non-retryable", () => {
    expect(
      classifyAnthropicError({ status: 400, message: "bad request" }),
    ).toMatchObject({ retryable: false });
    expect(
      classifyAnthropicError({ status: 401, message: "unauthorized" }),
    ).toMatchObject({ retryable: false });
    expect(
      classifyAnthropicError({ status: 403, message: "forbidden" }),
    ).toMatchObject({ retryable: false });
  });

  it("marks AbortError as non-retryable", () => {
    const err = new Error("aborted");
    (err as any).name = "AbortError";
    expect(classifyAnthropicError(err)).toMatchObject({ retryable: false });
  });

  it("marks network-shaped errors (no status) as retryable", () => {
    expect(
      classifyAnthropicError(new Error("ECONNRESET")),
    ).toMatchObject({ retryable: true });
  });
});

// ============================================================================
// streamChatCompletionAnthropic — generator shape
// ============================================================================

async function collect(
  gen: AsyncIterable<AnthropicStreamEvent>,
): Promise<AnthropicStreamEvent[]> {
  const out: AnthropicStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const it of items) yield it;
    },
  };
}

describe("streamChatCompletionAnthropic", () => {
  it("emits an error when ANTHROPIC_API_KEY is unset (not retryable)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "error",
      retryable: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("translates a clean text stream into text_delta + message_done events", async () => {
    mockCreate.mockResolvedValueOnce(
      makeAsyncIterable([
        {
          type: "message_start",
          message: { usage: { input_tokens: 10, cache_read_input_tokens: 5 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { text: " world" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 3 },
        },
        { type: "message_stop" },
      ]),
    );

    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "anthropic/claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(evs.map((e) => e.type)).toEqual([
      "text_delta",
      "text_delta",
      "message_done",
    ]);
    expect((evs[0] as any).delta).toBe("Hello");
    expect((evs[1] as any).delta).toBe(" world");
    const done = evs[2] as Extract<AnthropicStreamEvent, { type: "message_done" }>;
    expect(done.stopReason).toBe("end_turn");
    expect(done.usage.inputTokens).toBe(10);
    expect(done.usage.cachedReadTokens).toBe(5);
    expect(done.usage.outputTokens).toBe(3);

    // The mock should have been called with the prefix-stripped model name.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const calledBody = mockCreate.mock.calls[0]?.[0];
    expect(calledBody.model).toBe("claude-opus-4-7");
    expect(calledBody.stream).toBe(true);
  });

  it("emits tool_use_start + tool_use_input_delta + tool_use_done", async () => {
    mockCreate.mockResolvedValueOnce(
      makeAsyncIterable([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "read_lead" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { partial_json: '{"leadId":1' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { partial_json: "23}" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
    );

    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "do thing" }],
      }),
    );

    const types = evs.map((e) => e.type);
    expect(types).toContain("tool_use_start");
    expect(types).toContain("tool_use_input_delta");
    expect(types).toContain("tool_use_done");
    expect(types[types.length - 1]).toBe("message_done");
  });

  it("classifies SDK throws and emits a retryable error", async () => {
    const err: any = new Error("upstream down");
    err.status = 503;
    mockCreate.mockRejectedValueOnce(err);

    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(evs).toHaveLength(1);
    const e = evs[0] as Extract<AnthropicStreamEvent, { type: "error" }>;
    expect(e.type).toBe("error");
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(503);
  });

  it("classifies 400 throws as non-retryable", async () => {
    const err: any = new Error("bad input");
    err.status = 400;
    mockCreate.mockRejectedValueOnce(err);

    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(evs[0]).toMatchObject({
      type: "error",
      retryable: false,
      status: 400,
    });
  });

  it("synthesises message_done when upstream omits message_stop", async () => {
    mockCreate.mockResolvedValueOnce(
      makeAsyncIterable([
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { text: "ok" } },
      ]),
    );
    const evs = await collect(
      streamChatCompletionAnthropic({
        model: "claude-opus-4-7",
        messages: [],
      }),
    );
    expect(evs[evs.length - 1].type).toBe("message_done");
  });
});
