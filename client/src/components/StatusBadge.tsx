import * as React from "react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * Canonical status states understood by <StatusBadge>.
 *
 * Anything outside this set is rendered with a neutral tone — pass an arbitrary
 * string (e.g. a backend enum value) and you'll get a default gray badge with
 * the raw text as the label, which is still better than a hand-rolled pill.
 */
export type StatusKind =
  | "pending"
  | "active"
  | "success"
  | "warning"
  | "error"
  | "inactive"
  | "paused"
  | "draft";

type StatusTone = "green" | "amber" | "red" | "blue" | "gray" | "purple";

type StatusMeta = {
  /** StatusDot tone — re-uses the canonical dot palette. */
  tone: StatusTone;
  /** Default human label when none is provided. Sentence case. */
  defaultLabel: string;
  /**
   * Surface classes resolved against semantic acr-* tokens so the badge
   * automatically reskins across the five theme blocks defined in index.css.
   */
  surface: string;
  /** Should the dot pulse (only true for "active"/live signals). */
  pulse?: boolean;
};

const STATUS_META: Record<StatusKind, StatusMeta> = {
  active: {
    tone: "green",
    defaultLabel: "Active",
    surface: "bg-acr-pos-soft text-acr-pos-soft-ink border-acr-pos/20",
    pulse: true,
  },
  success: {
    tone: "green",
    defaultLabel: "Success",
    surface: "bg-acr-pos-soft text-acr-pos-soft-ink border-acr-pos/20",
  },
  pending: {
    tone: "amber",
    defaultLabel: "Pending",
    surface: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn/20",
  },
  warning: {
    tone: "amber",
    defaultLabel: "Warning",
    surface: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn/20",
  },
  error: {
    tone: "red",
    defaultLabel: "Error",
    surface: "bg-acr-neg-soft text-acr-neg-soft-ink border-acr-neg/20",
  },
  inactive: {
    tone: "gray",
    defaultLabel: "Inactive",
    surface:
      "bg-muted/60 text-muted-foreground border-[color:var(--acr-line)]",
  },
  paused: {
    tone: "gray",
    defaultLabel: "Paused",
    surface:
      "bg-muted/60 text-muted-foreground border-[color:var(--acr-line)]",
  },
  draft: {
    tone: "gray",
    defaultLabel: "Draft",
    surface:
      "bg-muted/40 text-muted-foreground border-[color:var(--acr-line-soft)]",
  },
};

const FALLBACK_META: StatusMeta = {
  tone: "gray",
  defaultLabel: "",
  surface: "bg-muted/60 text-muted-foreground border-[color:var(--acr-line)]",
};

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Canonical status kind, or any other string for a neutral fallback. */
  status: StatusKind | (string & {});
  /** Override the default label (e.g. localized text or a custom phrase). */
  label?: React.ReactNode;
  /** Visual size; "md" (default) ≈ 22px, "sm" ≈ 18px. */
  size?: "sm" | "md";
}

function isKnownStatus(status: string): status is StatusKind {
  return Object.prototype.hasOwnProperty.call(STATUS_META, status);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Tiny pill that pairs a <StatusDot /> with a label, mapped to the canonical
 * acr-* semantic tokens so it reskins automatically across themes.
 *
 *   <StatusBadge status="active" />
 *   <StatusBadge status="paused" label="Snoozed" size="sm" />
 *   <StatusBadge status="archived" />  // unknown -> neutral fallback
 *
 * Always prefer this over hand-rolled `<span class="bg-green-100 ...">Status</span>`
 * pills sprinkled across the app.
 */
export function StatusBadge({
  status,
  label,
  size = "md",
  className,
  ...rest
}: StatusBadgeProps) {
  const meta = isKnownStatus(status) ? STATUS_META[status] : FALLBACK_META;

  const resolvedLabel: React.ReactNode =
    label ??
    (meta.defaultLabel || (typeof status === "string" ? titleCase(status) : ""));

  const ariaLabel =
    typeof resolvedLabel === "string"
      ? `Status: ${resolvedLabel}`
      : `Status: ${meta.defaultLabel || String(status)}`;

  const sizeClasses =
    size === "sm"
      ? "h-[18px] px-1.5 text-caption gap-1"
      : "h-[22px] px-2 text-xs gap-1.5";

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-full border font-medium leading-none whitespace-nowrap",
        sizeClasses,
        meta.surface,
        className,
      )}
      {...rest}
    >
      <StatusDot
        aria-hidden="true"
        tone={meta.tone}
        size={size === "sm" ? "sm" : "md"}
        pulse={meta.pulse}
      />
      <span>{resolvedLabel}</span>
    </span>
  );
}

export default StatusBadge;
