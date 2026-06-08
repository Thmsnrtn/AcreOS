/**
 * DomainTile — one per-domain status tile in the Command grid.
 *
 * Shows the domain's status dot + open/warn/critical counts + the top open
 * finding's title. The whole tile is a 44px-min button that opens the domain
 * detail (sheet on mobile, dialog on desktop). Green tiles read as calm/quiet.
 */

import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { staggerItem } from "@/lib/animations";
import { type DomainSummary, STATUS_CLASSES } from "./logic";

interface DomainTileProps {
  summary: DomainSummary;
  onSelect: (domain: string) => void;
}

function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neg" | "warn" | "muted";
}) {
  if (value === 0) return null;
  const toneCls =
    tone === "neg"
      ? "text-acr-neg bg-acr-neg-soft"
      : tone === "warn"
        ? "text-acr-warn bg-acr-warn-soft"
        : "text-muted-foreground bg-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        toneCls,
      )}
    >
      <span>{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  );
}

export function DomainTile({ summary, onSelect }: DomainTileProps) {
  const cls = STATUS_CLASSES[summary.status];
  const Icon = summary.meta.icon;
  const isGreen = summary.status === "green";

  return (
    <motion.button
      type="button"
      variants={staggerItem}
      onClick={() => onSelect(summary.domain)}
      data-testid={`command-tile-${summary.domain}`}
      data-status={summary.status}
      aria-label={`${summary.meta.label}: ${
        isGreen
          ? "all clear"
          : `${summary.openCount} open finding${summary.openCount === 1 ? "" : "s"}`
      }. Open detail.`}
      className={cn(
        "group relative flex min-h-[7rem] w-full flex-col rounded-2xl border bg-card p-4 text-left transition-colors",
        "hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        cls.border,
        cls.ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold text-foreground">
            {summary.meta.label}
          </span>
        </div>
        <span
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cls.dot)}
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 flex-1">
        {isGreen ? (
          <p className="text-sm text-muted-foreground">Clear</p>
        ) : (
          <p className="line-clamp-2 text-sm font-medium text-foreground">
            {summary.topFinding?.title ?? `${summary.openCount} open`}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {isGreen ? (
            <span className="text-xs text-muted-foreground">No open findings</span>
          ) : (
            <>
              <CountChip label="critical" value={summary.criticalCount} tone="neg" />
              <CountChip label="warn" value={summary.warnCount} tone="warn" />
              {summary.criticalCount === 0 && summary.warnCount === 0 ? (
                <CountChip label="open" value={summary.openCount} tone="muted" />
              ) : null}
            </>
          )}
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </div>
    </motion.button>
  );
}
