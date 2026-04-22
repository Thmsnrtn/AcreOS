import * as React from "react";
import { ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { count as fmtCount, percent } from "@/lib/format";

export interface FunnelStage {
  /** Stable key for React. */
  key: string;
  label: string;
  count: number;
  /** Any CSS color — typically a tailwind token or brand color. */
  color: string;
}

interface ConversionFunnelProps {
  stages: FunnelStage[];
  /** Height of the bar row in px. Defaults to 40. */
  barHeight?: number;
  /** Show legend row below the bars. Defaults to true. */
  showLegend?: boolean;
  /** Minimum bar width as % — prevents 0-count stages from collapsing to nothing. */
  minWidthPct?: number;
  className?: string;
}

/**
 * Canonical conversion-funnel visualization. Each stage becomes a bar
 * sized proportional to the top stage count; hover for count + % conv
 * from the previous stage.
 *
 * Used for:
 *   - Pipeline header (leads → contacted → offered → closed)
 *   - Analytics funnel dashboards
 *   - Dashboard widgets showing stage progression
 */
export function ConversionFunnel({
  stages,
  barHeight = 40,
  showLegend = true,
  minWidthPct = 8,
  className,
}: ConversionFunnelProps) {
  const top = stages[0]?.count ?? 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-stretch gap-0.5" style={{ height: barHeight }}>
        {stages.map((stage, idx) => {
          const widthPct =
            top > 0 ? Math.max(minWidthPct, (stage.count / top) * 100) : 100 / stages.length;
          const prev = idx > 0 ? stages[idx - 1].count : null;
          const convRate = prev && prev > 0 ? stage.count / prev : null;

          return (
            <Tooltip key={stage.key}>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center justify-center rounded-sm cursor-default transition-all duration-500 relative"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: stage.color,
                    opacity: stage.count === 0 ? 0.25 : 1,
                  }}
                  data-testid={`funnel-stage-${stage.key}`}
                >
                  <span className="text-white text-[10px] font-bold truncate px-1">
                    {stage.count > 0 ? fmtCount(stage.count) : ""}
                  </span>
                  {idx < stages.length - 1 && (
                    <ChevronRight className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground z-10" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="font-semibold">{stage.label}</div>
                <div>{fmtCount(stage.count)}</div>
                {convRate !== null && (
                  <div className="text-muted-foreground">
                    {percent(convRate)} conv from prev
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {showLegend && (
        <div className="flex items-center gap-4 flex-wrap">
          {stages.map((stage) => (
            <div key={stage.key} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-[10px] text-muted-foreground">{stage.label}</span>
              <span className="text-[10px] font-semibold">{fmtCount(stage.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
