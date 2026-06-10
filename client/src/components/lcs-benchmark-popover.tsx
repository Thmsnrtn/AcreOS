/**
 * LCS Benchmark Popover — shows how a property's Land Credit Score
 * compares to industry benchmarks for the state/property type.
 * Wire into any LCS badge or score display.
 *
 * 2026-06-10 (T0-12, elevation-blueprint-2026-06-10.md): industry
 * benchmarks are honestly absent until real network-cohort percentiles
 * exist (Tier-2 item 2A). The API returns a typed
 * `{ available: false, reason }` result and this surface renders the
 * honest empty state — never invented medians/percentiles.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

type BenchmarkResult =
  | {
      available: true;
      percentile: number;
      benchmarkAvg: number;
      benchmarkMedian: number;
      outperforms: boolean;
    }
  | { available: false; reason: string };

interface BenchmarkResponse {
  benchmark: BenchmarkResult;
}

interface LcsBenchmarkPopoverProps {
  propertyId: number;
  children: React.ReactNode;
}

export function LcsBenchmarkPopover({ propertyId, children }: LcsBenchmarkPopoverProps) {
  const { data, isLoading } = useQuery<BenchmarkResponse>({
    queryKey: [`/api/land-credit/benchmark/${propertyId}`],
    enabled: propertyId > 0,
    staleTime: 5 * 60 * 1000,
  });

  const benchmark = data?.benchmark;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" align="start">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : benchmark?.available ? (
          <>
            <div className="flex items-center justify-between">
              <p id="lcs-benchmark-heading" className="text-xs font-medium">Industry benchmark</p>
              {benchmark.outperforms ? (
                <TrendingUp className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
              ) : benchmark.percentile < 50 ? (
                <TrendingDown className="w-3.5 h-3.5 text-acr-neg" aria-hidden="true" />
              ) : (
                <Minus className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>

            <dl className="space-y-1 m-0">
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Cohort average</dt>
                <dd className="tabular-nums m-0">{benchmark.benchmarkAvg}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Cohort median</dt>
                <dd className="tabular-nums m-0">{benchmark.benchmarkMedian}</dd>
              </div>
            </dl>

            <div
              role="progressbar"
              aria-labelledby="lcs-benchmark-heading"
              aria-valuenow={benchmark.percentile}
              aria-valuemin={0}
              aria-valuemax={100}
              className="relative h-2 bg-muted rounded-full"
            >
              <div
                className="absolute top-0 h-2 bg-primary rounded-full"
                style={{ width: `${Math.min(100, benchmark.percentile)}%` }}
              />
            </div>

            <p className="text-xs font-medium">
              <span className="tabular-nums">{benchmark.percentile}th</span> percentile
            </p>
          </>
        ) : (
          // Honest absence — no cohort data exists yet, so no numbers.
          // TODO(cta): system-generated insufficient-data state — there is no
          // user action that can produce cohort benchmarks.
          <EmptyState
            icon={BarChart3}
            headline="No industry benchmark yet"
            subtitle={
              benchmark && !benchmark.available
                ? benchmark.reason
                : "Benchmarks are only reported once they can be computed from real scored transactions across the AcreOS network."
            }
            cta={{ label: "", _noOp: true }}
            testId="lcs-benchmark-empty"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
