import * as React from "react";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { quickSpring, staggerContainer, staggerItem } from "@/lib/animations";

interface DataSource {
  name: string;
  returned: boolean;
  latencyMs?: number;
  fetchedAt?: string;
}

export interface DataConfidenceBadgeProps {
  confidence: number; // 0-100
  sources: DataSource[];
  compact?: boolean; // smaller version for inline use
}

const BAR_COUNT = 5;

function getConfidenceColor(confidence: number): {
  filled: string;
  muted: string;
  text: string;
  label: string;
} {
  if (confidence >= 70) {
    return {
      filled: "bg-acr-pos",
      muted: "bg-acr-pos/20",
      text: "text-acr-pos dark:text-acr-pos",
      label: "High",
    };
  }
  if (confidence >= 40) {
    return {
      filled: "bg-acr-warn",
      muted: "bg-acr-warn/20",
      text: "text-acr-warn dark:text-acr-warn",
      label: "Medium",
    };
  }
  return {
    filled: "bg-acr-neg",
    muted: "bg-acr-neg/20",
    text: "text-acr-neg dark:text-acr-neg",
    label: "Low",
  };
}

function getFilledBars(confidence: number): number {
  if (confidence >= 90) return 5;
  if (confidence >= 70) return 4;
  if (confidence >= 50) return 3;
  if (confidence >= 30) return 2;
  if (confidence > 0) return 1;
  return 0;
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SignalBars({
  confidence,
  compact,
}: {
  confidence: number;
  compact?: boolean;
}) {
  const colors = getConfidenceColor(confidence);
  const filledCount = getFilledBars(confidence);
  const baseHeight = compact ? 4 : 6;
  const step = compact ? 2 : 3;
  const barWidth = compact ? 3 : 4;
  const gap = compact ? 1 : 1.5;

  return (
    <div
      className="inline-flex items-end"
      style={{ gap: `${gap}px` }}
      role="img"
      aria-label={`Data confidence: ${confidence}%, ${colors.label}`}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const isFilled = i < filledCount;
        const height = baseHeight + step * i;

        return (
          <motion.div
            key={i}
            className={cn(
              "rounded-sm",
              isFilled ? colors.filled : colors.muted
            )}
            style={{
              width: `${barWidth}px`,
              height: `${height}px`,
            }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{
              ...quickSpring,
              delay: i * 0.04,
            }}
          />
        );
      })}
    </div>
  );
}

function SourceRow({ source }: { source: DataSource }) {
  const status = source.returned ? "OK" : "Miss";
  const latencyText = source.latencyMs != null ? `, ${source.latencyMs} milliseconds` : "";
  return (
    <motion.li
      variants={staggerItem}
      className="flex items-center justify-between gap-3 py-1.5 list-none"
      aria-label={`${source.name}: ${status}${latencyText}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-2 w-2 shrink-0 rounded-full",
            source.returned ? "bg-acr-pos" : "bg-acr-neg"
          )}
        />
        <span className="text-sm truncate text-foreground" aria-hidden="true">{source.name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
        {source.latencyMs != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {source.latencyMs}ms
          </span>
        )}
        {source.returned ? (
          <span className="text-xs font-medium text-acr-pos dark:text-acr-pos">
            OK
          </span>
        ) : (
          <span className="text-xs font-medium text-acr-neg">Miss</span>
        )}
      </div>
    </motion.li>
  );
}

export function DataConfidenceBadge({
  confidence,
  sources,
  compact = false,
}: DataConfidenceBadgeProps) {
  const clamped = Math.max(0, Math.min(100, confidence));
  const colors = getConfidenceColor(clamped);
  const returnedCount = sources.filter((s) => s.returned).length;
  const lastFetchedIso = sources
    .filter((s) => s.fetchedAt)
    .sort((a, b) => new Date(b.fetchedAt!).getTime() - new Date(a.fetchedAt!).getTime())[0]?.fetchedAt;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          aria-label={`Data confidence: ${clamped}%, ${colors.label}. Open source breakdown.`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors",
            "border-border/50 bg-background/80 hover:bg-accent/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            compact && "px-1.5 py-0.5"
          )}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
          transition={quickSpring}
        >
          <SignalBars confidence={clamped} compact={compact} />
          {!compact && (
            <span
              aria-hidden="true"
              className={cn(
                "text-xs font-semibold tabular-nums",
                colors.text
              )}
            >
              {clamped}%
            </span>
          )}
        </motion.button>
      </PopoverTrigger>

      <PopoverContent
        className="w-72 p-0"
        side="bottom"
        align="start"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <SignalBars confidence={clamped} />
            <span className="text-sm font-semibold">Data confidence</span>
          </div>
          <span
            aria-label={`${clamped}%`}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              colors.muted,
              colors.text
            )}
          >
            {clamped}%
          </span>
        </div>

        {/* Source breakdown */}
        <motion.div
          className="px-4 py-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <p
            id="confidence-sources-summary"
            className="text-xs text-muted-foreground mb-1 m-0"
            aria-label={`${returnedCount} of ${sources.length} sources returned data`}
          >
            <span className="tabular-nums" aria-hidden="true">{returnedCount}</span><span aria-hidden="true">/</span><span className="tabular-nums" aria-hidden="true">{sources.length}</span><span aria-hidden="true"> sources returned data</span>
          </p>
          <ul aria-labelledby="confidence-sources-summary" className="divide-y divide-border/30 list-none p-0 m-0">
            {sources.map((source) => (
              <SourceRow key={source.name} source={source} />
            ))}
          </ul>
        </motion.div>

        {/* Footer with timestamps */}
        {lastFetchedIso && (
          <div className="border-t border-border/50 px-4 py-2">
            <p className="text-caption text-muted-foreground m-0">
              Last fetched:{" "}
              <time dateTime={lastFetchedIso} className="tabular-nums">{formatTimestamp(lastFetchedIso)}</time>
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
