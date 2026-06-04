/**
 * SOLENE CHAT — OpenRouter streaming client (Phase 2 of AcreOS-Solene migration).
 *
 * Talks to OpenRouter's Anthropic-compatible /api/v1/messages endpoint so the
 * content-block shape matches what conversationStore persists 1:1 — text,
 * tool_use, tool_result blocks flow through end-to-end with no translation.
 *
 * Stream parsing: SSE-decoded manually with no deps. The yielded StreamEvent
 * union is the upstream Anthropic event vocabulary, narrowed to what the
 * turnRunner needs (text/tool/thinking deltas + done + error).
 *
 * Credential discipline: OPENROUTER_API_KEY is read inside the call (not at
 * module-load) and NEVER appears in any log line — only its byte length, prefix
 * (first 8 chars), and SHA-256 hash prefix get surfaced for verification.
 *
 * Abort: every call honors `opts.signal` so the SSE handler can abort upstream
 * on client disconnect mid-stream.
 */

import { createHash } from "node:crypto";
import { logger } from "../../../utils/logger";

// ============================================================================
// Public types
// ============================================================================

// Re-export the canonical Anthropic-shape ContentBlock from the shared schema
// so persistence (conversationStore) + the wire shape match without translation.
import type { ContentBlock as SchemaContentBlock } from "@shared/schema/solene-conversations";
export type ContentBlock = SchemaContentBlock;

/**
 * Narrowed view of a text block — used at the openRouter wire layer where
 * cache_control may be attached for system-prompt caching.
 */
export interface TextContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** Convenience alias for callers that build a tool_use block. */
export type ToolUseContentBlock = Extract<SchemaContentBlock, { type: "tool_use" }>;

/** Convenience alias for callers that build a tool_result block. */
export type ToolResultContentBlock = Extract<
  SchemaContentBlock,
  { type: "tool_result" }
>;

export interface OpenRouterMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: ContentBlock[] | string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface OpenRouterRequestOpts {
  model: string;
  messages: OpenRouterMessage[];
  system?: string | SystemPromptBlock[];
  tools?: ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheCreationTokens: number;
}

export type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input_delta"; id: string; partialJson: string }
  | { type: "tool_use_done"; id: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_done"; stopReason: string | null; usage: StreamUsage }
  | { type: "error"; message: string };

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL =
  process.env.SOLENE_CHAT_OPENROUTER_BASE_URL ?? "https://openrouter.ai";

const DEFAULT_REFERER =
  process.env.SOLENE_CHAT_OPENROUTER_REFERER ?? "https://acreos.io";

const DEFAULT_TITLE = "AcreOS Solene";

const ANTHROPIC_VERSION = "2023-06-01";

// ============================================================================
// Credential discipline helpers
// ============================================================================

function describeApiKey(apiKey: string): string {
  const hash = createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
  return `length=${apiKey.length} prefix=${apiKey.slice(0, 8)} hash8=${hash}`;
}

// ============================================================================
// buildCachedSystemPrompt — pure helper for prompt caching layout.
// ============================================================================

/**
 * Build a system-prompt block array WITH prompt caching enabled on the static
 * prefix. The static prefix (constitution + charter + briefs) gets
 * cache_control:'ephemeral' so subsequent turns within the 5-min TTL reuse the
 * cached prefix at ~10% input cost.
 *
 * The dynamic suffix (per-query retrieved memories) does NOT get cached because
 * it varies per turn — caching it would just thrash the cache.
 */
export function buildCachedSystemPrompt(parts: {
  staticPrefix: string;
  dynamicSuffix: string;
}): SystemPromptBlock[] {
  const blocks: SystemPromptBlock[] = [];
  const staticPrefix = parts.staticPrefix?.trim() ?? "";
  const dynamicSuffix = parts.dynamicSuffix?.trim() ?? "";
  if (staticPrefix.length > 0) {
    blocks.push({
      type: "text",
      text: staticPrefix,
      cache_control: { type: "ephemeral" },
    });
  }
  if (dynamicSuffix.length > 0) {
    blocks.push({ type: "text", text: dynamicSuffix });
  }
  return blocks;
}

// ============================================================================
// streamChatCompletion — SSE generator.
// ============================================================================

/**
 * Stream a completion from OpenRouter. Yields the normalized StreamEvent
 * union; never throws (errors become 'error' events the caller can handle).
 *
 * NOTE: this function reads OPENROUTER_API_KEY at call-time so deploy-time
 * env rotation works without a server restart.
 */
export async function* streamChatCompletion(
  opts: OpenRouterRequestOpts,
): AsyncIterable<StreamEvent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    yield {
      type: "error",
      message:
        "OPENROUTER_API_KEY not set. The chat backend cannot reach OpenRouter.",
    };
    return;
  }

  // Build the upstream request body in Anthropic's Messages-API shape.
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 4096,
    stream: true,
  };
  if (opts.system !== undefined) body.system = opts.system;
  if (opts.tools !== undefined && opts.tools.length > 0) {
    body.tools = opts.tools;
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  logger.info("[soleneChat] openrouter.request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools?.length ?? 0,
    systemKind: Array.isArray(opts.system)
      ? `blocks=${opts.system.length}`
      : typeof opts.system,
    apiKey: describeApiKey(apiKey),
  });

  let resp: Response;
  try {
    resp = await fetch(`${DEFAULT_BASE_URL}/api/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": DEFAULT_REFERER,
        "X-Title": DEFAULT_TITLE,
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    yield {
      type: "error",
      message: `OpenRouter fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
    return;
  }

  if (!resp.ok) {
    let errText = "";
    try {
      errText = await resp.text();
    } catch {
      /* swallow */
    }
    yield {
      type: "error",
      message: `OpenRouter ${resp.status}: ${errText.slice(0, 500)}`,
    };
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    yield { type: "error", message: "OpenRouter response had no body stream" };
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // Block-index → live block kind (for routing deltas to the right event).
  const blockKinds = new Map<number, "text" | "tool_use" | "thinking">();
  const blockToolIds = new Map<number, string>();

  let aggregateUsage: StreamUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let stopReason: string | null = null;
  let messageDoneYielded = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Parse complete events,
      // leave the trailing partial in the buffer.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const event = parseSseEvent(raw);
        if (!event || event.data === "[DONE]") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          continue;
        }

        const eType = parsed.type;
        // Anthropic-shape event handling.
        if (eType === "message_start") {
          const usage = parsed.message?.usage;
          if (usage) {
            aggregateUsage.inputTokens += Number(usage.input_tokens ?? 0);
            aggregateUsage.cachedReadTokens += Number(
              usage.cache_read_input_tokens ?? 0,
            );
            aggregateUsage.cacheCreationTokens += Number(
              usage.cache_creation_input_tokens ?? 0,
            );
          }
        } else if (eType === "content_block_start") {
          const idx = Number(parsed.index ?? 0);
          const block = parsed.content_block;
          if (block?.type === "text") {
            blockKinds.set(idx, "text");
          } else if (block?.type === "tool_use") {
            blockKinds.set(idx, "tool_use");
            blockToolIds.set(idx, block.id);
            yield {
              type: "tool_use_start",
              id: block.id,
              name: block.name,
            };
          } else if (block?.type === "thinking") {
            blockKinds.set(idx, "thinking");
          }
        } else if (eType === "content_block_delta") {
          const idx = Number(parsed.index ?? 0);
          const delta = parsed.delta ?? {};
          const kind = blockKinds.get(idx);
          if (kind === "text" && typeof delta.text === "string") {
            yield { type: "text_delta", delta: delta.text };
          } else if (kind === "tool_use" && typeof delta.partial_json === "string") {
            const id = blockToolIds.get(idx) ?? "";
            yield {
              type: "tool_use_input_delta",
              id,
              partialJson: delta.partial_json,
            };
          } else if (kind === "thinking" && typeof delta.thinking === "string") {
            yield { type: "thinking_delta", delta: delta.thinking };
          }
        } else if (eType === "content_block_stop") {
          const idx = Number(parsed.index ?? 0);
          if (blockKinds.get(idx) === "tool_use") {
            const id = blockToolIds.get(idx) ?? "";
            yield { type: "tool_use_done", id };
          }
        } else if (eType === "message_delta") {
          if (parsed.delta?.stop_reason) {
            stopReason = String(parsed.delta.stop_reason);
          }
          const usage = parsed.usage;
          if (usage) {
            aggregateUsage.outputTokens += Number(usage.output_tokens ?? 0);
          }
        } else if (eType === "message_stop") {
          yield {
            type: "message_done",
            stopReason,
            usage: aggregateUsage,
          };
          messageDoneYielded = true;
        } else if (eType === "error") {
          yield {
            type: "error",
            message: String(parsed.error?.message ?? "openrouter stream error"),
          };
        }
      }
    }

    // Some upstreams omit message_stop on a clean end; emit a synthesized
    // message_done so the caller always sees a terminator.
    if (!messageDoneYielded) {
      yield {
        type: "message_done",
        stopReason: stopReason ?? "end_turn",
        usage: aggregateUsage,
      };
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      yield { type: "error", message: "stream aborted" };
    } else {
      yield {
        type: "error",
        message: `stream read failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* swallow */
    }
  }
}

// ============================================================================
// SSE parser (single-event).
// ============================================================================

/**
 * Parse a single SSE event chunk (the text between two blank lines).
 * Returns { event, data } where data is the concatenation of all `data:` lines.
 * Exported for tests.
 */
export function parseSseEvent(chunk: string): { event: string | null; data: string } | null {
  if (!chunk || !chunk.trim()) return null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0 && event === null) return null;
  return { event, data: dataLines.join("\n") };
}
