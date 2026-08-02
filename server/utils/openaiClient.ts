import OpenAI from "openai";
import { openAICircuitBreaker, CircuitOpenError } from "./circuitBreaker";
import { logger } from "./logger";
import { meterChatCompletions } from "./aiClientMetering";

let openaiClient: OpenAI | null = null;
let warnedNoKey = false;

/**
 * Returns the platform AI client — OpenRouter-only.
 *
 * Every chat/completion call goes through OpenRouter so the tiered-model
 * routing in `services/aiRouter.ts` (SIMPLE→DeepSeek, MODERATE→Haiku,
 * COMPLEX→Sonnet, CRITICAL→Opus) can keep platform AI cost as low as the
 * task allows. The previous OpenAI fallback was a cost trap: any service
 * calling `getOpenAIClient()` without OPENROUTER configured would silently
 * hit OpenAI at full price for tasks that should have routed to Haiku /
 * DeepSeek. Better to fail explicitly and fix the config.
 *
 * Whisper (audio transcription) is a separate concern — OpenRouter does
 * not proxy /v1/audio/transcriptions, so the few callers that need it
 * (server/routes-field-scout.ts)
 * read process.env.OPENAI_API_KEY directly and hit OpenAI's API. Do not
 * route those through this helper.
 */
export function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    const openrouterKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    if (!openrouterKey) {
      if (!warnedNoKey) {
        warnedNoKey = true;
        logger.warn(
          "[ai] AI_INTEGRATIONS_OPENROUTER_API_KEY is not set — AI features will be disabled. " +
          "Platform AI is OpenRouter-only; set this secret to enable.",
        );
      }
      return null;
    }
    openaiClient = new OpenAI({
      apiKey: openrouterKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://acreos.fly.dev", "X-Title": "AcreOS" },
    });
    // Meter the raw-client callsites (the ~23 files that call this helper
    // directly, outside routeAITask) so their token spend lands in the same
    // telemetry the cost dashboards + platform budget read. aiRouter builds its
    // own clients, so this can never double-count. Best-effort, non-blocking.
    openaiClient = meterChatCompletions(openaiClient);
  }
  return openaiClient;
}

export function requireOpenAIClient(): OpenAI {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error(
      "AI client not available — set AI_INTEGRATIONS_OPENROUTER_API_KEY. " +
      "Platform AI routes through OpenRouter only; direct OpenAI keys are no longer used.",
    );
  }
  return client;
}

/**
 * Call an OpenAI API function protected by the circuit breaker.
 * Falls back gracefully when the circuit is OPEN (too many recent failures).
 *
 * Usage:
 *   const result = await callWithCircuitBreaker(() => openai.chat.completions.create(...));
 *
 * Only respects the opt-in SIMULATION_MODE_AI_PAID flag — the global
 * SIMULATION_MODE=true kill-switch deliberately leaves AI live so
 * test runs can grade real AI decisions. Tokens are cheap and
 * metered; the point of the testing suite is to observe what the AI
 * actually decides, not to test that pipeline wiring runs.
 *
 * Set SIMULATION_MODE_AI_PAID=true only if you need a long vacation
 * simulation and don't want the AI budget running up.
 */
export async function callWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  const { isCategorySimulated, recordSimulatedAction } = await import("./simulationMode");
  if (isCategorySimulated("ai_paid")) {
    const rec = await recordSimulatedAction("ai_paid", "openai.call", {});
    // Synthetic OpenAI-shaped response. Callers that parse JSON will
    // get empty-but-valid output; callers that read `.choices[0].message.content`
    // get a placeholder they can distinguish from real output.
    return {
      id: rec.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "simulation",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: '{"simulated": true, "note": "SIMULATION_MODE_AI_PAID short-circuited this call"}',
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    } as any;
  }
  return openAICircuitBreaker.call(fn);
}

/**
 * Credit-checked AI call: verifies the org has sufficient credits before
 * calling the AI API, then deducts credits on success.
 *
 * Throws an Error with message "Insufficient credits" if the org cannot afford the call.
 * Founders bypass all credit checks.
 */
export async function callWithCreditCheck<T>(
  organizationId: number,
  fn: () => Promise<T>,
  costCents = 2, // default to ai_chat cost
): Promise<T> {
  // Lazy import to avoid circular dependencies
  const { CreditService } = await import("../services/credits");
  const creditService = new CreditService();

  const hasCredits = await creditService.hasEnoughCredits(organizationId, costCents);
  if (!hasCredits) {
    logger.warn(`[AI] Organization ${organizationId} blocked — insufficient credits (need ${costCents}¢)`);
    throw new Error("Insufficient credits for AI request. Please purchase a credit pack to continue.");
  }

  const result = await openAICircuitBreaker.call(fn);

  // Deduct after success — don't charge for failed calls
  await creditService.deductCredits(organizationId, costCents, "AI chat completion", {
    actionType: "ai_chat",
  }).catch((err) => {
    logger.error("[AI] Failed to deduct credits after successful call", err instanceof Error ? err : undefined);
  });

  return result;
}

export { CircuitOpenError };
