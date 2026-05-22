/**
 * Canonical motion system for AcreOS — the elite-Apple-developer bar
 * from the founder-chat plan.
 *
 * Every Atlas-side component imports timing + easing from here. Never
 * library defaults, never one-off easings. One canonical curve, three
 * durations, three spring presets. The system is small on purpose —
 * the goal is consistency, not richness.
 *
 * Pair with client/src/lib/spacing.ts (4pt grid) and the existing
 * client/src/lib/animations.ts (stagger primitives) for the full set.
 */

/**
 * Apple's standard cubic-bezier — used everywhere in their HIG-compliant
 * animations. "Decelerate to a stop" feeling. Default for most
 * interactive transitions.
 */
export const EASING_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * For things entering the screen (modals, sheets, slide-ups). Starts
 * fast, decelerates as it arrives.
 */
export const EASING_DECELERATE = "cubic-bezier(0, 0, 0.2, 1)";

/**
 * For things leaving (dismissals, exits). Starts slow, accelerates out.
 */
export const EASING_ACCELERATE = "cubic-bezier(0.4, 0, 1, 1)";

/**
 * Timing tiers. Choose by gesture cost — a press-down is fast (snap),
 * an artifact reveal is default, a sheet open is slow.
 */
export const DURATION_FAST_MS = 200;
export const DURATION_DEFAULT_MS = 300;
export const DURATION_SLOW_MS = 400;

export const DURATION_FAST = `${DURATION_FAST_MS}ms`;
export const DURATION_DEFAULT = `${DURATION_DEFAULT_MS}ms`;
export const DURATION_SLOW = `${DURATION_SLOW_MS}ms`;

/**
 * Composed transition strings — drop directly into `style.transition`
 * or `className="transition-[property] duration-200 ease-..."`.
 */
export const TRANSITION_FAST = `${DURATION_FAST} ${EASING_STANDARD}`;
export const TRANSITION_DEFAULT = `${DURATION_DEFAULT} ${EASING_STANDARD}`;
export const TRANSITION_SLOW = `${DURATION_SLOW} ${EASING_STANDARD}`;

/**
 * Framer-Motion spring presets (already a dependency via
 * vendor-motion). One canonical set; if you reach for a different
 * stiffness/damping, ask first.
 */
export const SPRING_INTERACTIVE = { type: "spring" as const, stiffness: 220, damping: 26 };
export const SPRING_SOFT = { type: "spring" as const, stiffness: 140, damping: 22 };
export const SPRING_SNAPPY = { type: "spring" as const, stiffness: 320, damping: 30 };

/**
 * Common Framer-Motion variants. Apply to motion.div, motion.button,
 * etc. Composes opacity + scale + position so every reveal feels
 * spatial, not just a fade.
 */
export const REVEAL_FROM_BELOW = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION_DEFAULT_MS / 1000, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: DURATION_FAST_MS / 1000, ease: [0.4, 0, 1, 1] } },
};

export const REVEAL_FROM_SCALE = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: DURATION_DEFAULT_MS / 1000, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DURATION_FAST_MS / 1000, ease: [0.4, 0, 1, 1] } },
};

export const CROSS_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION_DEFAULT_MS / 1000, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST_MS / 1000, ease: [0.4, 0, 1, 1] } },
};

/**
 * Tactile press-down — apply via whileTap on motion components, or via
 * the `data-pressed` selector for non-motion buttons (paired with a
 * 50ms CSS transition).
 */
export const TAP_PRESS = { scale: 0.97 };

/**
 * For the ambient three-dot "Atlas is thinking" indicator. Each dot
 * pulses opacity at 0.4 Hz, staggered. Apple's iMessage typing
 * indicator is the reference.
 */
export const THINKING_DOT_INTERVAL_MS = 600;  // total cycle
