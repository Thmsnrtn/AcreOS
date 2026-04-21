/**
 * FounderTrendsPage — the system-improvement meta-dashboard.
 *
 * Plots 90-day trends of every signal that tells the founder whether
 * the autonomous system is gaining or losing trustworthiness. Outcome
 * score, override rate, calibration, safety-rail trips, decision
 * volume, per-agent trust trajectories.
 *
 * The goal of this page is trust-earning: the founder should be able
 * to look at the charts and feel confident delegating further, OR
 * catch an inflection early if the system is regressing.
 */

import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";

interface TrendPoint {
  date: string;
  value: number | null;
}
interface TrendSeries {
  key: string;
  label: string;
  unit: string;
  series: TrendPoint[];
  latest: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}
interface AgentTrustPoint {
  date: string;
  codename: string;
  trustScore: number;
}
interface TrendsReport {
  windowDays: number;
  generatedAt: string;
  series: {
    avgOutcomeScore: TrendSeries;
    founderOverrideRate: TrendSeries;
    autoResolvedRatio: TrendSeries;
    calibrationBrier: TrendSeries;
    safetyRailTrips: TrendSeries;
    decisionVolume: TrendSeries;
  };
  agentTrustTrajectories: AgentTrustPoint[];
  verdict: string;
}

// Signals where up = good (outcome ↑, auto-resolved ↑); others where up = bad
const UP_IS_GOOD: Record<string, boolean> = {
  avgOutcomeScore: true,
  autoResolvedRatio: true,
  founderOverrideRate: false,
  calibrationBrier: false, // Brier: lower is better
  safetyRailTrips: false,
  decisionVolume: true, // ambiguous but more throughput is net positive
};

export default function FounderTrendsPage() {
  const { data, isLoading, isError } = useQuery<TrendsReport>({
    queryKey: ["/api/founder/intelligence/system-trends"],
    staleTime: 5 * 60_000,
  });

  return (
    <PageShell label="System Trends">
      <div className="space-y-6 max-w-6xl mx-auto">
        <Card>
          <CardContent className="p-6">
            <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              Is the system getting better?
            </h1>
            <p className="text-sm text-muted-foreground">
              Longer arc than the autonomy-health meter or the monthly letter. Shows how the system
              has trended over the last 90 days — outcomes, override rate, calibration, safety-rail
              trips, per-agent trust. Use this as your trust gauge for how much to delegate further.
            </p>
            {data && (
              <p className="mt-3 text-sm font-medium text-foreground">
                Verdict: <span className="text-muted-foreground">{data.verdict}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 space-y-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">Could not load trends.</CardContent>
          </Card>
        ) : data ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  "avgOutcomeScore",
                  "founderOverrideRate",
                  "autoResolvedRatio",
                  "calibrationBrier",
                  "safetyRailTrips",
                  "decisionVolume",
                ] as Array<keyof TrendsReport["series"]>
              ).map((key) => (
                <TrendCard key={key} series={data.series[key]} upIsGood={UP_IS_GOOD[key]} />
              ))}
            </div>

            {/* Agent trust trajectories */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Per-agent trust trajectory</CardTitle>
              </CardHeader>
              <CardContent>
                {data.agentTrustTrajectories.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No trust-evolution data yet"
                    description="Per-agent trust scores evolve on the monthly cadence. Come back after the first trust-evolution cron run."
                  />
                ) : (
                  <AgentTrustChart points={data.agentTrustTrajectories} />
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

function TrendCard({ series, upIsGood }: { series: TrendSeries; upIsGood: boolean }) {
  const directionMeta = directionDisplay(series.direction, upIsGood);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{series.label}</CardTitle>
          <Badge variant="secondary" className={`text-[10px] ${directionMeta.color}`}>
            <directionMeta.Icon className="h-3 w-3 mr-1" />
            {directionMeta.label}
          </Badge>
        </div>
        {series.latest != null && (
          <p className="text-[11px] text-muted-foreground">
            Latest: {series.latest}
            {series.unit && series.unit !== "count" ? ` ${series.unit}` : ""}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-2">
        {series.series.length < 2 ? (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
            Not enough data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={series.series}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function directionDisplay(
  direction: TrendSeries["direction"],
  upIsGood: boolean,
): { Icon: typeof TrendingUp; color: string; label: string } {
  if (direction === "up") {
    return upIsGood
      ? { Icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", label: "improving" }
      : { Icon: TrendingUp, color: "text-red-600 dark:text-red-400", label: "worsening" };
  }
  if (direction === "down") {
    return upIsGood
      ? { Icon: TrendingDown, color: "text-red-600 dark:text-red-400", label: "declining" }
      : { Icon: TrendingDown, color: "text-emerald-600 dark:text-emerald-400", label: "improving" };
  }
  if (direction === "flat") {
    return { Icon: Minus, color: "text-muted-foreground", label: "steady" };
  }
  return { Icon: Minus, color: "text-muted-foreground", label: "—" };
}

function AgentTrustChart({ points }: { points: AgentTrustPoint[] }) {
  // Transform to { date, [codename]: score, ... } pivoted shape for multi-series.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row[p.codename] = p.trustScore;
    byDate.set(p.date, row);
  }
  const chartData = [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  const codenames = Array.from(new Set(points.map((p) => p.codename))).slice(0, 6);
  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" />
        <YAxis tick={{ fontSize: 10 }} stroke="currentColor" domain={[0, 100]} />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {codenames.map((c, i) => (
          <Line
            key={c}
            type="monotone"
            dataKey={c}
            stroke={colors[i % colors.length]}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
