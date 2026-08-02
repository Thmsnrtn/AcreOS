/**
 * AI-spend metering shim for the raw platform AI client.
 *
 * The Phase-0 audit found ~23 files that call `requireOpenAIClient()` /
 * `getOpenAIClient()` directly and run their completions OUTSIDE `routeAITask`,
 * so their token spend was invisible to the cost telemetry the founder's
 * dashboards and the platform ceiling read — the one gate that "always holds"
 * could not see the spend most likely to run away (a looping negotiation or
 * diligence agent).
 *
 * This wraps the client's non-streaming `chat.completions.create` so every such
 * call posts to the SAME telemetry sink `aiRouter` already uses
 * (`recordAiCall` → ai_call_log + budget + per-org ledger). It is:
 *   - transparent: returns the SDK's original promise untouched (callers keep
 *     `.withResponse()` etc.);
 *   - non-blocking + best-effort: metering runs on a detached chain and never
 *     throws, never adds latency to the caller;
 *   - double-count-safe: aiRouter builds its OWN clients and never calls
 *     getOpenAIClient(), so this meters ONLY the bypass callsites.
 * Streaming calls pass through unmetered (the stream can't be observed without
 * consuming it) — a later routeAITask migration covers those.
 */
import type OpenAI from "openai";

export interface AiUsageSample {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  responseId: string | null;
}

interface RawCompletion {
  model?: unknown;
  id?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
}

/** Pure extraction of the billable usage from a non-streaming completion. */
export function extractAiUsage(res: unknown): AiUsageSample | null {
  if (!res || typeof res !== "object") return null;
  const r = res as RawCompletion;
  if (!r.usage || !r.model) return null;
  return {
    model: String(r.model),
    promptTokens: Number(r.usage.prompt_tokens ?? 0) || 0,
    completionTokens: Number(r.usage.completion_tokens ?? 0) || 0,
    cachedInputTokens: Number(r.usage.prompt_tokens_details?.cached_tokens ?? 0) || 0,
    responseId: r.id ? String(r.id) : null,
  };
}

export type AiUsageRecorder = (usage: AiUsageSample, latencyMs: number) => void | Promise<void>;

/** Default recorder — lazy-imports the heavy services so this leaf util stays light. */
export const defaultAiUsageRecorder: AiUsageRecorder = async (usage, latencyMs) => {
  try {
    let costCents = 0;
    try {
      const { estimateCost } = await import("../services/aiRouter");
      costCents = estimateCost(
        usage.model,
        usage.promptTokens,
        usage.completionTokens,
        usage.cachedInputTokens,
      );
    } catch {
      /* cost stays 0 — the call is still recorded (token counts visible) */
    }
    const { recordAiCall } = await import("../services/ai-telemetry");
    await recordAiCall({
      organizationId: null, // raw-client callsites lack org context
      model: usage.model,
      complexityClass: "other",
      feature: "unknown", // counted in ai_call_log + platform budget; avoids coerce-warn spam
      promptTokens: usage.promptTokens,
      cachedInputTokens: usage.cachedInputTokens,
      completionTokens: usage.completionTokens,
      costCents,
      latencyMs,
      openrouterResponseId: usage.responseId,
    });
  } catch {
    /* fire-and-forget: metering must never surface an error to the caller */
  }
};

/**
 * Wrap a client's `chat.completions.create` so non-streaming calls are metered.
 * Mutates and returns the same client instance. Idempotent — safe to call once
 * at singleton creation.
 */
export function meterChatCompletions(
  client: OpenAI,
  record: AiUsageRecorder = defaultAiUsageRecorder,
): OpenAI {
  const completions: any = client.chat.completions;
  if (completions.__acreosMetered) return client;
  const originalCreate = completions.create.bind(completions);

  completions.create = function meteredCreate(body: any, options?: any) {
    const result = originalCreate(body, options);
    // Streaming responses can't be observed without consuming them — skip.
    if (body?.stream) return result;
    const started = Date.now();
    Promise.resolve(result)
      .then((res: unknown) => {
        const usage = extractAiUsage(res);
        if (usage) void Promise.resolve(record(usage, Date.now() - started)).catch(() => {});
      })
      .catch(() => {
        /* the caller owns the real error; the metering chain stays silent */
      });
    return result; // untouched original (APIPromise) — full SDK surface preserved
  };
  completions.__acreosMetered = true;
  return client;
}
