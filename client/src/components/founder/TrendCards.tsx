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
    <svg width="40" height="28" viewBox="0 0 40 28" className="flex-shrink-0">
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
      <div className="flex gap-3 overflow-x-auto px-4 pb-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 w-36 bg-gray-800/50 rounded-xl animate-pulse flex-shrink-0" />
        ))}
      </div>
    );
  }

  if (trends.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
      {trends.map((trend) => {
        const DirectionIcon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;
        const colorClass = trend.direction === "up" ? "text-emerald-400" : trend.direction === "down" ? "text-red-400" : "text-gray-400";

        return (
          <div
            key={trend.metric}
            className="flex-shrink-0 w-40 p-3 rounded-xl bg-gray-800/40 border border-gray-700/50"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 font-medium">{trend.label}</span>
              <MiniSparkline current={trend.current} previous={trend.previous} direction={trend.direction} />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-gray-100">{trend.current}</span>
              <div className={`flex items-center gap-0.5 ${colorClass}`}>
                <DirectionIcon className="w-3 h-3" />
                <span className="text-xs font-medium">
                  {trend.deltaPercent > 0 ? "+" : ""}{trend.deltaPercent}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
