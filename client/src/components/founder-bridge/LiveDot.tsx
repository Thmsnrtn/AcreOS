/**
 * LiveDot — single 6px amber dot with a 1.5s breathing animation.
 *
 * Use sparingly. One per screen, normally. Indicates "this surface is
 * receiving live data" — appears next to the "last sync" line on the
 * agents tile, and in the Bridge header when an SSE stream is active.
 *
 * Reduced-motion users see a static (non-pulsing) dot.
 */
import { cn } from "@/lib/utils";
import { BRIDGE_ACCENT } from "./tokens";

export interface LiveDotProps {
  /** Aria-label so the dot is announced as a status indicator. */
  label?: string;
  className?: string;
}

export function LiveDot({ label = "Live", className }: LiveDotProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        // Breathing animation — opacity 0.5 ↔ 1.0 over 1.5s.
        "animate-bridge-breathe motion-reduce:animate-none",
        className,
      )}
      style={{ backgroundColor: BRIDGE_ACCENT }}
    />
  );
}
