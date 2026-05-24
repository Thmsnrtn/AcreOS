/**
 * BridgeSparkline — inline SVG sparkline.
 *
 * Stroke-only (no fill) so the sparkline reads as a *trace* not a
 * filled region. Last-point dot in amber, sized to glyph-x-height so
 * it doesn't compete with the headline number.
 *
 * Renders deterministic SVG path strings — no chart library, no
 * runtime layout. Aria-hidden because the numeric headline above it
 * is the accessible label; the sparkline is decorative.
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { BRIDGE_ACCENT } from "./tokens";

export interface BridgeSparklineProps {
  /** Numeric series, oldest → newest. ≥2 points required to draw. */
  values: number[];
  /** Render width in CSS px. */
  width?: number;
  /** Render height in CSS px. */
  height?: number;
  /** Stroke color for the trace. Defaults to a muted foreground. */
  stroke?: string;
  /** Override the last-point dot color (defaults to amber accent). */
  dotColor?: string;
  /** Hide the last-point dot entirely. */
  hideDot?: boolean;
  /** className passthrough. */
  className?: string;
}

export function BridgeSparkline({
  values,
  width = 120,
  height = 32,
  stroke,
  dotColor = BRIDGE_ACCENT,
  hideDot = false,
  className,
}: BridgeSparklineProps) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1; // avoid divide-by-zero on flat series
    const padY = 2; // breathing room so the stroke isn't clipped at the edges
    const usableH = height - padY * 2;
    const step = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * step;
      const y = padY + usableH - ((v - min) / range) * usableH;
      return { x, y };
    });
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const last = points[points.length - 1];
    return { d, last };
  }, [values, width, height]);

  if (!path) {
    return <div aria-hidden style={{ width, height }} className={className} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block", className)}
      aria-hidden="true"
    >
      <path
        d={path.d}
        fill="none"
        stroke={stroke ?? "currentColor"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={stroke ? 1 : 0.55}
      />
      {!hideDot && (
        <circle cx={path.last.x} cy={path.last.y} r={2.5} fill={dotColor} />
      )}
    </svg>
  );
}
