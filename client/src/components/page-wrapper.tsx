import React from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { pageTransition } from "@/lib/animations";
import { variantPageFadeMobile } from "@/lib/motion-tokens";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Route-transition wrapper shared by the customer shell (App.tsx) and the
 * founder shell (FounderApp.tsx) — it owns the `#main-content` landmark the
 * skip link targets.
 */
export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isMobile } = useIsMobile();
  // Mobile: opacity cross-fade only — the persistent bottom-nav makes
  // route changes feel like tab switches, not forward navigation, so
  // the x-translate reads as drift. Desktop keeps the existing fade+x.
  const variants = isMobile ? variantPageFadeMobile : pageTransition;

  return (
    // overflow-x-clip: the desktop variant's x-translate transiently pushes
    // the 100%-width page 8px past the viewport during every route change.
    // On desktop that's a scrollbar flicker; on mobile browsers it expands
    // the layout viewport at first paint (shrink-to-fit), which both zooms
    // the page below CSS-pixel scale and — at 744px (iPad mini) — pushes
    // innerWidth across the 768 breakpoint, flipping the app to the desktop
    // arm. Clip (not hidden — no new scroll container) keeps the slide
    // animation while the document never exceeds the viewport.
    <div className="overflow-x-clip">
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          // page-transition-layer: this motion.div wraps the ENTIRE app
          // (sidebar + topbar + main). AnimatePresence mode="wait" can strand
          // it at the exit state (opacity:0) when a route change interrupts
          // an in-flight transition — e.g. a full load of /pipeline that
          // redirects a beat later — leaving every user-visible pixel hidden
          // with the DOM fully intact (2026-07 production-gate finding). The
          // acr-render-rescue CSS rule (index.css) lands this layer back at
          // opacity 1 if it sits at exactly inline opacity:0 for >1s, which a
          // normal ~0.24s transition never does. Belt to the sentinel's
          // suspenders.
          className="min-h-[100dvh] page-transition-layer"
          id="main-content"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
