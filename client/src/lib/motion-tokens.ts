/**
 * Rosy River A1 — Motion Tokens
 *
 * Single source of truth for every duration, easing curve, spring, and named
 * transition the app uses. The aim is the same as our color/typography tokens:
 * change one number here, watch every component move in sync.
 *
 * Why this exists
 * ───────────────
 * Linear and Stripe ship with a tight, coherent motion vocabulary — the same
 * curve, the same timing, the same "feel" across every surface. AcreOS had
 * the right Variants but inlined the magic numbers across 12 different files,
 * so things drifted. This module centralizes those decisions.
 *
 * How to consume
 * ──────────────
 *   import { DURATIONS, EASINGS, SPRINGS, MOTION } from "@/lib/motion-tokens";
 *
 *   <motion.div animate={{ opacity: 1 }} transition={MOTION.pageFade.transition} />
 *
 * For prefers-reduced-motion respect:
 *   import { useReducedMotionPreference } from "@/lib/motion-tokens";
 *   const reduced = useReducedMotionPreference();
 *   <motion.div transition={reduced ? MOTION.instant : MOTION.modalSpring} />
 *
 * If you need a one-off curve that doesn't exist here, ADD IT to the token
 * file and reference it — don't inline another magic number.
 */

import { useEffect, useState } from "react";
import type { Transition, Variants } from "framer-motion";

// ─── Durations (seconds) ──────────────────────────────────────────────────
// Five steps, geometric-ish progression. Anything tighter than 0.10 is felt
// as instantaneous; anything past 0.45 starts to feel sluggish on hover/tap.
export const DURATIONS = {
  /** Sub-perceptual — use for instant-feedback states like button tap. */
  instant: 0.08,
  /** Default for micro-interactions: hover, dropdown reveal, toast slide. */
  fast: 0.15,
  /** Default for content transitions: page fade, list stagger, card mount. */
  normal: 0.25,
  /** Default for spatial transitions: modal open, sheet push. */
  slow: 0.35,
  /** Reserved for deliberate emphasis — onboarding reveals, hero entry. */
  slower: 0.5,
} as const;

// ─── Easings ──────────────────────────────────────────────────────────────
// `linearExpo` and `stripeStandard` are the production-grade curves used by
// Linear and Stripe respectively. We default to `linearExpo` for "feels snappy
// but lands softly" — best for content surfaces. `stripeStandard` is used
// where Material-style symmetry is right (modals, drawers).
export const EASINGS = {
  /** Linear's signature expo-out. Snappy start, soft landing. */
  linearExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** Stripe's symmetric ease-in-out. */
  stripeStandard: [0.4, 0, 0.2, 1] as [number, number, number, number],
  /** Smooth out, used by our legacy slideUp/modalContent variants. */
  smoothOut: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
  /** Cubic-bezier "anticipate" — slight overshoot for delight on success. */
  anticipate: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  /** Aliases for common framer-motion string easings. */
  out: "easeOut" as const,
  inOut: "easeInOut" as const,
  linear: "linear" as const,
} as const;

// ─── Springs ──────────────────────────────────────────────────────────────
// Stiffness/damping pairs tuned for specific feels. Use these instead of
// hand-rolling spring configs in component code.
// Apple-HIG-aligned stiffness/damping pairs. The Apple "snappy" spring
// targets a response of ~0.3s with near-critical damping (ratio ≈ 0.85);
// stiffness 320 / damping 30 lands closer to that than the previous
// underdamped 500/30 pair. If you change these, change the prose
// in `client/src/lib/motion.ts` re-exports as well.
export const SPRINGS = {
  /** Snappy — for button taps, card hover, drag-end snap. */
  snappy: { type: "spring", stiffness: 320, damping: 30 } as Transition,
  /** Smooth — for modal/sheet entry, layout shifts. */
  smooth: { type: "spring", stiffness: 300, damping: 25 } as Transition,
  /** Gentle — for accordion panels, smooth scroll, soft reveals. */
  gentle: { type: "spring", stiffness: 200, damping: 22 } as Transition,
  /** Bouncy — for celebration moments (deal closed, milestone hit). */
  bouncy: { type: "spring", stiffness: 400, damping: 12 } as Transition,
  /** Interactive — Apple-HIG button/control press response. Legacy alias
   *  for the chat surfaces that consumed `SPRING_INTERACTIVE`. */
  interactive: { type: "spring", stiffness: 220, damping: 26 } as Transition,
  /** Soft — chat composer / artifact reveal cadence. Legacy alias for
   *  `SPRING_SOFT` from the chat motion vocabulary. */
  soft: { type: "spring", stiffness: 140, damping: 22 } as Transition,
} as const;

// ─── Scales ───────────────────────────────────────────────────────────────
// Named pixel/scale deltas. Centralizing means a hover that feels "right" on
// a button feels right on a card, too.
export const SCALES = {
  cardHover: 1.02,
  cardActive: 0.98,
  buttonTap: 0.97,
  modalEnter: 0.95,
  popoverEnter: 0.98,
} as const;

// ─── Named transitions ───────────────────────────────────────────────────
// "MOTION.x" gives every component a vocabulary it can speak. Variants are
// still defined in animations.ts (and consume these), but for one-off
// `transition={}` props, reach for one of these.
export const MOTION = {
  /** Zero-duration noop — use when prefers-reduced-motion is active. */
  instant: { duration: 0 } as Transition,

  /** Page route transitions — opacity + tiny x-slide. */
  pageFade: {
    transition: { duration: DURATIONS.normal, ease: EASINGS.linearExpo } as Transition,
  },

  /** Stagger children with a 50ms gap. */
  listStagger: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    } as Transition,
  },

  /** Modal open — sub-second, soft landing. */
  modalSpring: {
    transition: SPRINGS.smooth,
  },

  /** Toast in/out — sub-quarter-second slide. */
  toastSlide: {
    transition: { duration: DURATIONS.fast, ease: EASINGS.linearExpo } as Transition,
  },

  /** Success state pulse — three quick pulses, then settle. */
  successPulse: {
    transition: {
      duration: DURATIONS.slow * 3,
      ease: EASINGS.anticipate,
      times: [0, 0.3, 0.6, 1],
    } as Transition,
  },

  /** Card hover lift — snappy spring scale. */
  cardLift: {
    transition: SPRINGS.snappy,
  },

  /** Optimistic-update settle — page brightens momentarily on save. */
  settle: {
    transition: { duration: DURATIONS.fast, ease: EASINGS.smoothOut } as Transition,
  },
} as const;

// ─── prefers-reduced-motion utility ───────────────────────────────────────
// Returns true when the user's OS has prefers-reduced-motion: reduce set.
// Components that animate spatial movement (slides, scales, spring entrances)
// should wrap their transitions with this and fall back to MOTION.instant.
export function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Older Safari uses addListener / removeListener; modern uses addEventListener.
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return reduced;
}

/**
 * Helper: return the given transition, OR the instant noop if
 * prefers-reduced-motion is active. Use in framer-motion props:
 *
 *   const reduced = useReducedMotionPreference();
 *   <motion.div transition={respectReducedMotion(MOTION.modalSpring.transition, reduced)} />
 */
export function respectReducedMotion(t: Transition, reduced: boolean): Transition {
  return reduced ? MOTION.instant : t;
}

/**
 * Hook variant of `respectReducedMotion` — handles the media-query
 * subscription internally. Components animating spatial motion
 * (slides, scales, spring entrances) should call this and spread the
 * result onto their `transition` prop. When the OS reports
 * prefers-reduced-motion: reduce, every consumer collapses to a
 * zero-duration noop without further ceremony.
 *
 *   const transition = useRespectfulTransition(SPRINGS.smooth);
 *   <motion.div transition={transition} animate={{ y: 0 }} />
 */
export function useRespectfulTransition(t: Transition): Transition {
  const reduced = useReducedMotionPreference();
  return reduced ? MOTION.instant : t;
}

/**
 * Hook: rewrite a Variants map so every `transition` block becomes
 * the zero-duration instant noop when prefers-reduced-motion is on.
 *
 * Returns the original variants untouched when motion is allowed, so
 * there's no extra allocation in the common case.
 *
 *   const variants = useRespectfulVariants(REVEAL_FROM_BELOW);
 *   <motion.div variants={variants} initial="initial" animate="animate" />
 */
export function useRespectfulVariants(variants: Variants): Variants {
  const reduced = useReducedMotionPreference();
  if (!reduced) return variants;
  // Strip transitions + spatial deltas from each state so the change
  // applies instantly without scale/translate jumps mid-paint.
  const flattened: Variants = {};
  for (const key of Object.keys(variants)) {
    const value = variants[key];
    if (typeof value === "function") {
      flattened[key] = value;
      continue;
    }
    flattened[key] = { ...value, transition: { duration: 0 } };
  }
  return flattened;
}

// ─── Re-export the variant primitives that consume these tokens ─────────
// Keeping the same names + shapes as before so existing imports of
// `staggerContainer`, `staggerItem`, etc. from `@/lib/animations` continue
// to work unchanged. Anything new should prefer these typed Variants.

export const variantPageFade: Variants = {
  initial: { opacity: 0, x: 8 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATIONS.normal, ease: EASINGS.linearExpo },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: DURATIONS.fast, ease: EASINGS.linearExpo },
  },
};

/**
 * Mobile page transition — pure opacity cross-fade, no spatial translate.
 *
 * On a router with a persistent bottom-nav, the user's mental model is
 * "tab switch", not forward navigation. The desktop x-slide reads as
 * drift on mobile, not motion. This variant strips the x-translate
 * entirely and runs in DURATIONS.fast so taps land without lag.
 */
export const variantPageFadeMobile: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: DURATIONS.fast, ease: EASINGS.linearExpo },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATIONS.fast, ease: EASINGS.linearExpo },
  },
};

export const variantModalContent: Variants = {
  hidden: { opacity: 0, scale: SCALES.modalEnter, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: DURATIONS.normal, ease: EASINGS.smoothOut },
  },
  exit: {
    opacity: 0,
    scale: SCALES.modalEnter,
    y: 8,
    transition: { duration: DURATIONS.fast, ease: EASINGS.linearExpo },
  },
};
