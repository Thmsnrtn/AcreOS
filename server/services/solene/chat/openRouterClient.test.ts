/**
 * Tests for openRouterClient — SSE parsing + buildCachedSystemPrompt +
 * credential-discipline (key length only).
 *
 * fetch is stubbed via a global mock so no network call leaves the test.
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

import {
  buildCachedSystemPrompt,
  parseSseEvent,
  streamChatCompletion,
} from "./openRouterClient";

// ============================================================================
// parseSseEvent
// ============================================================================

describe("parseSseEvent", () => {
  it("extracts event + data from a single chunk", () => {
    const r = parseSseEvent("event: foo\ndata: {\"x\":1}");
    expect(r).toEqual({ event: "foo", data: '{"x":1}' });
  });

  it("returns null for empty input", () => {
    expect(parseSseEvent("")).toBeNull();
    expect(parseSseEvent("   ")).toBeNull();
  });

  it("concatenates multi-line data fields", () => {
    const r = parseSseEvent("event: x\ndata: line1\ndata: line2");
    expect(r?.data).toBe("line1\nline2");
  });

  it("handles missing event (just data)", () => {
    const r = parseSseEvent("data: {\"y\":2}");
    expect(r).toEqual({ event: null, data: '{"y":2}' });
  });
});

// ============================================================================
// buildCachedSystemPrompt
// ============================================================================

describe("buildCachedSystemPrompt", () => {
  it("returns a static block with cache_control + a dynamic block without", () => {
    const out = buildCachedSystemPrompt({
      staticPrefix: "constitution + charter",
      dynamicSuffix: "retrieved memories",
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: "text",
      text: "constitution + charter",
      cache_control: { type: "ephemeral" },
    });
    expect(out[1]).toEqual({
      type: "text",
      text: "retrieved memories",
    });
  });

  it("omits empty halves", () => {
    const onlyStatic = buildCachedSystemPrompt({
      staticPrefix: "x",
      dynamicSuffix: "",
    });
    expect(onlyStatic).toHaveLength(1);
    expect(onlyStatic[0].cache_control).toEqual({ type: "ephemeral" });

    const onlyDynamic = buildCachedSystemPrompt({
      staticPrefix: "",
      dynamicSuffix: "y",
    });
    expect(onlyDynamic).toHaveLength(1);
    expect(onlyDynamic[0].cache_control).toBeUndefined();

    const empty = buildCachedSystemPrompt({ staticPrefix: "", dynamicSuffix: "" });
    expect(empty).toHaveLength(0);
  });
});

// ============================================================================
// streamChatCompletion — fetch stubbed.
// ============================================================================

interface StubChunk {
  bytes: Uint8Array;
}

function encoderChunks(...lines: string[]): StubChunk[] {
  const enc = new TextEncoder();
  return lines.map((l) => ({ bytes: enc.encode(l) }));
}

function stubResponseBody(chunks: StubChunk[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i].bytes);
      i++;
    },
  });
}

describe("streamChatCompletion", () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key-1234567890abcdef";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_KEY === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = ORIGINAL_KEY;
    }
  });

  it("yields error when no API key is present", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const events: any[] = [];
    for await (const e of streamChatCompletion({
      model: "anthropic/claude-haiku-4-5-20251001",
      messages: [],
    })) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].message).toMatch(/OPENROUTER_API_KEY/);
  });

  it("yields text_delta + message_done from an SSE stream", async () => {
    const chunks = encoderChunks(
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":42,"cache_read_input_tokens":10}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"text":" world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    const fetchMock = vi.fn(async () =>
      new Response(stubResponseBody(chunks), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    (globalThis as any).fetch = fetchMock;

    const events: any[] = [];
    for await (const e of streamChatCompletion({
      model: "anthropic/claude-haiku-4-5-20251001",
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    })) {
      events.push(e);
    }

    // Verify fetch was called with the right headers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-key-1234567890abcdef",
      "HTTP-Referer": expect.any(String),
      "X-Title": expect.any(String),
      "anthropic-version": "2023-06-01",
    });

    // Verify event sequence.
    const types = events.map((e) => e.type);
    expect(types).toContain("text_delta");
    expect(types).toContain("message_done");
    const text = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Hello world");
    const done = events.find((e) => e.type === "message_done");
    expect(done.stopReason).toBe("end_turn");
    expect(done.usage.inputTokens).toBe(42);
    expect(done.usage.outputTokens).toBe(7);
    expect(done.usage.cachedReadTokens).toBe(10);
  });

  it("yields tool_use_start + tool_use_input_delta + tool_use_done", async () => {
    const chunks = encoderChunks(
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"file_read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"partial_json":"{\\"path\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"partial_json":"\\"a.ts\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    (globalThis as any).fetch = vi.fn(async () =>
      new Response(stubResponseBody(chunks), { status: 200 }),
    );

    const events: any[] = [];
    for await (const e of streamChatCompletion({
      model: "anthropic/claude-haiku-4-5-20251001",
      messages: [],
    })) {
      events.push(e);
    }
    const starts = events.filter((e) => e.type === "tool_use_start");
    const deltas = events.filter((e) => e.type === "tool_use_input_delta");
    const dones = events.filter((e) => e.type === "tool_use_done");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ id: "toolu_abc", name: "file_read" });
    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.partialJson).join("")).toBe('{"path":"a.ts"}');
    expect(dones).toHaveLength(1);
  });

  it("yields error event on non-2xx response", async () => {
    (globalThis as any).fetch = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    );
    const events: any[] = [];
    for await (const e of streamChatCompletion({
      model: "x",
      messages: [],
    })) {
      events.push(e);
    }
    expect(events[0].type).toBe("error");
    expect(events[0].message).toMatch(/429/);
  });
});
