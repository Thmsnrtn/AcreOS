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
export const MODELS = {
  /** Tier 4 — highest-stakes reasoning. Pinned to the current best Opus. */
  OPUS: "anthropic/claude-opus-4-8",
  /** Tier 3 — complex analysis, deal decisions, grounded synthesis. */
  SONNET: "anthropic/claude-sonnet-4-6",
  /** Tier 2 — balanced reasoning / extraction / restatement. */
  HAIKU: "anthropic/claude-haiku-4-5-20251001",
  /** Tier 1 — cheapest micro/templated tasks. */
  DEEPSEEK_CHAT: "deepseek/deepseek-chat",
  /** Tier 3R — step-by-step reasoning for valuation/financial models. */
  DEEPSEEK_REASONER: "deepseek/deepseek-reasoner",
  /** Tier V — vision/document parsing. */
  VISION: "openai/gpt-4o",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

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
