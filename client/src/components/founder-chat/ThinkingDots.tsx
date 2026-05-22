/**
 * Ambient "Atlas is thinking" indicator — iMessage-style three dots
 * that pulse opacity in sequence. Replaces the generic spinner pattern.
 *
 * Per the elite-Apple-developer design language: no "Loading..." text,
 * no spinning loaders. Three dots, staggered, breathing.
 */

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASING_STANDARD } from "@/lib/motion";

interface ThinkingDotsProps {
  /** Visual size — controls dot diameter + gap. Defaults to "md". */
  size?: "sm" | "md";
  /** Optional class overrides for the wrapping div. */
  className?: string;
  "aria-label"?: string;
}

// Framer-motion can't parse the cubic-bezier string directly; supply
// the same curve as a number tuple.
const PULSE_EASE = [0.4, 0, 0.2, 1] as const;
const _easeRef = EASING_STANDARD; // keep import live for design-system traceability
void _easeRef;

export function ThinkingDots({
  size = "md",
  className,
  "aria-label": ariaLabel = "Atlas is thinking",
}: ThinkingDotsProps) {
  const dotPx = size === "sm" ? 4 : 6;
  const gapPx = size === "sm" ? 3 : 4;
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center", className)}
      style={{ gap: gapPx }}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="rounded-full bg-current"
          style={{ width: dotPx, height: dotPx }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: PULSE_EASE,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}
