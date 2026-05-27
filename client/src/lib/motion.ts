/**
 * Legacy motion vocabulary — kept as a thin compatibility shim that
 * re-exports the canonical tokens from `motion-tokens.ts`.
 *
 * The canonical source of truth is `client/src/lib/motion-tokens.ts`.
 * Do not add new constants here — extend `motion-tokens.ts` instead.
 * Existing imports `from "@/lib/motion"` keep working so we can migrate
 * call sites in a follow-up pass without breaking the founder-chat
 * surfaces that depend on `SPRING_INTERACTIVE`, `SPRING_SOFT`,
 * `REVEAL_FROM_BELOW`, `CROSS_FADE`, etc.
 *
 * Wave-3 design-tokens lock: any spring conflict between the two files
 * resolved to the Apple-HIG-aligned value (see motion-tokens.ts header).
 */
import { DURATIONS, EASINGS, SPRINGS, MOTION, SCALES } from "@/lib/motion-tokens";

// ─── Easings ──────────────────────────────────────────────────────────────
// `stripeStandard` IS Apple's cubic-bezier(0.4, 0, 0.2, 1) — the same curve
// the rest of the system already calls "standard."
export const EASING_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
export const EASING_DECELERATE = "cubic-bezier(0, 0, 0.2, 1)";
export const EASING_ACCELERATE = "cubic-bezier(0.4, 0, 1, 1)";

// ─── Durations (ms + composed strings) ────────────────────────────────────
// Derived from `DURATIONS` (seconds) in motion-tokens to keep the two
// vocabularies in lockstep.
export const DURATION_FAST_MS = Math.round(DURATIONS.fast * 1000);     // 150
export const DURATION_DEFAULT_MS = Math.round(DURATIONS.normal * 1000); // 250
export const DURATION_SLOW_MS = Math.round(DURATIONS.slow * 1000);     // 350

export const DURATION_FAST = `${DURATION_FAST_MS}ms`;
export const DURATION_DEFAULT = `${DURATION_DEFAULT_MS}ms`;
export const DURATION_SLOW = `${DURATION_SLOW_MS}ms`;

export const TRANSITION_FAST = `${DURATION_FAST} ${EASING_STANDARD}`;
export const TRANSITION_DEFAULT = `${DURATION_DEFAULT} ${EASING_STANDARD}`;
export const TRANSITION_SLOW = `${DURATION_SLOW} ${EASING_STANDARD}`;

// ─── Springs ──────────────────────────────────────────────────────────────
// Legacy aliases now point at the canonical SPRINGS map. SPRING_SNAPPY was
// the conflict-flagged constant (500/30 vs 320/30); Apple-HIG-leaning
// 320/30 won, and lives in SPRINGS.snappy.
export const SPRING_INTERACTIVE = SPRINGS.interactive;
export const SPRING_SOFT = SPRINGS.soft;
export const SPRING_SNAPPY = SPRINGS.snappy;

// ─── Framer-Motion variants ──────────────────────────────────────────────
// Cubic-bezier arrays mirror EASINGS.stripeStandard / EASINGS.smoothOut.
const STANDARD = EASINGS.stripeStandard;
const ACCEL: [number, number, number, number] = [0.4, 0, 1, 1];

export const REVEAL_FROM_BELOW = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATIONS.normal, ease: STANDARD } },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: DURATIONS.fast, ease: ACCEL } },
};

export const REVEAL_FROM_SCALE = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: DURATIONS.normal, ease: STANDARD } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DURATIONS.fast, ease: ACCEL } },
};

export const CROSS_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATIONS.normal, ease: STANDARD } },
  exit: { opacity: 0, transition: { duration: DURATIONS.fast, ease: ACCEL } },
};

// ─── Micro-interactions ──────────────────────────────────────────────────
export const TAP_PRESS = { scale: SCALES.buttonTap };

/** Apple iMessage typing-indicator cadence. 600ms total cycle. */
export const THINKING_DOT_INTERVAL_MS = 600;

// Re-export the canonical map so call sites can `import { SPRINGS } from
// "@/lib/motion"` if they want — but new code should import directly
// from `motion-tokens.ts`.
export { SPRINGS, DURATIONS, EASINGS, MOTION, SCALES };
