/**
 * models.ts — SINGLE SOURCE OF TRUTH for AI model IDs (and their token prices).
 *
 * Andrei (andrei/ai-hygiene, 2026-06): before this file, model IDs were
 * scattered and DISAGREED. `aiRouter.ts` pinned the top model to
 * `anthropic/claude-opus-4-6` while `server/ai/paxModelTier.ts` pinned it to
 * `anthropic/claude-opus-4-7` — so the two systems that pick the highest-stakes
 * model chose different (one stale) Opus versions. And `aiRouter.ts` carried its
 * OWN cost table keyed to the OLD Opus price ($15/$75) while the model is really
 * $5/$25, so cost estimates were ~3× wrong, with a silent `{input:1,output:3}`
 * fallback for unkeyed models that quietly undercounted.
 *
 * This module is now the ONE place that names every model the platform routes
 * to. Both routers import their IDs from here, and the cost figures resolve
 * through the already-centralized `aiCostRates.AI_COST_RATES` table — so an ID
 * and its price can never drift apart again.
 *
 * ── OPUS PIN ─────────────────────────────────────────────────────────────────
 * Opus is DELIBERATELY pinned to the current best model, `claude-opus-4-8`
 * (claude-api skill / shared/models.md, 2026-06). 4.8 is the most capable GA
 * Claude — same request surface as 4.7, $5/$25 per 1M tokens, 1M context. Bump
 * `OPUS` below (and confirm aiCostRates has a matching price row) when a newer
 * Opus ships; everything downstream follows.
 *
 * IDs are OpenRouter-style (`anthropic/…`, `openai/…`, `deepseek/…`) because all
 * traffic routes through OpenRouter's OpenAI-compatible endpoint. They MUST stay
 * in lock-step with the keys in `aiCostRates.AI_COST_RATES`.
 */

import { AI_COST_RATES, getRate, type AICostRate } from "./aiCostRates";

// ── Canonical model IDs (OpenRouter ids) ─────────────────────────────────────
// Current generation, per the claude-api skill (2026-06):
//   Opus 4.8   — most capable; highest-stakes reasoning            $5 / $25
//   Sonnet 4.6 — complex analysis / grounded synthesis            $3 / $15
//   Haiku 4.5  — short lookups / restatement / formatting   (OpenRouter $0.80/$4)
// Bare Anthropic-SDK ids (no `anthropic/` prefix) for the call sites that hit
// the Anthropic API directly instead of OpenRouter (the Solene dispatch
// runner, the pre-call constitutional checker).
//
// THESE ARE A DIFFERENT NAMESPACE FROM `MODELS` AND MUST NOT BE DERIVED FROM
// EACH OTHER. They used to be: `MODELS.*` were built as
// `` `anthropic/${ANTHROPIC_MODELS.*}` `` under a comment claiming the two sets
// were "kept in LOCKSTEP by construction". They are not the same names, in two
// independent ways — measured against the live catalogue on 2026-08-19
// (415 models, 28 of them Anthropic):
//
//   1. VERSIONS ARE DOTTED, NOT HYPHENATED. The catalogue has 18 dotted
//      Anthropic ids (`claude-opus-4.8`) and ZERO hyphenated ones
//      (`claude-opus-4-8`). All three derived ids had the hyphenated form.
//   2. SLUGS ARE UNDATED. Anthropic's own API pins a dated id for Haiku
//      (`claude-haiku-4-5-20251001`); no catalogue slug carries a date, and
//      `anthropic/claude-haiku-4-5-20251001` 404s outright.
//
// Honest limit on this claim: the ids below are the catalogue's CANONICAL
// strings, verified present. Whether the old hyphenated forms would also have
// been accepted by the completions endpoint could not be tested here — that
// needs a provider API key, and inventing one to find out is not available.
// `/models/{id}/endpoints` does normalise `-4-5` to `-4.5`, which is very
// likely why this survived unnoticed; the dated form is unambiguously broken
// either way. Pinning the canonical strings is the conservative choice: if
// normalisation exists it is a no-op, and if it does not, this is the fix.
export const ANTHROPIC_MODELS = {
  OPUS: "claude-opus-4-8",
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export const MODELS = {
  /** Tier 4 — highest-stakes reasoning. Pinned to the current best Opus. */
  OPUS: "anthropic/claude-opus-4.8",
  /** Tier 3 — complex analysis, deal decisions, grounded synthesis. */
  SONNET: "anthropic/claude-sonnet-4.6",
  /** Tier 2 — balanced reasoning / extraction / restatement. */
  HAIKU: "anthropic/claude-haiku-4.5",
  /** Tier 1 — cheapest micro/templated tasks. */
  DEEPSEEK_CHAT: "deepseek/deepseek-chat",
  /**
   * Tier 3R — step-by-step reasoning for valuation/financial models.
   *
   * Was `deepseek/deepseek-reasoner`, which is DeepSeek's own API name and does
   * not exist on OpenRouter (404). The catalogue's reasoning slug is
   * `deepseek/deepseek-r1`.
   */
  DEEPSEEK_REASONER: "deepseek/deepseek-r1",
  /** Tier V — vision/document parsing. */
  VISION: "openai/gpt-4o",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * ── THE SAME MODEL HAS TWO NAMES ────────────────────────────────────────────
 *
 * OpenAI serves `gpt-4o`. OpenRouter serves `openai/gpt-4o` and 404s on the
 * bare form — measured 2026-08-19: `gpt-4o` and `gpt-4o-mini` are absent from
 * the 415-model catalogue AND 404 on `/models/{id}/endpoints`, which normalises
 * hyphens to dots but does not supply a missing author prefix.
 *
 * Almost everything in this codebase therefore wants the PREFIXED form,
 * because `utils/openaiClient.ts` — despite being named `getOpenAIClient` —
 * returns an OpenRouter client and says so in its own docblock. Forty-four
 * call sites across twenty-two files sent the bare id to it and 404'd.
 *
 * Two services are the exception. `ai/vaService.ts` and
 * `services/supportBrain.ts` build their own client from
 * `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`, and
 * that base URL has NO DEFAULT — so which provider they reach, and therefore
 * which of the two names is correct, is decided by a secret this repository
 * cannot read. It is not hypothetical that the secret moves:
 * `docs/runbooks/ai-quota-exceeded.md` instructs the operator to point it at
 * OpenRouter during a quota incident, which would silently 404 every call in
 * both services at the exact moment someone is trying to restore service.
 *
 * So the id follows the client rather than being guessed. Unknown hosts
 * resolve to the BARE name: the env var is documented as
 * `https://api.openai.com/v1`, an OpenAI-compatible proxy in front of OpenAI
 * takes OpenAI's names, and OpenRouter is the one host in this system that
 * does not.
 */
export const OPENAI_DIRECT_MODELS = {
  GPT4O: "gpt-4o",
  GPT4O_MINI: "gpt-4o-mini",
} as const;

/** Which name a direct-OpenAI-shaped client should be given for `bareId`. */
export function openAiModelIdFor(
  baseURL: string | undefined,
  bareId: (typeof OPENAI_DIRECT_MODELS)[keyof typeof OPENAI_DIRECT_MODELS],
): string {
  return baseURL?.includes("openrouter.ai") ? `openai/${bareId}` : bareId;
}

/** Every model the platform can deliberately route to (for "known model" checks). */
export const KNOWN_MODELS: readonly string[] = Object.values(MODELS);

/**
 * True when `model` is one the platform deliberately routes to. Used by
 * `estimateCost` to refuse the silent generic fallback for models we own.
 */
export function isKnownModel(model: string): boolean {
  return KNOWN_MODELS.includes(model);
}

/**
 * Per-million-token price for a model, resolved through the centralized
 * `aiCostRates.AI_COST_RATES` table. Unknown models fall back to the
 * conservative `DEFAULT_RATE` there (never silently $0). This is the ONLY price
 * surface callers should use — there is no second cost table.
 */
export function priceFor(model: string): AICostRate {
  return getRate(model);
}

/**
 * Compile-time + run-time guard: every canonical model id above MUST have a
 * matching price row in aiCostRates. If a new model is added to MODELS without
 * a price, this throws at module load (server boot) rather than silently
 * undercounting its cost at request time.
 */
for (const id of KNOWN_MODELS) {
  if (!(id in AI_COST_RATES) && !(id.toLowerCase() in AI_COST_RATES)) {
    throw new Error(
      `[models] '${id}' has no price row in aiCostRates.AI_COST_RATES — ` +
        `add one so cost estimates never silently fall back to DEFAULT_RATE.`,
    );
  }
}
