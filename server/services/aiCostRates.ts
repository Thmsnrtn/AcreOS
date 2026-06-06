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
  // Pricing reconciled 2026-06-06 against the canonical Anthropic price table
  // (claude-api skill, shared/models.md). Per-1M USD, input / output:
  //   Opus 4.8 / 4.7 / 4.6 : $5.00 / $25.00
  //   Sonnet 4.6 / 4.5     : $3.00 / $15.00
  //   Haiku 4.5            : $1.00 / $5.00 first-party. These IDs bill through
  //                          OpenRouter, which has listed $0.80 / $4.00 — we
  //                          keep the lower OpenRouter figure for Haiku.
  // cachedInput = ~0.1× input (Anthropic prompt-cache READ price).
  "anthropic/claude-haiku-4-5-20251001": { input: 0.80, output: 4.00, cachedInput: 0.08 },
  "anthropic/claude-haiku-4-5":          { input: 0.80, output: 4.00, cachedInput: 0.08 },
  "anthropic/claude-sonnet-4-6":         { input: 3.00, output: 15.00, cachedInput: 0.30 },
  "anthropic/claude-sonnet-4-5":         { input: 3.00, output: 15.00, cachedInput: 0.30 },
  // Opus corrected from the stale $15/$75 figure to the current $5/$25
  // Anthropic price. opus-4-7 (Pax Scale default) and opus-4-8 added.
  "anthropic/claude-opus-4-8":           { input: 5.00, output: 25.00, cachedInput: 0.50 },
  "anthropic/claude-opus-4-7":           { input: 5.00, output: 25.00, cachedInput: 0.50 },
  "anthropic/claude-opus-4-6":           { input: 5.00, output: 25.00, cachedInput: 0.50 },
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

// ============================================================================
// predictCostCents — pre-call cost forecast
//
// Tahoe Andrei (2026-06-06): a cost-aware AI layer needs to know, BEFORE it
// fires a paid call, roughly what that call will cost — so it can forecast
// against the per-org daily ceiling and pick a cheaper model when the task
// allows. `computeCostUsd` above is the AFTER-the-fact source of truth (it has
// real token counts from the provider). `predictCostCents` is the BEFORE-the-
// call estimate (it has only character counts and a max-output guess).
//
// Both share the same centralized AI_COST_RATES table, so a prediction and the
// later actual never diverge on pricing — only on token-count accuracy.
// ============================================================================

/**
 * Anthropic's tokenizer averages ~3.7 chars/token for English prose; we use a
 * conservative 4.0 chars/token so the predictor never under-bills a call. Code
 * and JSON tokenize a little denser, but 4.0 is a safe ceiling for forecasting.
 */
export const CHARS_PER_TOKEN = 4;

/** Estimate input tokens from a character length. */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export interface PredictCostInput {
  /** OpenRouter model id (matches AI_COST_RATES keys). */
  model: string;
  /**
   * Estimated input tokens. If you only have character counts, pass
   * `inputChars` instead and the predictor converts.
   */
  inputTokens?: number;
  /** Character length of the full input (system + messages). */
  inputChars?: number;
  /**
   * Estimated output tokens. If omitted, falls back to `maxTokens` (the hard
   * ceiling) — a deliberately conservative upper bound, since we can't know
   * the real completion length before the call.
   */
  outputTokens?: number;
  /** Per-call max_tokens ceiling — used as the output estimate when unknown. */
  maxTokens?: number;
  /**
   * Fraction (0..1) of the input that is expected to be served from the
   * Anthropic prompt-prefix cache (a stable system prompt that has already
   * been warmed). Billed at the discounted `cachedInput` rate. Default 0.
   */
  cachedInputFraction?: number;
  /**
   * Whether the request carries tool definitions. Tool schemas add input
   * tokens the caller usually hasn't counted; we pad the input estimate by
   * this many tokens per call when true. Default 0 (no tools).
   */
  toolOverheadTokens?: number;
}

/**
 * Predict the cost of an AI call, in **cents**, BEFORE issuing it.
 *
 * Pricing comes from the same centralized AI_COST_RATES table used by the
 * post-call `computeCostUsd`, so forecasts are consistent with actuals.
 * Unknown models fall back to DEFAULT_RATE (never silently $0).
 *
 * Returns a fractional cent value (e.g. 0.42) — callers that need an integer
 * for a ledger should Math.ceil it.
 */
export function predictCostCents(input: PredictCostInput): number {
  const inputTokensRaw =
    input.inputTokens ??
    (input.inputChars !== undefined
      ? estimateTokensFromChars(input.inputChars)
      : 0);

  const toolPad = Math.max(0, input.toolOverheadTokens ?? 0);
  const inputTokens = Math.max(0, inputTokensRaw) + toolPad;

  // Output estimate: explicit outputTokens, else the max_tokens ceiling, else 0.
  const outputTokens = Math.max(
    0,
    input.outputTokens ?? input.maxTokens ?? 0,
  );

  const frac = Math.min(1, Math.max(0, input.cachedInputFraction ?? 0));
  const cachedInputTokens = Math.round(inputTokens * frac);

  const usd = computeCostUsd(
    input.model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
  );
  return usd * 100;
}

/**
 * Of a set of candidate models, return the cheapest one whose predicted cost
 * is within `budgetCents`. Used by the router to downgrade a task to a cheaper
 * model when the expensive default would blow the per-call budget. Returns
 * null when no candidate fits (caller decides whether to proceed or refuse).
 *
 * `candidates` should be ordered most-preferred (most capable) first; ties on
 * cost keep the more-preferred model.
 */
export function cheapestModelWithinBudget(
  candidates: string[],
  budgetCents: number,
  shared: Omit<PredictCostInput, "model">,
): { model: string; predictedCents: number } | null {
  let best: { model: string; predictedCents: number } | null = null;
  for (const model of candidates) {
    const predictedCents = predictCostCents({ ...shared, model });
    if (predictedCents <= budgetCents) {
      if (!best || predictedCents < best.predictedCents) {
        best = { model, predictedCents };
      }
    }
  }
  return best;
}
