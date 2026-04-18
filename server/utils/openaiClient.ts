import OpenAI from "openai";
import { openAICircuitBreaker, CircuitOpenError } from "./circuitBreaker";
import { logger } from "./logger";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
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
    throw new Error("OpenAI client not available - AI_INTEGRATIONS_OPENAI_API_KEY not configured");
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
