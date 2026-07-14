/**
 * SOLENE — cognition throttle (Horizon A4: economic self-awareness).
 *
 * Two PURE functions the dispatch queue consults at enqueue time:
 *
 *   evPriority(score, sourceType)
 *     Map a token-economy score (tokenEconomyScorer, 0..1) onto the queue's
 *     priority column. Advisory only — expected value shapes WHERE work sits
 *     in the queue, never WHETHER it runs.
 *
 *   throttleForEnvelope(envelopeStatus, sourceType)
 *     Graduated deprioritization as spend approaches the monthly envelope:
 *     the lowest-expected-value categories step back FIRST, while the hard
 *     ensemble cap (capitalTracker.assertWithinEnsembleCap) remains the one
 *     and only actual stop. This throttle runs IN ADDITION TO — strictly
 *     after — the cap assertion, never instead of it, and it only ever
 *     DEFERS or DEPRIORITIZES work; it never drops it.
 *
 * SAFETY INVARIANT — the exempt list. Verification dispatches are safety
 * machinery, and founder-initiated work is the founder speaking; neither is
 * ever deprioritized, deferred, or re-scored, under any envelope pressure.
 * The exemption is structural (one shared constant consulted by BOTH
 * functions) and pinned by tests, not a convention.
 *
 * Both functions are pure + total (no DB, no clock, no env) so the whole
 * decision matrix is exhaustively unit-testable.
 */

import { DECISION_SCORE_THRESHOLDS } from "@shared/schema/solene-token-economy";

// ----------------------------------------------------------------------------
// Category taxonomy (mirrors DISPATCH_SOURCE_TYPES in
// shared/schema/solene-dispatch.ts — kept as string sets so the functions stay
// pure and total on unknown inputs).
// ----------------------------------------------------------------------------

/**
 * NEVER throttled, NEVER EV-repriced:
 *   verify         — verification is safety machinery; starving it under
 *                    spend pressure is exactly backwards.
 *   founder_manual — the founder asked for this directly.
 *   founder_bypass — the founder invoked an agent with full authority.
 *   letter_reply   — a confirmed founder directive from a Letter reply.
 */
export const EV_EXEMPT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "verify",
  "founder_manual",
  "founder_bypass",
  "letter_reply",
]);

/**
 * Internal machinery — improves the machine, ships nothing outward (same set
 * tickMetric excludes from metric (a)). First to step back under envelope
 * pressure: a month of skipped self-review is recoverable; a blown envelope
 * is not.
 */
export const INTERNAL_MACHINERY_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "code_review",
  "self_debug",
  "adversarial_test",
]);

/**
 * Background autonomous work — valuable but self-initiated, so under a RED
 * envelope it yields queue position to everything else (priority pinned to
 * the floor; still enqueued and still runnable).
 */
export const BACKGROUND_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "auto_dispatch",
  "detector",
  "self_audit_drift",
]);

// ----------------------------------------------------------------------------
// evPriority — score → queue priority.
// ----------------------------------------------------------------------------

/** The queue's default priority when nobody has an opinion. */
export const DEFAULT_DISPATCH_PRIORITY = 1.0;
/** EV-derived priority bounds. The floor keeps low-EV work claimable (never
 *  starved to zero); the ceiling can never outrank founder work (3.0). */
export const EV_PRIORITY_MIN = 0.2;
export const EV_PRIORITY_MAX = 3.0;

/**
 * Map a token-economy score onto a queue priority.
 *
 * THE MAPPING: priority = clamp(score / proceedThreshold, 0.2, 3.0).
 *   - A score AT the proceed threshold (0.6) maps to exactly the default
 *     priority 1.0 — "worth doing" work is neither boosted nor penalized.
 *   - A saturated score of 1.0 maps to ~1.67 — clearly-high-EV work claims
 *     ahead of default work but can never reach the founder band (3.0);
 *     the clamp ceiling exists purely as a hard bound.
 *   - A score of 0 maps to the 0.2 floor — lowest-EV work sorts last but
 *     remains claimable when the queue drains.
 *
 * EXEMPT source types and non-finite scores return `fallbackPriority`
 * unchanged (fail-open: a broken score must never move work around).
 */
export function evPriority(
  score: number,
  sourceType: string,
  fallbackPriority: number = DEFAULT_DISPATCH_PRIORITY,
): number {
  if (EV_EXEMPT_SOURCE_TYPES.has(sourceType)) return fallbackPriority;
  if (!Number.isFinite(score)) return fallbackPriority;
  const raw = score / DECISION_SCORE_THRESHOLDS.proceedAtOrAbove;
  const clamped = Math.min(EV_PRIORITY_MAX, Math.max(EV_PRIORITY_MIN, raw));
  return Math.round(clamped * 1000) / 1000; // numeric(8,3) column precision
}

// ----------------------------------------------------------------------------
// throttleForEnvelope — graduated deprioritization BEFORE the hard cap.
// ----------------------------------------------------------------------------

/** Amber: internal machinery waits 6 hours (deferred, visible, never dropped). */
export const AMBER_INTERNAL_DEFER_MS = 6 * 60 * 60 * 1000;
/** Red: internal machinery waits 24 hours. */
export const RED_INTERNAL_DEFER_MS = 24 * 60 * 60 * 1000;
/** Red: background autonomous work is pinned to the priority floor. */
export const RED_BACKGROUND_MAX_PRIORITY = EV_PRIORITY_MIN;

export interface ThrottleDecision {
  /** 'defer' pushes not_before_at by deferMs; 'normal' leaves timing alone. */
  action: "normal" | "defer";
  /** How far to push not_before_at when action === 'defer'; 0 otherwise. */
  deferMs: number;
  /** Upper bound to apply to the row's priority (Math.min); null = untouched. */
  maxPriority: number | null;
  /** Plain-language justification, logged with every throttle decision. */
  reason: string;
}

const NORMAL = (reason: string): ThrottleDecision => ({
  action: "normal",
  deferMs: 0,
  maxPriority: null,
  reason,
});

/**
 * The graduated-brake decision matrix. Pure.
 *
 *   green — nothing throttles.
 *   amber — internal machinery (code_review / self_debug / adversarial_test)
 *           defers +6h; everything else runs normally.
 *   red   — internal machinery defers +24h; background autonomous work
 *           (auto_dispatch / detector / self_audit_drift) is pinned to the
 *           0.2 priority floor. STILL ENQUEUED — the existing hard ensemble
 *           cap remains the actual stop.
 *   exempt (verify / founder_manual / founder_bypass / letter_reply) —
 *           never throttled at any envelope status.
 */
export function throttleForEnvelope(
  envelopeStatus: "green" | "amber" | "red",
  sourceType: string,
): ThrottleDecision {
  if (EV_EXEMPT_SOURCE_TYPES.has(sourceType)) {
    return NORMAL(`${sourceType} is exempt — verification/founder work is never throttled`);
  }
  if (envelopeStatus === "green") {
    return NORMAL("envelope green — no throttle");
  }

  const internal = INTERNAL_MACHINERY_SOURCE_TYPES.has(sourceType);

  if (envelopeStatus === "amber") {
    if (internal) {
      return {
        action: "defer",
        deferMs: AMBER_INTERNAL_DEFER_MS,
        maxPriority: null,
        reason: `envelope amber — internal machinery (${sourceType}) deferred 6h; outward work unaffected`,
      };
    }
    return NORMAL(`envelope amber — ${sourceType} is outward-facing, not throttled at amber`);
  }

  // red
  if (internal) {
    return {
      action: "defer",
      deferMs: RED_INTERNAL_DEFER_MS,
      maxPriority: null,
      reason: `envelope red — internal machinery (${sourceType}) deferred 24h; the hard cap remains the actual stop`,
    };
  }
  if (BACKGROUND_SOURCE_TYPES.has(sourceType)) {
    return {
      action: "normal",
      deferMs: 0,
      maxPriority: RED_BACKGROUND_MAX_PRIORITY,
      reason: `envelope red — background work (${sourceType}) pinned to the ${RED_BACKGROUND_MAX_PRIORITY} priority floor; still enqueued`,
    };
  }
  return NORMAL(`envelope red — ${sourceType} is neither internal machinery nor background; not throttled`);
}
