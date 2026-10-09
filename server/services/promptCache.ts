/**
 * Prompt-cache constants shared by every metered model path. A leaf module on
 * purpose (no imports), so the gateway can depend on it without pulling the
 * model/price tables into modules that mock them.
 */

/**
 * Minimum system-prompt length (chars) at which a metered call stamps an
 * Anthropic `cache_control` breakpoint. Below a model's real minimum cacheable
 * prefix (~2048 tokens Sonnet 4.6, ~4096 Opus 4.8 / Haiku 4.5) the stamp is a
 * harmless no-op — no error, no charge — so a low uniform threshold beats a gate
 * that sometimes skips a large stable prompt (2026-07-14 cost audit). Shared by
 * aiRouter.routeAITask and aiSpendGuard's metered raw-call path.
 */
export const ANTHROPIC_CACHE_MIN_CHARS = 1024;

