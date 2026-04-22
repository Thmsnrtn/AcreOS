import * as React from "react";
import { cn } from "@/lib/utils";

interface AnimatedCounterProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  value: number;
  /** Animation duration in ms. */
  duration?: number;
  /** Render the tweened value. Defaults to `Math.round(v).toLocaleString()`. */
  format?: (n: number) => string;
  /** Skip animation and snap to value — useful for SSR or reduced-motion. */
  instant?: boolean;
}

/**
 * Tweens a number from its previous value to the new one using
 * requestAnimationFrame. Respects `prefers-reduced-motion` automatically.
 * Use on KPI dashboards, live counters, and anywhere a number updating
 * feels better with a brief roll-up than a hard swap.
 */
export function AnimatedCounter({
  value,
  duration = 600,
  format,
  instant,
  className,
  ...rest
}: AnimatedCounterProps) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(value);
  const startRef = React.useRef<number | null>(null);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (instant || reduced) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    startRef.current = null;

    const step = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const elapsed = t - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, instant, reduced]);

  const text = (format ?? ((n: number) => Math.round(n).toLocaleString("en-US")))(display);

  return (
    <span className={cn("tabular-nums", className)} {...rest}>
      {text}
    </span>
  );
}
