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
      ? <TrendingUp className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
      : data.comparison.vsMedian < 0
        ? <TrendingDown className="w-3.5 h-3.5 text-acr-neg" aria-hidden="true" />
        : <Minus className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
    : null;

  const positionColor: Record<string, string> = {
    top_quartile: "text-acr-pos dark:text-acr-pos",
    above_median: "text-acr-accent dark:text-acr-accent",
    below_median: "text-acr-warn dark:text-acr-warn",
    bottom_quartile: "text-acr-neg dark:text-acr-neg",
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
              <p id="lcs-benchmark-heading" className="text-xs font-medium">Industry benchmark</p>
              {trendIcon}
            </div>

            <dl className="space-y-1 m-0">
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Your LCS</dt>
                <dd className="font-semibold tabular-nums m-0">{data.score} ({data.grade})</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">State median</dt>
                <dd className="tabular-nums m-0">{data.benchmarks.median}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">75th percentile</dt>
                <dd className="tabular-nums m-0">{data.benchmarks.p75}</dd>
              </div>
            </dl>

            <div
              role="progressbar"
              aria-labelledby="lcs-benchmark-heading"
              aria-valuenow={data.comparison.percentile}
              aria-valuemin={0}
              aria-valuemax={100}
              className="relative h-2 bg-muted rounded-full"
            >
              <div
                className="absolute top-0 h-2 bg-primary rounded-full"
                style={{ width: `${Math.min(100, data.comparison.percentile)}%` }}
              />
            </div>

            <p className={`text-xs font-medium ${positionColor[data.comparison.relativePosition] || ""}`}>
              <span className="tabular-nums">{data.comparison.percentile}th</span> percentile
              {data.comparison.vsMedian > 0
                ? ` — ${data.comparison.vsMedian} points above median`
                : data.comparison.vsMedian < 0
                  ? ` — ${Math.abs(data.comparison.vsMedian)} points below median`
                  : " — at median"}
            </p>

            <p className="text-micro text-muted-foreground">{data.benchmarks.source}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Benchmark data unavailable for this property.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
