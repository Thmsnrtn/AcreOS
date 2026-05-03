/**
 * aiCostRates — central, per-million-token pricing table.
 *
 * Phase 3 Week 9: per-org AI daily cost cap.
 *
 * The router ingests usage in {promptTokens, completionTokens} and calls
 * `computeCostUsd(model, promptTokens, completionTokens)`. The result is the
 * USD figure we accumulate into ai_usage_daily.totalUsd.
 *
 * Pricing source: provider public price pages (Anthropic, OpenAI, DeepSeek)
 * as of 2026-05. Prices are per *one million* tokens (input / output).
 *
 * We keep this in-tree (not DB-backed) because:
 *   1. Pricing changes are infrequent and reviewable in a PR.
 *   2. The router needs to compute cost synchronously without a DB hop.
 *
 * Adding a new model:
 *   - Add an entry to AI_COST_RATES with input/output per-million USD.
 *   - Optionally add `cachedInput` for Anthropic prompt-cache reads
 *     (90% discount on the cached portion).
 *
 * The model IDs used here MUST match the OpenRouter model IDs returned by
 * the upstream API in `response.model`. Unknown models fall back to the
 * conservative `DEFAULT_RATE` to ensure we never silently report $0.
 */

export interface AICostRate {
  /** USD per 1,000,000 input tokens. */
  input: number;
  /** USD per 1,000,000 output tokens. */
  output: number;
  /** Optional USD per 1M cached-input tokens (Anthropic prompt caching). */
  cachedInput?: number;
}

// Conservative fallback for unknown models — assume mid-tier pricing.
// Better to slightly overcount than to silently $0 a real call.
export const DEFAULT_RATE: AICostRate = { input: 1.0, output: 3.0 };

export const AI_COST_RATES: Record<string, AICostRate> = {
  // ── Anthropic (via OpenRouter) ────────────────────────────────────────────
  "anthropic/claude-haiku-4-5-20251001": { input: 0.80, output: 4.00, cachedInput: 0.08 },
  "anthropic/claude-haiku-4-5":          { input: 0.80, output: 4.00, cachedInput: 0.08 },
  "anthropic/claude-sonnet-4-6":         { input: 3.00, output: 15.00, cachedInput: 0.30 },
  "anthropic/claude-sonnet-4-5":         { input: 3.00, output: 15.00, cachedInput: 0.30 },
  "anthropic/claude-opus-4-6":           { input: 15.00, output: 75.00, cachedInput: 1.50 },
  "anthropic/claude-opus-4":             { input: 15.00, output: 75.00, cachedInput: 1.50 },

  // ── OpenAI (via OpenRouter) ───────────────────────────────────────────────
  "openai/gpt-4o":      { input: 2.50, output: 10.00 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.60 },

  // ── DeepSeek (via OpenRouter) ─────────────────────────────────────────────
  "deepseek/deepseek-chat":     { input: 0.14, output: 0.28 },
  "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },

  // ── Direct OpenAI (fallback path) ────────────────────────────────────────
  "gpt-4o":      { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
};

/**
 * Look up the rate for a model id, falling back to DEFAULT_RATE if unknown.
 * Match is case-insensitive on the exact model id.
 */
export function getRate(model: string): AICostRate {
  if (!model) return DEFAULT_RATE;
  return AI_COST_RATES[model] || AI_COST_RATES[model.toLowerCase()] || DEFAULT_RATE;
}

/**
 * Compute USD cost of a single AI call.
 *
 * @param model           OpenRouter model id (matches `response.model`).
 * @param promptTokens    Input tokens billed.
 * @param completionTokens Output tokens billed.
 * @param cachedInputTokens Optional — portion of input tokens served from
 *                          Anthropic's prompt cache. Billed at the discounted
 *                          `cachedInput` rate when available.
 */
export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedInputTokens: number = 0,
): number {
  if (!Number.isFinite(promptTokens) || promptTokens < 0) promptTokens = 0;
  if (!Number.isFinite(completionTokens) || completionTokens < 0) completionTokens = 0;
  if (!Number.isFinite(cachedInputTokens) || cachedInputTokens < 0) cachedInputTokens = 0;

  const rate = getRate(model);
  const freshInput = Math.max(0, promptTokens - cachedInputTokens);

  const cachedRate = rate.cachedInput ?? rate.input;
  const inputUsd  = (freshInput * rate.input + cachedInputTokens * cachedRate) / 1_000_000;
  const outputUsd = (completionTokens * rate.output) / 1_000_000;

  return inputUsd + outputUsd;
}

/**
 * Returns the list of known model ids — used by the founder dashboard to
 * label per-model bars and detect "unknown model" rows.
 */
export function knownModels(): string[] {
  return Object.keys(AI_COST_RATES);
}
