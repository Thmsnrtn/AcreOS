/**
 * Confidence Interval Display — shows score predictions with uncertainty bands.
 * Used for LCS scores, offer predictions, and market values.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ConfidenceIntervalProps {
  value: number;
  lower: number;
  upper: number;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  className?: string;
}

export function ConfidenceInterval({
  value, lower, upper, label, unit = "", min = 0, max = 100, className,
}: ConfidenceIntervalProps) {
  const range = max - min;
  const leftPct = ((lower - min) / range) * 100;
  const widthPct = ((upper - lower) / range) * 100;
  const valuePct = ((value - min) / range) * 100;
  const spread = upper - lower;
  const confidenceLabel = spread < range * 0.15 ? "High confidence" : spread < range * 0.3 ? "Moderate confidence" : "Wide range — limited data";

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value.toFixed(unit === "$" ? 0 : 1)}{unit !== "$" ? unit : ""}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative h-2 bg-muted rounded-full">
            {/* Confidence band */}
            <div
              className="absolute h-full bg-blue-200 rounded-full"
              style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
            />
            {/* Point estimate */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-600 rounded-full border border-white"
              style={{ left: `${Math.max(1, Math.min(99, valuePct))}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{label}: {unit === "$" ? "$" : ""}{value.toFixed(1)}{unit !== "$" ? unit : ""}</p>
          <p className="text-xs text-muted-foreground">
            95% range: {unit === "$" ? "$" : ""}{lower.toFixed(1)} – {unit === "$" ? "$" : ""}{upper.toFixed(1)}{unit !== "$" ? unit : ""}
          </p>
          <p className="text-xs text-muted-foreground">{confidenceLabel}</p>
        </TooltipContent>
      </Tooltip>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{unit === "$" ? "$" : ""}{lower.toFixed(0)}{unit !== "$" ? unit : ""}</span>
        <span>{unit === "$" ? "$" : ""}{upper.toFixed(0)}{unit !== "$" ? unit : ""}</span>
      </div>
    </div>
  );
}

/**
 * Decision-optimized score display — shows score with color-coded recommendation.
 * Makes the "so what" obvious without requiring domain expertise.
 */
interface DecisionScoreProps {
  score: number;
  maxScore?: number;
  decision: "strong_buy" | "buy" | "hold" | "pass";
  reasoning: string;
  className?: string;
}

const DECISION_CONFIG = {
  strong_buy: { label: "Strong Opportunity", color: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
  buy: { label: "Good Opportunity", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  hold: { label: "Evaluate Further", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
  pass: { label: "Below Threshold", color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
};

export function DecisionScore({ score, maxScore = 100, decision, reasoning, className }: DecisionScoreProps) {
  const config = DECISION_CONFIG[decision];
  const pct = Math.round((score / maxScore) * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("rounded-lg border p-3 space-y-2", config.bg, config.border, className)}>
          <div className="flex items-center justify-between">
            <span className={cn("text-sm font-medium", config.color)}>{config.label}</span>
            <span className="text-lg font-bold">{score}<span className="text-xs text-muted-foreground">/{maxScore}</span></span>
          </div>
          <div className="h-1.5 bg-white/50 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full", config.color.replace("text-", "bg-"))} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <p className="text-xs">{reasoning}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Loss framing indicator — shows what the user would miss by not acting.
 */
interface LossFrameProps {
  potentialLoss: string;
  timeframe: string;
  className?: string;
}

export function LossFrame({ potentialLoss, timeframe, className }: LossFrameProps) {
  return (
    <div className={cn("text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5", className)}>
      Without action: <span className="font-medium">{potentialLoss}</span> within {timeframe}
    </div>
  );
}
