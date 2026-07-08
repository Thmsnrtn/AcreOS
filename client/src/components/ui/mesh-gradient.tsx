import * as React from "react";
import { cn } from "@/lib/utils";

interface MeshGradientProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Blend a third orb in an accent hue (default: false).
   * Useful for hero/splash areas.
   */
  accent?: boolean;
  /**
   * Slow down animations for decorative backgrounds (default: "normal").
   * "slow"   → 20s / 28s / 22s
   * "normal" → 14s / 18s / 16s
   * "fast"   → 8s  / 10s / 9s
   */
  speed?: "slow" | "normal" | "fast";
}

const DURATIONS = {
  slow:   [20, 28, 22],
  normal: [14, 18, 16],
  fast:   [8,  10,  9],
};

/**
 * MeshGradient — macOS Tahoe-style animated aurora/mesh gradient background.
 *
 * Wrap any section in this component to get three softly drifting colour orbs
 * that create the characteristic Tahoe depth-bloom effect.
 *
 * Usage:
 *   <MeshGradient className="rounded-2xl p-8">…content…</MeshGradient>
 *   <MeshGradient accent speed="slow" className="min-h-screen">…</MeshGradient>
 */
export function MeshGradient({
  className,
  children,
  accent = false,
  speed = "normal",
  style,
  ...props
}: MeshGradientProps) {
  const [d1, d2, d3] = DURATIONS[speed];

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={style}
      {...props}
    >
      {/* Orb 1 — primary hue, top-left */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1/4 -left-[10%] h-[65%] w-[65%] rounded-full
                   bg-[hsl(var(--primary)/0.13)] blur-[90px]
                   dark:bg-[hsl(var(--primary)/0.18)]"
        style={{ animation: `meshShift1 ${d1}s ease-in-out infinite` }}
      />

      {/* Orb 2 — accent hue, bottom-right */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[15%] -right-[5%] h-[55%] w-[55%] rounded-full
                   bg-[hsl(var(--accent)/0.10)] blur-[80px]
                   dark:bg-[hsl(var(--accent)/0.14)]"
        style={{ animation: `meshShift2 ${d2}s ease-in-out infinite` }}
      />

      {/* Orb 3 — warm tint, centre — optional */}
      {accent && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[30%] left-[35%] h-[45%] w-[45%] rounded-full
                     bg-[hsl(var(--primary)/0.07)] blur-[100px]
                     dark:bg-[hsl(var(--primary)/0.10)]"
          style={{ animation: `meshShift3 ${d3}s ease-in-out infinite` }}
        />
      )}

      {/* Content sits above the orbs */}
      <div className="relative z-docked">{children}</div>
    </div>
  );
}
