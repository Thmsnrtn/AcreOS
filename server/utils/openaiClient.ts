import OpenAI from "openai";
import { openAICircuitBreaker, CircuitOpenError } from "./circuitBreaker";

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

export { CircuitOpenError };
