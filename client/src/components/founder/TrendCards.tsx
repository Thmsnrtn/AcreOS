// @ts-nocheck
/**
 * Trend Cards — Sovereign Company Protocol v4
 *
 * Apple Health-style trend cards showing this week vs last week.
 * Each card has a small spark line, the delta, and a one-line interpretation.
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface TrendResult {
  metric: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
  direction: "up" | "down" | "flat";
  interpretation: string;
}

function MiniSparkline({ current, previous, direction }: { current: number; previous: number; direction: string }) {
  const color = direction === "up" ? "#10B981" : direction === "down" ? "#EF4444" : "#6B7280";
  const max = Math.max(current, previous, 1);
  const prevHeight = (previous / max) * 24;
  const currHeight = (current / max) * 24;

  return (
    <svg width="40" height="28" viewBox="0 0 40 28" className="flex-shrink-0" aria-hidden="true">
      <rect x="4" y={28 - prevHeight} width="12" height={prevHeight} rx="2" fill={color} opacity={0.3} />
      <rect x="24" y={28 - currHeight} width="12" height={currHeight} rx="2" fill={color} />
    </svg>
  );
}

export default function TrendCards() {
  const { data: trendsData, isLoading } = useQuery({
    queryKey: ["/api/founder/intelligence/trends"],
    refetchInterval: 300000, // 5 min
  });

  const trends: TrendResult[] = (trendsData as any)?.trends || [];

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading trends" className="flex gap-3 overflow-x-auto px-4 pb-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 w-36 bg-acr-bg-sunken/50 rounded-xl animate-pulse flex-shrink-0" />
        ))}
      </div>
    );
  }

  if (trends.length === 0) return null;

  return (
    <ul aria-label="This week vs last week trends" className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide list-none m-0">
      {trends.map((trend) => {
        const DirectionIcon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;
        const colorClass = trend.direction === "up" ? "text-acr-pos" : trend.direction === "down" ? "text-acr-neg" : "text-muted-foreground";
        const directionWord = trend.direction === "up" ? "up" : trend.direction === "down" ? "down" : "flat";
        const sign = trend.deltaPercent > 0 ? "+" : "";

        return (
          <li
            key={trend.metric}
            className="flex-shrink-0 w-40 p-3 rounded-xl bg-acr-bg-sunken/40 border border-border/50"
            aria-label={`${trend.label}: ${trend.current}, ${directionWord} ${sign}${trend.deltaPercent}% vs ${trend.previous} previous`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground font-medium">{trend.label}</span>
              <MiniSparkline current={trend.current} previous={trend.previous} direction={trend.direction} />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-muted-foreground tabular-nums">{trend.current}</span>
              <div className={`flex items-center gap-0.5 ${colorClass}`}>
                <DirectionIcon className="w-3 h-3" aria-hidden="true" />
                <span className="text-xs font-medium tabular-nums">
                  {sign}{trend.deltaPercent}%
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
