/**
 * SOLENE CHAT — provider selector with primary + failover (Batch 9).
 *
 * Why this exists:
 *   Anthropic-direct bypasses OpenRouter's ~5% pass-through margin on every
 *   Solene chat turn. With Solene chat as a high-frequency surface, that 5%
 *   compounds — bypassing it on the happy path is a structural cost
 *   reduction. OpenRouter stays in the picture as failover so a transient
 *   Anthropic outage doesn't take chat down.
 *
 * Failover policy:
 *   - Single attempt per provider (no exponential backoff loop — that's the
 *     SDK's job, not ours).
 *   - Failover only kicks in BEFORE any tokens have streamed to the client.
 *     Once `text_delta` / `thinking_delta` events have started flowing, we
 *     cannot recover mid-response — yield the error and let the caller
 *     surface it.
 *   - Only `retryable` errors trigger failover. 4xx (auth, bad-request,
 *     constitutional refusal) are not — the other provider would respond
 *     identically since both proxy to the same upstream Anthropic API.
 *
 * Env knobs:
 *   SOLENE_CHAT_PROVIDER_PRIMARY = "anthropic" (default) | "openrouter"
 *     Lets Tom flip the order in an incident without a code deploy.
 */

import { logger } from "../../../utils/logger";
import {
  streamChatCompletionAnthropic,
  type AnthropicStreamEvent,
} from "./anthropicClient";
import {
  streamChatCompletion as streamChatCompletionOpenRouter,
  type OpenRouterRequestOpts,
  type StreamEvent,
} from "./openRouterClient";

export type ProviderTag =
  | "anthropic_direct"
  | "openrouter"
  | "openrouter_failover";

export type ProviderStreamEvent = (StreamEvent | AnthropicStreamEvent) & {
  _provider: ProviderTag;
};

/**
 * Resolve the provider order from the env knob. Exported for tests.
 */
export function resolveProviderOrder(env: NodeJS.ProcessEnv = process.env): {
  primary: "anthropic_direct" | "openrouter";
  secondary: "anthropic_direct" | "openrouter";
} {
  const raw = (env.SOLENE_CHAT_PROVIDER_PRIMARY ?? "anthropic")
    .trim()
    .toLowerCase();
  if (raw === "openrouter") {
    return { primary: "openrouter", secondary: "anthropic_direct" };
  }
  // Default + any unknown value falls back to anthropic_direct as primary.
  return { primary: "anthropic_direct", secondary: "openrouter" };
}

interface FailoverError {
  message: string;
  status?: number;
  retryable: boolean;
}

/**
 * Try a single provider. Returns:
 *   - { status: "ok" } if the stream completed cleanly
 *   - { status: "failover", error } if a retryable error fired before any
 *     token was yielded (caller should try the next provider)
 *   - { status: "error", error } if the stream errored after tokens
 *     started flowing OR the error is non-retryable
 *
 * Yields events through `yieldEv` for the happy + post-token-error paths.
 */
async function tryProvider(
  provider: "anthropic_direct" | "openrouter",
  opts: OpenRouterRequestOpts,
  failoverTag: ProviderTag,
  yieldEv: (ev: ProviderStreamEvent) => void,
): Promise<{ status: "ok" } | { status: "failover" | "error"; error: FailoverError }> {
  const gen =
    provider === "anthropic_direct"
      ? streamChatCompletionAnthropic(opts)
      : (streamChatCompletionOpenRouter(opts) as AsyncIterable<StreamEvent>);

  let yieldedAny = false;
  try {
    for await (const ev of gen) {
      if (ev.type === "error") {
        const retryable =
          (ev as AnthropicStreamEvent & { type: "error" }).retryable === true;
        const status = (ev as AnthropicStreamEvent & { type: "error" }).status;
        if (!yieldedAny && retryable) {
          return {
            status: "failover",
            error: { message: ev.message, status, retryable: true },
          };
        }
        // Already streaming OR non-retryable — surface the error to the caller.
        yieldEv({ ...ev, _provider: failoverTag });
        return {
          status: "error",
          error: { message: ev.message, status, retryable: false },
        };
      }
      if (ev.type === "text_delta" || ev.type === "thinking_delta") {
        yieldedAny = true;
      }
      yieldEv({ ...ev, _provider: failoverTag });
    }
    return { status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!yieldedAny) {
      // Generator threw before any token — eligible for failover.
      return {
        status: "failover",
        error: { message, retryable: true },
      };
    }
    yieldEv({
      type: "error",
      message,
      _provider: failoverTag,
    } as ProviderStreamEvent);
    return { status: "error", error: { message, retryable: false } };
  }
}

/**
 * Stream a chat completion with primary + failover. Yields events tagged
 * with `_provider` so the caller (turnRunner) can include the provider in
 * its `[ai-cost]` log line for per-provider spend tracking.
 */
export async function* streamChatWithFailover(
  opts: OpenRouterRequestOpts,
): AsyncIterable<ProviderStreamEvent> {
  const { primary, secondary } = resolveProviderOrder();

  // Each tag identifies the provider used for THIS attempt. The secondary
  // attempt is tagged "openrouter_failover" (or "anthropic_direct" if Tom
  // has flipped the order) so cost analytics can distinguish failover spend
  // from happy-path spend.
  const primaryTag: ProviderTag =
    primary === "anthropic_direct" ? "anthropic_direct" : "openrouter";
  const secondaryTag: ProviderTag =
    primary === "anthropic_direct" ? "openrouter_failover" : "anthropic_direct";

  const events: ProviderStreamEvent[] = [];
  const sink = (ev: ProviderStreamEvent) => events.push(ev);

  const first = await tryProvider(primary, opts, primaryTag, sink);
  // Drain any events the first provider emitted (happy path or post-token error).
  for (const ev of events.splice(0, events.length)) yield ev;

  if (first.status === "ok" || first.status === "error") return;

  // First provider failed before yielding tokens — log and failover.
  logger.info("[solene-chat] provider failover", {
    metadata: {
      from: primaryTag,
      to: secondaryTag,
      reason: first.error.message,
      status: first.error.status,
    },
  });

  const second = await tryProvider(secondary, opts, secondaryTag, sink);
  for (const ev of events.splice(0, events.length)) yield ev;

  if (second.status === "failover") {
    // Both providers failed pre-token — emit a terminal error so the caller
    // sees a stop signal. Tagged with the secondary provider since that's
    // the last one attempted.
    yield {
      type: "error",
      message: `both providers failed: primary(${primaryTag})=${first.error.message}; secondary(${secondaryTag})=${second.error.message}`,
      _provider: secondaryTag,
    } as ProviderStreamEvent;
  }
}
