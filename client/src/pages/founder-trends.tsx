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
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

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

const UP_IS_GOOD: Record<string, boolean> = {
  avgOutcomeScore: true,
  autoResolvedRatio: true,
  founderOverrideRate: false,
  calibrationBrier: false,
  safetyRailTrips: false,
  decisionVolume: true,
};

export default function FounderTrendsPage() {
  useDocumentTitle("System trends");
  const { data, isLoading, isError, refetch } = useQuery<TrendsReport>({
    queryKey: ["/api/founder/intelligence/system-trends"],
    staleTime: 5 * 60_000,
  });

  return (
    <PageShell label="System Trends">
      <div className="space-y-6 max-w-6xl mx-auto">
        <PageHeader
          title="Is the system getting better?"
          icon={<Activity className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="Longer arc than the autonomy-health meter or the monthly letter. Shows how the system has trended over the last 90 days — outcomes, override rate, calibration, safety-rail trips, per-agent trust. Use this as your trust gauge for how much to delegate further."
        >
          {data && (
            <p className="text-sm font-medium text-foreground">
              Verdict: <span className="text-muted-foreground">{data.verdict}</span>
            </p>
          )}
        </PageHeader>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 space-y-4" role="status" aria-live="polite">
              <span className="sr-only">Loading 90-day trends…</span>
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load trends. The signals themselves are unaffected —{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>.
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <ul className="grid gap-4 md:grid-cols-2" aria-label="System trend signals">
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
                <li key={key}>
                  <TrendCard series={data.series[key]} upIsGood={UP_IS_GOOD[key]} />
                </li>
              ))}
            </ul>

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
  const latestText = series.latest != null
    ? `${series.latest}${series.unit && series.unit !== "count" ? ` ${series.unit}` : ""}`
    : "no data";
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{series.label}</CardTitle>
          <Badge
            variant="secondary"
            className={`text-micro ${directionMeta.color}`}
            aria-label={`Trend: ${directionMeta.label}`}
          >
            <directionMeta.Icon className="h-3 w-3 mr-1" aria-hidden="true" />
            {directionMeta.label}
          </Badge>
        </div>
        {series.latest != null && (
          <p className="text-caption text-muted-foreground tabular-nums">
            Latest: {latestText}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-2">
        {series.series.length < 2 ? (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
            Not enough data yet.
          </div>
        ) : (
          <div
            role="img"
            aria-label={`${series.label} over last ${series.series.length} days, latest ${latestText}, trend ${directionMeta.label}`}
          >
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
          </div>
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
      ? { Icon: TrendingUp, color: "text-acr-pos dark:text-acr-pos", label: "improving" }
      : { Icon: TrendingUp, color: "text-acr-neg dark:text-acr-neg", label: "worsening" };
  }
  if (direction === "down") {
    return upIsGood
      ? { Icon: TrendingDown, color: "text-acr-neg dark:text-acr-neg", label: "declining" }
      : { Icon: TrendingDown, color: "text-acr-pos dark:text-acr-pos", label: "improving" };
  }
  if (direction === "flat") {
    return { Icon: Minus, color: "text-muted-foreground", label: "steady" };
  }
  return { Icon: Minus, color: "text-muted-foreground", label: "—" };
}

function AgentTrustChart({ points }: { points: AgentTrustPoint[] }) {
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
    <div role="img" aria-label={`Per-agent trust scores over time for ${codenames.length} agents: ${codenames.join(", ")}`}>
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
    </div>
  );
}
