/**
 * SOLENE CHAT — Anthropic-direct streaming client (Batch 9 of AcreOS-Solene
 * cost-efficiency program).
 *
 * Mirrors the public surface of openRouterClient.streamChatCompletion but
 * calls Anthropic's Messages API directly through the official SDK, bypassing
 * the ~5% margin OpenRouter charges on Anthropic pass-through. cache_control
 * + system-prompt block arrays + tool_use blocks pass through 1:1 because
 * OpenRouter is already a transparent passthrough — the upstream content
 * shape is identical.
 *
 * Failover policy:
 *   The streamed event union includes a `retryable` flag on `error` events
 *   so providerSelector can fall through to OpenRouter on transient 5xx /
 *   network failures BEFORE any tokens have been streamed.
 *
 * Credential discipline:
 *   ANTHROPIC_API_KEY is read at call-time (not module-load). Logged only
 *   via describeApiKey (length + prefix8 + hash8) — the raw value never
 *   appears in any log line.
 */

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../../utils/logger";
import type {
  OpenRouterRequestOpts,
  StreamEvent,
  StreamUsage,
} from "./openRouterClient";

// Re-export the shared types so callers can import from either client.
export type { OpenRouterRequestOpts, StreamEvent, StreamUsage } from "./openRouterClient";

/**
 * Extended StreamEvent variant carrying a `retryable` flag on errors.
 * The base StreamEvent union from openRouterClient does not include this
 * because OpenRouter errors at the SSE layer are surfaced after the response
 * body opens — but Anthropic SDK throws on connect-time failures which
 * providerSelector wants to classify.
 */
export type AnthropicStreamEvent =
  | Exclude<StreamEvent, { type: "error" }>
  | { type: "error"; message: string; status?: number; retryable?: boolean };

// ============================================================================
// Model name translation
// ============================================================================

/**
 * OpenRouter expects an "anthropic/<model>" prefix; Anthropic-direct wants
 * just "<model>". This strips the prefix if present so callers can pass the
 * same modelRouter output to either client.
 */
export function toAnthropicModelName(routerModel: string): string {
  if (routerModel.startsWith("anthropic/")) {
    return routerModel.slice("anthropic/".length);
  }
  return routerModel;
}

// ============================================================================
// Credential discipline
// ============================================================================

function describeApiKey(apiKey: string): string {
  const hash = createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
  return `length=${apiKey.length} prefix=${apiKey.slice(0, 8)} hash8=${hash}`;
}

// ============================================================================
// Error classification
// ============================================================================

/**
 * Decide whether an SDK error should trigger failover to OpenRouter.
 * Retryable: network failures, 5xx, 408, 429. Not retryable: 4xx other
 * than 408/429 (bad input — failover wouldn't help; the other provider
 * would refuse identically).
 */
export function classifyAnthropicError(err: unknown): {
  message: string;
  status?: number;
  retryable: boolean;
} {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string; name?: string };
    const status = typeof e.status === "number" ? e.status : undefined;
    const message =
      typeof e.message === "string" ? e.message : String(err);
    if (status !== undefined) {
      // Transient: 5xx, 408 (request timeout), 429 (rate-limit).
      const retryable = status >= 500 || status === 408 || status === 429;
      return { message, status, retryable };
    }
    // No status — network or SDK-internal error. Treat AbortError as
    // non-retryable (user-initiated abort should propagate); anything else
    // as retryable since the most likely cause is transient connectivity.
    if (e.name === "AbortError") {
      return { message, retryable: false };
    }
    return { message, retryable: true };
  }
  return { message: String(err), retryable: true };
}

// ============================================================================
// streamChatCompletionAnthropic
// ============================================================================

/**
 * Stream a completion from Anthropic-direct. Yields the normalized
 * AnthropicStreamEvent union; never throws (errors become `error` events the
 * caller can handle — providerSelector inspects `retryable`).
 *
 * Reads ANTHROPIC_API_KEY at call-time so deploy-time env rotation works
 * without a server restart.
 */
export async function* streamChatCompletionAnthropic(
  opts: OpenRouterRequestOpts,
): AsyncIterable<AnthropicStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    yield {
      type: "error",
      message:
        "ANTHROPIC_API_KEY not set. Anthropic-direct chat backend cannot start.",
      retryable: false,
    };
    return;
  }

  const model = toAnthropicModelName(opts.model);
  logger.info("[soleneChat] anthropic.request", {
    model,
    messageCount: opts.messages.length,
    toolCount: opts.tools?.length ?? 0,
    systemKind: Array.isArray(opts.system)
      ? `blocks=${opts.system.length}`
      : typeof opts.system,
    apiKey: describeApiKey(apiKey),
  });

  const client = new Anthropic({ apiKey });

  // Build the request body. The SDK accepts the same content-block shape
  // upstream uses, so opts.messages / opts.system / opts.tools pass through
  // unchanged. cache_control on text blocks is honored natively.
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 4096,
    stream: true,
  };
  if (opts.system !== undefined) body.system = opts.system;
  if (opts.tools !== undefined && opts.tools.length > 0) body.tools = opts.tools;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  let stream: AsyncIterable<unknown>;
  try {
    stream = (await client.messages.create(body as any, {
      signal: opts.signal,
    })) as unknown as AsyncIterable<unknown>;
  } catch (err) {
    const classified = classifyAnthropicError(err);
    yield {
      type: "error",
      message: `Anthropic SDK error: ${classified.message}`,
      ...(classified.status !== undefined ? { status: classified.status } : {}),
      retryable: classified.retryable,
    };
    return;
  }

  // Block-index → live block kind (mirrors openRouterClient routing logic).
  const blockKinds = new Map<number, "text" | "tool_use" | "thinking">();
  const blockToolIds = new Map<number, string>();

  const aggregateUsage: StreamUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let stopReason: string | null = null;
  let messageDoneYielded = false;

  try {
    for await (const raw of stream) {
      const parsed = raw as any;
      const eType = parsed?.type;
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
          yield { type: "tool_use_start", id: block.id, name: block.name };
        } else if (block?.type === "thinking") {
          blockKinds.set(idx, "thinking");
        }
      } else if (eType === "content_block_delta") {
        const idx = Number(parsed.index ?? 0);
        const delta = parsed.delta ?? {};
        const kind = blockKinds.get(idx);
        if (kind === "text" && typeof delta.text === "string") {
          yield { type: "text_delta", delta: delta.text };
        } else if (
          kind === "tool_use" &&
          typeof delta.partial_json === "string"
        ) {
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
        // Mid-stream errors from the SDK — treat as non-retryable because
        // tokens may already have been emitted; providerSelector decides.
        yield {
          type: "error",
          message: String(parsed.error?.message ?? "anthropic stream error"),
          retryable: false,
        };
      }
    }

    if (!messageDoneYielded) {
      yield {
        type: "message_done",
        stopReason: stopReason ?? "end_turn",
        usage: aggregateUsage,
      };
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      yield {
        type: "error",
        message: "stream aborted",
        retryable: false,
      };
      return;
    }
    const classified = classifyAnthropicError(err);
    yield {
      type: "error",
      message: `Anthropic stream read failed: ${classified.message}`,
      ...(classified.status !== undefined ? { status: classified.status } : {}),
      retryable: classified.retryable,
    };
  }
}
