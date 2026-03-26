/**
 * LCS Benchmark Popover — shows how a property's Land Credit Score
 * compares to industry benchmarks for the state/property type.
 * Wire into any LCS badge or score display.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface BenchmarkData {
  score: number;
  grade: string;
  comparison: {
    score: number;
    percentile: number;
    vsMedian: number;
    relativePosition: string;
  };
  benchmarks: {
    median: number;
    p25: number;
    p75: number;
    source: string;
  };
  summary: string;
}

interface LcsBenchmarkPopoverProps {
  propertyId: number;
  children: React.ReactNode;
}

export function LcsBenchmarkPopover({ propertyId, children }: LcsBenchmarkPopoverProps) {
  const { data, isLoading } = useQuery<BenchmarkData>({
    queryKey: [`/api/land-credit/benchmark/${propertyId}`],
    enabled: propertyId > 0,
    staleTime: 5 * 60 * 1000,
  });

  const trendIcon = data?.comparison
    ? data.comparison.vsMedian > 0
      ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
      : data.comparison.vsMedian < 0
        ? <TrendingDown className="w-3.5 h-3.5 text-red-500" />
        : <Minus className="w-3.5 h-3.5 text-muted-foreground" />
    : null;

  const positionColor: Record<string, string> = {
    top_quartile: "text-emerald-600 dark:text-emerald-400",
    above_median: "text-blue-600 dark:text-blue-400",
    below_median: "text-amber-600 dark:text-amber-400",
    bottom_quartile: "text-red-600 dark:text-red-400",
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="start">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : data?.comparison ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Industry Benchmark</p>
              {trendIcon}
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Your LCS</span>
                <span className="font-semibold">{data.score} ({data.grade})</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">State median</span>
                <span>{data.benchmarks.median}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">75th percentile</span>
                <span>{data.benchmarks.p75}</span>
              </div>
            </div>

            {/* Visual bar showing position */}
            <div className="relative h-2 bg-muted rounded-full">
              <div
                className="absolute top-0 h-2 bg-primary rounded-full"
                style={{ width: `${Math.min(100, data.comparison.percentile)}%` }}
              />
            </div>

            <p className={`text-xs font-medium ${positionColor[data.comparison.relativePosition] || ""}`}>
              {data.comparison.percentile}th percentile
              {data.comparison.vsMedian > 0
                ? ` — ${data.comparison.vsMedian} points above median`
                : data.comparison.vsMedian < 0
                  ? ` — ${Math.abs(data.comparison.vsMedian)} points below median`
                  : " — at median"}
            </p>

            <p className="text-[10px] text-muted-foreground">{data.benchmarks.source}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Benchmark data unavailable for this property.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
