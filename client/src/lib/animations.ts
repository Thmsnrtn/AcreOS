import type { Variants, Transition } from "framer-motion";
import {
  DURATIONS,
  EASINGS,
  SPRINGS,
  SCALES,
  variantPageFade,
  variantModalContent,
} from "@/lib/motion-tokens";

// All durations / easings / springs / scales below come from motion-tokens.ts.
// If you need a value that doesn't exist there, ADD IT there — do not inline a
// new magic number here.

export const quickSpring: Transition = SPRINGS.snappy;

export const smoothSpring: Transition = SPRINGS.smooth;

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATIONS.fast },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATIONS.fast },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATIONS.normal, ease: EASINGS.out },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATIONS.fast, ease: EASINGS.out },
  },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATIONS.normal, ease: EASINGS.smoothOut },
  },
  exit: {
    opacity: 0,
    y: 16,
    transition: { duration: DURATIONS.fast, ease: EASINGS.smoothOut },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: SCALES.modalEnter },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATIONS.fast, ease: EASINGS.out },
  },
  exit: {
    opacity: 0,
    scale: SCALES.modalEnter,
    transition: { duration: DURATIONS.fast, ease: EASINGS.out },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATIONS.normal, ease: EASINGS.out },
  },
};

// Page-route transition. Backed by motion-tokens' variantPageFade — re-exported
// here so existing imports of `pageTransition` from "@/lib/animations" keep
// working unchanged.
export const pageTransition: Variants = variantPageFade;

export const modalOverlay: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATIONS.fast },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATIONS.fast },
  },
};

export const modalContent: Variants = variantModalContent;

export const cardHover = {
  scale: SCALES.cardHover,
  transition: SPRINGS.snappy,
};

export const buttonTap = {
  scale: SCALES.buttonTap,
  transition: SPRINGS.snappy,
};

export const dropdownStagger: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.05,
    },
  },
};

export const dropdownItem: Variants = {
  hidden: { opacity: 0, x: -4 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATIONS.fast },
  },
};

export const collapsibleContent: Variants = {
  hidden: {
    opacity: 0,
    height: 0,
    transition: { duration: DURATIONS.fast },
  },
  visible: {
    opacity: 1,
    height: "auto",
    transition: { duration: DURATIONS.normal, ease: EASINGS.out },
  },
};

export const pulseAnimation = {
  opacity: [0.5, 0.8, 0.5],
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: EASINGS.inOut,
  },
};

// ─── Shared-element nav active indicator ───────────────────────────────────
// A single Framer Motion `layoutId` lets the active-state pill animate
// (slide + resize) from the previously-active nav item to the newly-active
// one as the route changes, instead of cross-fading in place. Each nav
// surface (desktop sidebar, mobile bottom navs, founder bottom nav) gets its
// OWN id so the indicator never tries to fly BETWEEN surfaces (e.g. from the
// sidebar to the bottom nav on a viewport change).
export const NAV_INDICATOR_LAYOUT_IDS = {
  customerSidebar: "nav-indicator-customer-sidebar",
  founderSidebar: "nav-indicator-founder-sidebar",
  customerBottomNav: "nav-indicator-customer-bottom",
  founderBottomNav: "nav-indicator-founder-bottom",
} as const;

// Spring for the sliding indicator. `smooth` lands softly without overshoot
// that would read as bouncy on a small pill traveling a short distance.
export const navIndicatorSpring: Transition = SPRINGS.smooth;
