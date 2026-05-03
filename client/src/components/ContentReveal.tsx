import { ReactNode, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface ContentRevealProps {
  /**
   * When false, the skeleton is shown.
   * When true, the skeleton is held for at least `minDurationMs`,
   * then the children are crossfaded in.
   */
  ready: boolean;
  /** Skeleton placeholder to render while not ready (or during the min-hold). */
  skeleton: ReactNode;
  /** Real content to reveal once ready. */
  children: ReactNode;
  /**
   * Minimum time the skeleton stays on screen, in milliseconds.
   * Prevents flicker on fast networks. Default 200ms.
   */
  minDurationMs?: number;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

/**
 * ContentReveal — skeleton choreography wrapper.
 *
 * - Holds the skeleton at least `minDurationMs` (default 200ms) so users
 *   never see a sub-perceptual flash of skeleton when data is hot-cached.
 * - Crossfades to real content via framer-motion.
 * - Children animate in with the project's staggerContainer + staggerItem
 *   variants (per CLAUDE.md UI patterns).
 */
export function ContentReveal({
  ready,
  skeleton,
  children,
  minDurationMs = 200,
  className,
}: ContentRevealProps) {
  // Track the time at which this component mounted so we can enforce the
  // minimum skeleton-display duration even if data resolves instantly.
  const [showContent, setShowContent] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!ready) {
      setShowContent(false);
      return;
    }
    const elapsed = Date.now() - mountedAt;
    const remaining = Math.max(0, minDurationMs - elapsed);
    if (remaining === 0) {
      setShowContent(true);
      return;
    }
    const timer = window.setTimeout(() => setShowContent(true), remaining);
    return () => window.clearTimeout(timer);
  }, [ready, mountedAt, minDurationMs]);

  return (
    <div className={className} data-testid="content-reveal">
      <AnimatePresence mode="wait" initial={false}>
        {!showContent ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            data-testid="content-reveal-skeleton"
          >
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            exit="hidden"
            data-testid="content-reveal-content"
          >
            <motion.div variants={staggerItem}>{children}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ContentReveal;
