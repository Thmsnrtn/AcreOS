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

  const fmt = (n: number, decimals: number) =>
    `${unit === "$" ? "$" : ""}${n.toFixed(decimals)}${unit !== "$" ? unit : ""}`;

  const valueText = fmt(value, unit === "$" ? 0 : 1);
  const ariaLabel = `${label}: ${fmt(value, 1)}, 95% range ${fmt(lower, 1)} to ${fmt(upper, 1)}, ${confidenceLabel}`;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums" aria-hidden="true">{valueText}</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="img"
            tabIndex={0}
            aria-label={ariaLabel}
            className="relative h-2 bg-muted rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {/* Confidence band */}
            <div
              aria-hidden="true"
              className="absolute h-full bg-acr-accent rounded-full"
              style={{ left: `${Math.max(0, leftPct)}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
            />
            {/* Point estimate */}
            <div
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-acr-accent rounded-full border border-white"
              style={{ left: `${Math.max(1, Math.min(99, valuePct))}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium m-0 tabular-nums">{label}: {fmt(value, 1)}</p>
          <p className="text-xs text-muted-foreground m-0 tabular-nums">
            95% range: {fmt(lower, 1)} – {fmt(upper, 1)}
          </p>
          <p className="text-xs text-muted-foreground m-0">{confidenceLabel}</p>
        </TooltipContent>
      </Tooltip>
      <div aria-hidden="true" className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{fmt(lower, 0)}</span>
        <span>{fmt(upper, 0)}</span>
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
  strong_buy: { label: "Strong opportunity", color: "text-acr-pos", bg: "bg-acr-pos-soft", border: "border-acr-pos-soft" },
  buy: { label: "Good opportunity", color: "text-acr-pos", bg: "bg-acr-pos-soft", border: "border-acr-pos-soft" },
  hold: { label: "Evaluate further", color: "text-acr-warn", bg: "bg-acr-warn-soft", border: "border-acr-warn-soft" },
  pass: { label: "Below threshold", color: "text-acr-neg", bg: "bg-acr-neg-soft", border: "border-acr-neg-soft" },
};

export function DecisionScore({ score, maxScore = 100, decision, reasoning, className }: DecisionScoreProps) {
  const config = DECISION_CONFIG[decision];
  const pct = Math.round((score / maxScore) * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          role="group"
          aria-label={`${config.label}: score ${score} of ${maxScore} (${pct}%). ${reasoning}`}
          className={cn("rounded-lg border p-3 space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", config.bg, config.border, className)}
        >
          <div className="flex items-center justify-between">
            <span className={cn("text-sm font-medium", config.color)}>{config.label}</span>
            <span className="text-lg font-bold tabular-nums" aria-hidden="true">{score}<span className="text-xs text-muted-foreground">/{maxScore}</span></span>
          </div>
          <div
            className="h-1.5 bg-white/50 rounded-full overflow-hidden"
            role="progressbar"
            aria-label={`${config.label} score`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div aria-hidden="true" className={cn("h-full rounded-full", config.color.replace("text-", "bg-"))} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <p className="text-xs m-0">{reasoning}</p>
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
    <div
      role="status"
      aria-label={`Without action, potential loss of ${potentialLoss} within ${timeframe}`}
      className={cn("text-xs text-acr-warn bg-acr-warn-soft border border-acr-warn-soft rounded-md px-2.5 py-1.5", className)}
    >
      <span aria-hidden="true">Without action: <span className="font-medium">{potentialLoss}</span> within {timeframe}</span>
    </div>
  );
}
