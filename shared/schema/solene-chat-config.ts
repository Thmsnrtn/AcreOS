// ============================================================================
// SHARED/SCHEMA/SOLENE-CHAT-CONFIG.TS
// ----------------------------------------------------------------------------
// Phase 2 of the AcreOS-Solene migration: the chat backend.
//
// Constants + types only — no tables. Chat config (which models, what routes,
// what caps) lives in code so it's reviewable + versioned, with env-var
// overrides for per-deploy tuning.
//
// The four tiers map onto routing-decision rationale, not just raw cost:
//   - STRATEGIC      → final-answer-quality decisions (deploys, refactors)
//   - CONVERSATIONAL → most things; the default tier
//   - FAST           → classification, lookups, short replies
//   - CODE           → code-heavy work (deep reads, refactors)
//
// CLASSIFIER is a separate slot so the routing layer's cost stays bounded
// (a single FAST-tier call decides which tier the real query lands on).
// ============================================================================

// shared/ is bundled into the BROWSER too (barrel imports from client pages
// pull this module into lazy chunks). Bare `process.env` throws
// "process is not defined" at module evaluation in the browser — which
// blanked every founder page whose chunk included this file (2026-07-11
// founder report). Same guard pattern as shared/billing/tier-pricing.ts:
// env overrides apply on the server; browsers always get the defaults.
const env: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

export const CHAT_MODELS = {
  /**
   * Strategic / hard / final-answer-quality matters.
   * Pinned to the current best GA Opus (verified against the claude-api
   * skill 2026-07-08: claude-opus-4-8, $5/$25 per 1M — same price as the
   * stale 4.7 this previously pointed at). Keep in lockstep with
   * server/services/models.ts ANTHROPIC_MODELS.OPUS (shared/ can't import
   * server/, so the ID is duplicated by necessity).
   */
  STRATEGIC: env.SOLENE_CHAT_STRATEGIC_MODEL ?? "anthropic/claude-opus-4-8",
  /** Conversational / drafting / most things. */
  CONVERSATIONAL:
    env.SOLENE_CHAT_CONVERSATIONAL_MODEL ?? "anthropic/claude-sonnet-4-6",
  /** Classification / parsing / lookup. */
  FAST:
    env.SOLENE_CHAT_FAST_MODEL ?? "anthropic/claude-haiku-4-5-20251001",
  /** Code-heavy tasks (refactors, deep code reading). */
  CODE: env.SOLENE_CHAT_CODE_MODEL ?? "anthropic/claude-sonnet-4-6",
  /** Classifier — the cheap model that decides which tier to route to. */
  CLASSIFIER:
    env.SOLENE_CHAT_CLASSIFIER_MODEL ??
    "anthropic/claude-haiku-4-5-20251001",
} as const;

export const CHAT_TIERS = [
  "strategic",
  "conversational",
  "fast",
  "code",
] as const;
export type ChatTier = (typeof CHAT_TIERS)[number];

/**
 * Per-tier per-1M-token pricing (USD). Used for cost attribution + capital
 * tracker rollups. Defaults match Anthropic's published pricing; override
 * via env at deploy time when OpenRouter's markup differs.
 *
 * cachedInput is the discounted price for cache_read tokens (typically ~10%
 * of the standard input price for Anthropic prompt-caching).
 */
export const CHAT_PRICING_PER_M_TOKENS: Record<
  ChatTier,
  { input: number; output: number; cachedInput: number }
> = {
  // Corrected 2026-07-08 against the claude-api skill catalog: strategic
  // carried the OLD Opus price ($15/$75 vs the real $5/$25 — 3× over-
  // attribution that tripped the $1/turn cap early), and fast carried
  // Haiku-3.5-era pricing ($0.25/$1.25 vs Haiku 4.5's $1/$5 — 4× under-
  // counting). conversational/code (Sonnet 4.6 $3/$15) were correct.
  strategic: { input: 5, output: 25, cachedInput: 0.5 },
  conversational: { input: 3, output: 15, cachedInput: 0.3 },
  fast: { input: 1, output: 5, cachedInput: 0.1 },
  code: { input: 3, output: 15, cachedInput: 0.3 },
};

/** Max turns within a single runTurn invocation before hard-stop. */
export const CHAT_DEFAULT_MAX_TURNS = 20;

/**
 * Hard cost cap (USD) per runTurn invocation. Lowered from $5 → $1 by
 * the 2026-06-05 cost audit — at $5 a single chat conversation could
 * have driven the $30/day burn Tom saw. $1 still covers a 20-turn
 * Sonnet conversation with cache hits comfortably; an Opus turn that
 * doesn't fit is the audit signal worth seeing.
 */
export const CHAT_DEFAULT_COST_CAP_USD = 1;

/** Wall-clock timeout (ms) per runTurn invocation. */
export const CHAT_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default budget for the system-prompt context (tokens).
 *
 * 2026-06-05 cost audit: lowered from 30k → 18k. Trades richer always-loaded
 * context for faster cold-cache turns + cheaper cache-miss cost. Retrieval
 * can pull the remaining context lazily when the model actually needs it,
 * rather than pre-loading 12k tokens every turn "just in case." A cold-cache
 * Sonnet turn at 30k input was $0.09; at 18k it's $0.054 — a 40 percent
 * drop on every fresh conversation.
 */
export const CHAT_CONTEXT_TOKEN_BUDGET = 18_000;

/** How many prior messages to load per turn when reconstructing history. */
export const CHAT_HISTORY_MESSAGE_LIMIT = 20;

/** Max tokens the assistant may emit in a single response. */
export const CHAT_MAX_OUTPUT_TOKENS = 4096;

/** Public model lookup helper. */
export function modelForTier(tier: ChatTier): string {
  switch (tier) {
    case "strategic":
      return CHAT_MODELS.STRATEGIC;
    case "conversational":
      return CHAT_MODELS.CONVERSATIONAL;
    case "fast":
      return CHAT_MODELS.FAST;
    case "code":
      return CHAT_MODELS.CODE;
  }
}
