/**
 * aiSpendGuard — cost-ceiling + telemetry for AI surfaces that cannot go
 * through routeAITask.
 *
 * Audit F-16-1 / F-08-4: vaService and supportAgent build their own OpenAI
 * client and call gpt-4o directly, escaping the platform cost ceiling, the
 * per-org quota, and telemetry. They CANNOT be migrated to routeAITask like
 * the single-shot surfaces (docs/openai-bypass-migration.md) because they are
 * tool-calling agents and `routeAITask`'s message shape has no `tool` role and
 * its response has no `tool_calls` — routing them through it would break the
 * agent loop entirely.
 *
 * This module gives those agents the two protections that matter most without
 * touching their tool-calling loop:
 *   1. assertAiSpendAllowed(orgId) — the SAME platform daily cost-ceiling gate
 *      routeAITask runs, so a runaway/expensive agent stops when the platform
 *      is over budget instead of spending unbounded past the ceiling.
 *   2. recordExternalAiSpend(...) — writes an aiTelemetryEvents row so the
 *      agent's spend shows in /founder/financials COGS AND counts toward the
 *      ceiling's own 24h sum (without this the ceiling can't see this spend).
 *
 * 2026-10 cost efficiency — THE METERED RAW-CALL PATH. `meteredChatCompletion`
 * and `meteredAnthropicMessage` below are the tool-aware half of the one
 * metered gateway (routeAITask is the other half, for message-in/text-out
 * tasks). A raw provider call made through them gets, with no change to its
 * request, its loop, or its model:
 *   1. the platform + per-org cost ceiling BEFORE the call (customer-facing
 *      callers fail open on a ceiling READ error, background callers fail
 *      closed — the same posture split routeAITask and the dispatch worker use);
 *   2. cost telemetry AFTER it — an ai_telemetry_events row (what the ceilings
 *      and the daily guard sum) and an ai_call_log row + financial_ledger
 *      ai_tokens debit via ai-telemetry.recordAiCall (what per-org unit
 *      economics reads), costed with prompt-cache reads at the cached rate;
 *   3. Anthropic prompt caching on a long stable system prompt (stamped only
 *      where absent; OpenAI models cache automatically on the provider side).
 * BYOK calls (the customer's own key paid) skip the ceilings and record $0.
 *
 * Every production model call in server/ must go through routeAITask or one of
 * these; tests/unit/modelCallsGoThroughTheGateway.test.ts ratchets the rest.
 */

import type OpenAI from "openai";
import { assertWithinAiCostCeiling } from "./aiCostCeiling";
import { computeCostUsd } from "./aiCostRates";
import { ANTHROPIC_CACHE_MIN_CHARS } from "./promptCache";
import { clock } from "../utils/clock";
import { logger } from "../utils/logger";

/**
 * Throws AiCostCeilingExceededError (code AI_COST_CEILING_EXCEEDED) when the
 * platform is over its daily AI spend ceiling. Call at the ENTRY of a
 * non-router AI agent so it respects the same envelope routeAITask enforces.
 */
export async function assertAiSpendAllowed(orgId: number | null): Promise<void> {
  await assertWithinAiCostCeiling(orgId);
}

/**
 * Record one non-router model call in aiTelemetryEvents (fire-and-forget, never
 * throws). Mirrors aiRouter's own telemetry write so external-agent spend lands
 * in the same table the ceiling sums and the COGS rollup reads.
 */
export function recordExternalAiSpend(input: {
  orgId: number | null;
  taskType: string;
  model: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Prompt-cache READ tokens (included in promptTokens), billed at the cached rate. */
  cachedInputTokens?: number;
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string | null;
  /** The customer's own key paid the provider — $0 platform cost. */
  byok?: boolean;
}): void {
  void (async () => {
    try {
      const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
      const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
      const cachedInputTokens = Math.max(0, Math.trunc(input.cachedInputTokens ?? 0));
      const usd = input.byok ? 0 : computeCostUsd(input.model, promptTokens, completionTokens, cachedInputTokens);
      const { db } = await import("../db");
      const { aiTelemetryEvents } = await import("@shared/schema");
      await db.insert(aiTelemetryEvents).values({
        organizationId: input.orgId,
        taskType: input.taskType,
        provider: input.provider ?? "openai",
        model: input.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostCents: (usd * 100).toFixed(4),
        ...(input.latencyMs !== undefined ? { latencyMs: Math.max(0, Math.trunc(input.latencyMs)) } : {}),
        success: input.success ?? true,
        ...(input.errorMessage ? { errorMessage: input.errorMessage.slice(0, 500) } : {}),
      });
    } catch (err) {
      logger.warn("[aiSpendGuard] failed to record external AI spend", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  })();
}

// ─── The metered raw-call path ─────────────────────────────────────────────

/** Who triggered the call — decides the ceiling's read-error posture. */
export type AiCallOrigin = "customer" | "background";

export interface MeteredCallMeta {
  /** Feature tag: ai_telemetry_events.task_type and ai_call_log.feature. */
  taskType: string;
  /** The org the spend is attributed to; null = platform-internal. */
  orgId: number | null | undefined;
  /**
   * "customer": a person is waiting — a ceiling READ error fails open.
   * "background": no one is waiting — a ceiling read error fails closed.
   * An exceeded ceiling refuses in both.
   */
  origin: AiCallOrigin;
  /** The customer's own key serves this call: no ceilings, $0 recorded. */
  byok?: boolean;
}

/** Price-table id for a model as sent: direct-Anthropic ids get the catalogue prefix. */
export function pricingModelId(model: string): string {
  return /^claude-/.test(model) ? `anthropic/${model}` : model;
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("anthropic/") || model.startsWith("claude-");
}

/**
 * Enforce the cost ceilings for one metered call. Exported for callers that
 * stream (and so cannot use the wrapper) but must still be gated.
 */
export async function assertMeteredCallAllowed(meta: MeteredCallMeta): Promise<void> {
  if (meta.byok || process.env.AI_COST_CEILING_BYPASS === "1") return;
  try {
    await assertWithinAiCostCeiling(meta.orgId ?? null, meta.origin === "background" ? { failClosed: true } : undefined);
  } catch (err) {
    if ((err as { code?: string })?.code === "AI_COST_CEILING_EXCEEDED") throw err;
    if (meta.origin === "background") throw err;
    logger.warn("[aiSpendGuard] cost ceiling unreadable for a customer-facing call — allowing", {
      metadata: { taskType: meta.taskType, detail: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Stamp an Anthropic cache breakpoint on a long system message that has none.
 * Pure; returns the params unchanged when not eligible. Exported for tests.
 */
export function withPromptCache<P extends { model: string; messages: readonly unknown[] }>(params: P): P {
  if (!isAnthropicModel(params.model)) return params;
  let stamped = false;
  const messages = params.messages.map((m) => {
    const msg = m as { role?: string; content?: unknown; cache_control?: unknown };
    if (
      !stamped &&
      msg.role === "system" &&
      typeof msg.content === "string" &&
      msg.content.length >= ANTHROPIC_CACHE_MIN_CHARS &&
      msg.cache_control === undefined
    ) {
      stamped = true;
      return { ...msg, cache_control: { type: "ephemeral" } };
    }
    return m;
  });
  return stamped ? { ...params, messages } : params;
}

interface MeteredOutcome {
  model: string;
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  latencyMs: number;
  responseId: string | null;
  error: unknown;
}

function recordMeteredCall(meta: MeteredCallMeta, o: MeteredOutcome, provider: string): void {
  const priced = pricingModelId(o.model);
  const usd = meta.byok || o.error ? 0 : computeCostUsd(priced, o.promptTokens, o.completionTokens, o.cachedInputTokens);
  recordExternalAiSpend({
    orgId: meta.orgId ?? null,
    taskType: meta.taskType,
    model: priced,
    provider,
    promptTokens: o.promptTokens,
    completionTokens: o.completionTokens,
    cachedInputTokens: o.cachedInputTokens,
    latencyMs: o.latencyMs,
    success: !o.error,
    errorMessage: o.error ? (o.error instanceof Error ? o.error.message : String(o.error)) : null,
    byok: meta.byok,
  });
  void (async () => {
    try {
      const { recordAiCall, complexityClassFromTaskType, classifyError } = await import("./ai-telemetry");
      await recordAiCall({
        organizationId: meta.orgId ?? null,
        model: priced,
        complexityClass: complexityClassFromTaskType(meta.taskType),
        feature: meta.taskType,
        promptTokens: o.promptTokens,
        cachedInputTokens: o.cachedInputTokens,
        completionTokens: o.completionTokens,
        costCents: usd * 100,
        latencyMs: o.latencyMs,
        cacheHit: false,
        errorClass: o.error ? classifyError(o.error) : null,
        openrouterResponseId: o.error ? null : o.responseId,
      });
    } catch (err) {
      logger.warn("[aiSpendGuard] ai_call_log write skipped", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  })();
  if (!o.error) {
    logger.info("[ai-cost]", {
      metadata: {
        surface: "aiSpendGuard",
        taskType: meta.taskType,
        origin: meta.origin,
        model: priced,
        orgId: meta.orgId ?? null,
        inputTokens: o.promptTokens,
        cachedInputTokens: o.cachedInputTokens,
        outputTokens: o.completionTokens,
        costUsd: Number(usd.toFixed(4)),
        latencyMs: o.latencyMs,
        byok: !!meta.byok,
      },
    });
  }
}

/** Minimal structural client — the OpenAI SDK, a BYOK client, or a test double. */
export interface ChatCompletionsClient {
  chat: { completions: { create: (body: any, options?: any) => Promise<any> } };
}

/**
 * A raw (tool-calling capable) OpenAI-compatible chat completion, metered:
 * ceiling before, telemetry after, Anthropic prompt cache stamped. The request
 * is otherwise passed through untouched — same model, same tools, same client.
 */
export async function meteredChatCompletion(
  client: ChatCompletionsClient,
  params: OpenAI.ChatCompletionCreateParamsNonStreaming,
  meta: MeteredCallMeta,
  options?: OpenAI.RequestOptions,
): Promise<OpenAI.ChatCompletion> {
  await assertMeteredCallAllowed(meta);
  const body = withPromptCache(params);
  const started = clock.nowMs();
  try {
    const response = (await client.chat.completions.create(body, options)) as OpenAI.ChatCompletion;
    const usage = response?.usage as (OpenAI.CompletionUsage & { cache_read_input_tokens?: number }) | undefined;
    recordMeteredCall(
      meta,
      {
        model: params.model,
        promptTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        latencyMs: clock.nowMs() - started,
        responseId: (response as { id?: string } | undefined)?.id ?? null,
        error: null,
      },
      "openrouter",
    );
    return response;
  } catch (err) {
    recordMeteredCall(
      meta,
      { model: params.model, promptTokens: 0, cachedInputTokens: 0, completionTokens: 0, latencyMs: clock.nowMs() - started, responseId: null, error: err },
      "openrouter",
    );
    throw err;
  }
}

/** Anthropic SDK usage block (cache fields are not in every SDK type yet). */
interface AnthropicUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Minimal structural Anthropic client. */
export interface AnthropicMessagesClient<R> {
  messages: { create: (body: any, options?: any) => Promise<R> };
}

/**
 * A raw Anthropic Messages API call, metered. A plain-string `system` at or
 * above the cache threshold is sent as one text block with an ephemeral cache
 * breakpoint (identical text, so identical behaviour); an array `system` is
 * left exactly as the caller built it.
 *
 * Cost: Anthropic reports `input_tokens` EXCLUDING cache reads and writes, so
 * the prompt total is input + cache_read + cache_creation, with cache_read
 * billed at the cached rate. (Cache WRITES bill at 1.25x input; they are costed
 * at 1x here — a slight undercount on the first call of a 5-minute window.)
 */
export async function meteredAnthropicMessage<R extends { id?: string; usage?: AnthropicUsageLike | null }>(
  client: AnthropicMessagesClient<R>,
  params: { model: string; system?: unknown; [k: string]: unknown },
  meta: MeteredCallMeta,
  options?: Record<string, unknown>,
): Promise<R> {
  await assertMeteredCallAllowed(meta);
  const body =
    typeof params.system === "string" && params.system.length >= ANTHROPIC_CACHE_MIN_CHARS
      ? { ...params, system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }] }
      : params;
  const started = clock.nowMs();
  try {
    const response = await client.messages.create(body, options);
    const u = (response?.usage ?? {}) as AnthropicUsageLike;
    const read = u.cache_read_input_tokens ?? 0;
    const written = u.cache_creation_input_tokens ?? 0;
    recordMeteredCall(
      meta,
      {
        model: params.model,
        promptTokens: (u.input_tokens ?? 0) + read + written,
        cachedInputTokens: read,
        completionTokens: u.output_tokens ?? 0,
        latencyMs: clock.nowMs() - started,
        responseId: response?.id ?? null,
        error: null,
      },
      "anthropic",
    );
    return response;
  } catch (err) {
    recordMeteredCall(
      meta,
      { model: params.model, promptTokens: 0, cachedInputTokens: 0, completionTokens: 0, latencyMs: clock.nowMs() - started, responseId: null, error: err },
      "anthropic",
    );
    throw err;
  }
}
