import OpenAI from "openai";
import { openAICircuitBreaker, CircuitOpenError } from "./circuitBreaker";
import { logger } from "./logger";

let openaiClient: OpenAI | null = null;

/**
 * Returns the platform AI client.
 *
 * Resolution order:
 *   1. OpenRouter (preferred) — AI_INTEGRATIONS_OPENROUTER_API_KEY
 *   2. AI Integrations key — AI_INTEGRATIONS_OPENAI_API_KEY (can point at any OpenAI-compatible API)
 *   3. Legacy bare key — OPENAI_API_KEY
 *
 * Users who want to bring their own OpenAI key can set it via the Settings UI;
 * platform operations always go through OpenRouter.
 */
export function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    // Prefer OpenRouter
    const openrouterKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    if (openrouterKey) {
      openaiClient = new OpenAI({
        apiKey: openrouterKey,
        baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        defaultHeaders: { "HTTP-Referer": "https://acreos.fly.dev", "X-Title": "AcreOS" },
      });
      return openaiClient;
    }

    // Fall back to AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

export function requireOpenAIClient(): OpenAI {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error("AI client not available - set AI_INTEGRATIONS_OPENROUTER_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY");
  }
  return client;
}

/**
 * Call an OpenAI API function protected by the circuit breaker.
 * Falls back gracefully when the circuit is OPEN (too many recent failures).
 *
 * Usage:
 *   const result = await callWithCircuitBreaker(() => openai.chat.completions.create(...));
 */
export async function callWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
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
