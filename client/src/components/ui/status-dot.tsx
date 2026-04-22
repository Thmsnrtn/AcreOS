import * as React from "react";
import { cn } from "@/lib/utils";

type StatusTone = "green" | "amber" | "red" | "blue" | "gray" | "purple";

interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** "sm" = 6px, "md" = 8px (default), "lg" = 10px. */
  size?: "sm" | "md" | "lg";
  /** Pulse the dot (for "live" / "active" semantics). */
  pulse?: boolean;
  /** Visible text paired with the dot. */
  label?: React.ReactNode;
  /** Accessible label when there is no visible text. */
  srLabel?: string;
}

const TONE_CLASS: Record<StatusTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  blue: "bg-sky-500",
  gray: "bg-muted-foreground/50",
  purple: "bg-violet-500",
};

const SIZE_CLASS = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-2.5 w-2.5",
} as const;

/**
 * Canonical status indicator. One set of semantic tones, one dot
 * geometry. Replaces per-component inline `<span className="bg-green-500 rounded-full" />`
 * sprinkled across the app.
 *
 *   <StatusDot tone="green" label="Live" />
 *   <StatusDot tone="amber" pulse srLabel="Warming up" />
 */
export function StatusDot({
  tone,
  size = "md",
  pulse = false,
  label,
  srLabel,
  className,
  ...rest
}: StatusDotProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 align-middle", className)}
      {...rest}
    >
      <span className="relative inline-flex shrink-0">
        {pulse && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-60",
              TONE_CLASS[tone],
            )}
          />
        )}
        <span
          className={cn("relative rounded-full", TONE_CLASS[tone], SIZE_CLASS[size])}
        />
      </span>
      {label != null ? (
        <span className="text-xs font-medium">{label}</span>
      ) : srLabel ? (
        <span className="sr-only">{srLabel}</span>
      ) : null}
    </span>
  );
}
