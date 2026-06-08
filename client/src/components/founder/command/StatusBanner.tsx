/**
 * StatusBanner — the morning-glance "is the company green right now?" banner.
 *
 * Calm, legible, token-driven. Green = nothing needs you. Amber = warnings.
 * Red = at least one critical. Derived purely from the worst open severity
 * across domains (see logic.companyStatus).
 */

import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import {
  type StatusLevel,
  STATUS_CLASSES,
  companyStatusCopy,
} from "./logic";

const STATUS_ICON = {
  green: CheckCircle2,
  amber: AlertTriangle,
  red: AlertOctagon,
} as const;

interface StatusBannerProps {
  status: StatusLevel;
  criticalCount: number;
  warnCount: number;
  /** When the rollup was last fetched, formatted for display. */
  asOfLabel?: string;
}

export function StatusBanner({
  status,
  criticalCount,
  warnCount,
  asOfLabel,
}: StatusBannerProps) {
  const cls = STATUS_CLASSES[status];
  const Icon = STATUS_ICON[status];
  const copy = companyStatusCopy(status, criticalCount, warnCount);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      aria-live="polite"
      data-testid="command-status-banner"
      data-status={status}
      className={cn(
        "rounded-2xl border p-5 md:p-6",
        cls.surface,
        cls.border,
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background/70",
          )}
        >
          <Icon className={cn("h-6 w-6", cls.text)} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Company status
          </p>
          <h2
            className={cn(
              "mt-0.5 text-lg md:text-xl font-semibold tracking-tight",
              cls.text,
            )}
          >
            {copy.headline}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.sub}</p>
          {asOfLabel ? (
            <p className="mt-2 text-xs text-muted-foreground">
              As of {asOfLabel}
            </p>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
