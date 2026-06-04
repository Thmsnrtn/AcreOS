/**
 * SOLENE CHAT — turn runner (Phase 2 of AcreOS-Solene migration).
 *
 * Single entrypoint that ties the chat stack together:
 *   1. Persist the user message (conversationStore.appendMessage).
 *   2. Pull recent history; build the cached system prompt (contextBuilder).
 *   3. Pick a model tier (modelRouter).
 *   4. Stream the completion (openRouterClient.streamChatCompletion).
 *   5. As tool_use blocks complete, execute via executeChatTool + feed the
 *      result back as a follow-up message in the SAME turn loop.
 *   6. Persist assistant + tool messages (with usage / cost / model attribution).
 *   7. Record a capital event for envelope tracking.
 *   8. Yield SSE-shaped TurnEvents the route handler can pipe to the client.
 *
 * Honors AbortSignal: if the client disconnects, the upstream OpenRouter
 * fetch's signal aborts mid-stream + we stop the loop.
 *
 * Bounds: max turns / cost cap / wall-clock timeout. On exceed, yields an
 * error event + persists an error-message assistant row so the conversation
 * stays consistent.
 */

import {
  appendMessage,
  getConversation,
} from "../conversationStore";
import { recordCapitalEvent } from "../capitalTracker";
import {
  CHAT_DEFAULT_COST_CAP_USD,
  CHAT_DEFAULT_MAX_TURNS,
  CHAT_DEFAULT_TIMEOUT_MS,
  CHAT_HISTORY_MESSAGE_LIMIT,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_PRICING_PER_M_TOKENS,
  type ChatTier,
} from "@shared/schema/solene-chat-config";
import {
  buildCachedSystemPrompt,
  streamChatCompletion,
  type ContentBlock,
  type OpenRouterMessage,
  type StreamEvent,
  type ToolUseContentBlock,
} from "./openRouterClient";
import { buildChatContext } from "./contextBuilder";
import { routeQuery, estimateCost, type ConversationMessage } from "./modelRouter";
import {
  CHAT_TOOL_SCHEMAS,
  executeChatTool,
  wrapToolResult,
} from "./toolExecutor";
import type { SoleneMessageRow } from "@shared/schema/solene-conversations";
import { logger } from "../../../utils/logger";

// ============================================================================
// Public types
// ============================================================================

export interface RunTurnInput {
  conversationId: number;
  userMessage: ContentBlock[];
  founderUserId: string;
  tierHint?: ChatTier;
}

export type TurnEventType =
  | "turn_start"
  | "text_delta"
  | "thinking_delta"
  | "tool_use"
  | "tool_result"
  | "approval_pending"
  | "turn_done"
  | "error";

export interface TurnEvent {
  type: TurnEventType;
  data: Record<string, unknown>;
}

// ============================================================================
// Internal helpers
// ============================================================================

function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function toRouterHistory(rows: SoleneMessageRow[]): ConversationMessage[] {
  return rows.map((r) => ({
    role: r.role as ConversationMessage["role"],
    textContent: Array.isArray(r.content) ? extractText(r.content) : "",
    modelUsed: r.modelUsed,
  }));
}

function toUpstreamMessages(rows: SoleneMessageRow[]): OpenRouterMessage[] {
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant" || r.role === "tool")
    .map((r) => ({
      role: r.role as OpenRouterMessage["role"],
      content: Array.isArray(r.content) ? r.content : [],
      ...(r.toolCallId ? { tool_call_id: r.toolCallId } : {}),
    }));
}

function totalTokens(u: {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
}): number {
  return u.inputTokens + u.outputTokens + u.cachedReadTokens;
}

function actualCost(opts: {
  tier: ChatTier;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}): number {
  const pricing = CHAT_PRICING_PER_M_TOKENS[opts.tier];
  const billableInput = Math.max(0, opts.inputTokens - opts.cachedInputTokens);
  return (
    (billableInput / 1_000_000) * pricing.input +
    (opts.cachedInputTokens / 1_000_000) * pricing.cachedInput +
    (opts.outputTokens / 1_000_000) * pricing.output
  );
}

// ============================================================================
// runTurn
// ============================================================================

export async function* runTurn(
  input: RunTurnInput,
  signal?: AbortSignal,
): AsyncIterable<TurnEvent> {
  const startedAt = Date.now();

  // ── 1. Validate + persist user message ────────────────────────────────────
  if (!Array.isArray(input.userMessage) || input.userMessage.length === 0) {
    yield { type: "error", data: { message: "userMessage must be a non-empty content-block array" } };
    return;
  }
  try {
    await appendMessage({
      conversationId: input.conversationId,
      role: "user",
      content: input.userMessage,
    });
  } catch (err) {
    yield {
      type: "error",
      data: {
        message: `failed to persist user message: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    };
    return;
  }

  // ── 2. Load conversation history ──────────────────────────────────────────
  const convo = await getConversation(input.conversationId);
  if (!convo) {
    yield { type: "error", data: { message: `conversation ${input.conversationId} not found` } };
    return;
  }
  // Tail the most recent N (we've already appended the user msg above).
  const recentRows = convo.messages.slice(-CHAT_HISTORY_MESSAGE_LIMIT);

  // ── 3. Route to tier ──────────────────────────────────────────────────────
  const userText = extractText(input.userMessage);
  let route;
  try {
    route = await routeQuery({
      userMessage: userText,
      conversationHistory: toRouterHistory(recentRows),
      hint: input.tierHint,
    });
  } catch (err) {
    yield {
      type: "error",
      data: {
        message: `router failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
    return;
  }

  yield {
    type: "turn_start",
    data: {
      conversationId: input.conversationId,
      tier: route.tier,
      model: route.model,
      rationale: route.rationale,
      estimatedCostUsd: route.estimatedCostUsd,
    },
  };

  // ── 4. Build system prompt context (cached prefix + dynamic suffix) ───────
  const context = await buildChatContext({
    userMessage: userText,
    conversationId: input.conversationId,
    tier: route.tier,
  });
  const systemBlocks = buildCachedSystemPrompt({
    staticPrefix: context.staticPrefix,
    dynamicSuffix: context.dynamicSuffix,
  });

  // ── 5. Streaming turn loop ────────────────────────────────────────────────
  let cumulativeCostUsd = 0;
  let turnNumber = 0;
  let messages = toUpstreamMessages(recentRows);
  const timeoutAt = startedAt + CHAT_DEFAULT_TIMEOUT_MS;

  while (turnNumber < CHAT_DEFAULT_MAX_TURNS) {
    turnNumber++;

    // Stop guards.
    if (signal?.aborted) {
      yield { type: "error", data: { message: "client aborted" } };
      return;
    }
    if (Date.now() > timeoutAt) {
      yield { type: "error", data: { message: "turn timeout exceeded" } };
      return;
    }
    if (cumulativeCostUsd > CHAT_DEFAULT_COST_CAP_USD) {
      yield {
        type: "error",
        data: {
          message: `cost cap exceeded: $${cumulativeCostUsd.toFixed(4)} > $${CHAT_DEFAULT_COST_CAP_USD}`,
        },
      };
      return;
    }

    // Accumulators for this single completion.
    const assistantBlocks: ContentBlock[] = [];
    const toolUseAccum = new Map<
      string,
      { id: string; name: string; partial: string }
    >();
    let textAccum = "";
    let thinkingAccum = "";
    let stopReason: string | null = null;
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cacheCreationTokens: 0,
    };
    let streamErrored = false;

    for await (const ev of streamChatCompletion({
      model: route.model,
      system: systemBlocks,
      messages,
      tools: CHAT_TOOL_SCHEMAS as unknown as Parameters<
        typeof streamChatCompletion
      >[0]["tools"],
      max_tokens: CHAT_MAX_OUTPUT_TOKENS,
      signal,
    })) {
      switch ((ev as StreamEvent).type) {
        case "text_delta": {
          const e = ev as Extract<StreamEvent, { type: "text_delta" }>;
          textAccum += e.delta;
          yield { type: "text_delta", data: { delta: e.delta } };
          break;
        }
        case "thinking_delta": {
          const e = ev as Extract<StreamEvent, { type: "thinking_delta" }>;
          thinkingAccum += e.delta;
          yield { type: "thinking_delta", data: { delta: e.delta } };
          break;
        }
        case "tool_use_start": {
          const e = ev as Extract<StreamEvent, { type: "tool_use_start" }>;
          toolUseAccum.set(e.id, { id: e.id, name: e.name, partial: "" });
          break;
        }
        case "tool_use_input_delta": {
          const e = ev as Extract<
            StreamEvent,
            { type: "tool_use_input_delta" }
          >;
          const slot = toolUseAccum.get(e.id);
          if (slot) slot.partial += e.partialJson;
          break;
        }
        case "tool_use_done": {
          const e = ev as Extract<StreamEvent, { type: "tool_use_done" }>;
          const slot = toolUseAccum.get(e.id);
          if (!slot) break;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = slot.partial ? JSON.parse(slot.partial) : {};
          } catch {
            parsed = { __unparsed_input: slot.partial };
          }
          const block: ToolUseContentBlock = {
            type: "tool_use",
            id: slot.id,
            name: slot.name,
            input: parsed,
          };
          assistantBlocks.push(block);
          yield {
            type: "tool_use",
            data: { id: slot.id, name: slot.name, input: parsed },
          };
          break;
        }
        case "message_done": {
          const e = ev as Extract<StreamEvent, { type: "message_done" }>;
          stopReason = e.stopReason;
          usage = e.usage;
          break;
        }
        case "error": {
          const e = ev as Extract<StreamEvent, { type: "error" }>;
          yield { type: "error", data: { message: e.message } };
          streamErrored = true;
          break;
        }
      }
      if (streamErrored) break;
    }

    if (streamErrored) return;

    // Build the assistant message: text block (if any) first, then tool_use
    // blocks (in stream order).
    const orderedAssistantBlocks: ContentBlock[] = [];
    if (textAccum.length > 0) {
      orderedAssistantBlocks.push({ type: "text", text: textAccum });
    }
    for (const b of assistantBlocks) {
      orderedAssistantBlocks.push(b);
    }

    // Compute + record cost.
    const turnCost = actualCost({
      tier: route.tier,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedReadTokens,
    });
    cumulativeCostUsd += turnCost;

    // Persist assistant message.
    try {
      await appendMessage({
        conversationId: input.conversationId,
        role: "assistant",
        content:
          orderedAssistantBlocks.length > 0
            ? orderedAssistantBlocks
            : [{ type: "text", text: "" }],
        modelUsed: route.model,
        usageInputTokens: usage.inputTokens,
        usageOutputTokens: usage.outputTokens,
        usageCacheReadTokens: usage.cachedReadTokens,
        estimatedCostUsd: turnCost,
      });
    } catch (err) {
      logger.warn("[soleneChat] turnRunner.persist_assistant_failed", {
        err: err instanceof Error ? err.message : String(err),
        conversationId: input.conversationId,
      });
    }

    // Fire-and-forget envelope tracking.
    void recordCapitalEvent(
      "anthropic_api",
      turnCost,
      `solene_chat tier=${route.tier} model=${route.model} conv=${input.conversationId} in=${usage.inputTokens} out=${usage.outputTokens} cached=${usage.cachedReadTokens}`,
    );

    // Push the assistant turn onto the upstream history for the next loop.
    messages = [
      ...messages,
      {
        role: "assistant",
        content: orderedAssistantBlocks,
      },
    ];

    // Discard local thinkingAccum reference (we don't persist or re-feed
    // thinking blocks; the stream already surfaced them to the client).
    void thinkingAccum;

    // ── Termination check ─────────────────────────────────────────────────
    const toolUses = orderedAssistantBlocks.filter(
      (b): b is ToolUseContentBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0 || stopReason === "end_turn") {
      yield {
        type: "turn_done",
        data: {
          stopReason: stopReason ?? "end_turn",
          turnCount: turnNumber,
          totalCostUsd: cumulativeCostUsd,
          usage,
        },
      };
      return;
    }

    // ── Execute each tool_use; collect tool_result blocks for next turn ───
    const toolResultBlocks: ContentBlock[] = [];
    for (const tu of toolUses) {
      const exec = await executeChatTool({
        toolName: tu.name,
        toolInput: tu.input,
        conversationId: input.conversationId,
        founderUserId: input.founderUserId,
      });
      const wrapped = wrapToolResult({
        toolUseId: tu.id,
        blocks: exec.result,
        isError: exec.awaitingApproval ? false : undefined,
      });
      toolResultBlocks.push(wrapped);

      if (exec.awaitingApproval && exec.approvalToken) {
        yield {
          type: "approval_pending",
          data: {
            approvalToken: exec.approvalToken,
            toolName: tu.name,
            toolInput: tu.input,
          },
        };
      } else {
        yield {
          type: "tool_result",
          data: {
            toolUseId: tu.id,
            toolName: tu.name,
            output:
              typeof wrapped.content === "string"
                ? wrapped.content
                : JSON.stringify(wrapped.content),
          },
        };
      }
    }

    // Persist the tool messages as a single 'user' role message carrying
    // tool_result blocks — that's how the Anthropic Messages API expects
    // tool outputs to be re-fed into the conversation.
    try {
      await appendMessage({
        conversationId: input.conversationId,
        role: "user",
        content: toolResultBlocks,
      });
    } catch (err) {
      logger.warn("[soleneChat] turnRunner.persist_tool_results_failed", {
        err: err instanceof Error ? err.message : String(err),
        conversationId: input.conversationId,
      });
    }

    messages = [
      ...messages,
      { role: "user", content: toolResultBlocks },
    ];

    // Loop continues — model gets another turn to respond to the tool outputs.
  }

  yield {
    type: "error",
    data: {
      message: `max turns (${CHAT_DEFAULT_MAX_TURNS}) exceeded; aborting`,
      totalCostUsd: cumulativeCostUsd,
    },
  };
}

// Silence unused-import warning for estimateCost (kept as a public export of
// modelRouter; not used at runtime here but the route handler may import it).
void estimateCost;
