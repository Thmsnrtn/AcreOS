import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { chartColor } from "@/lib/chartPalette";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { format, parseISO } from "date-fns";

interface MRRData {
  history: Array<{ month: string; revenueCents: number; newOrgs: number; churned: number; net: number }>;
  forecast: Array<{ month: string; projectedRevenueCents: number; confidence: number }>;
  summary: {
    currentMrrCents: number;
    prevMrrCents: number;
    momGrowthPct: number;
    arrCents: number;
    totalRevenueAllTimeCents: number;
  };
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

function parseMonthLabel(month: string): string {
  try {
    return format(parseISO(month + "-01"), "MMM yy");
  } catch {
    return month;
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-card border bg-card px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) =>
        p.value != null ? (
          <p key={p.name} style={{ color: p.stroke }}>
            {p.name}: {formatCents(p.value)}
          </p>
        ) : null
      )}
    </div>
  );
}

interface MRRTrajectoryProps {
  goalCents?: number;
}

export function MRRTrajectory({ goalCents }: MRRTrajectoryProps) {
  const { data, isLoading } = useQuery<MRRData>({
    queryKey: ["/api/founder/intelligence/mrr"],
    staleTime: 3600 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-acr-accent" aria-hidden="true" />
            Revenue trajectory
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-busy="true" aria-label="Loading revenue trajectory" className="h-44 bg-muted rounded-card animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { history, forecast, summary } = data;
  const mom = summary.momGrowthPct;

  // Build unified chart data: history + forecast months merged
  const chartData = [
    ...history.map(h => ({
      label: parseMonthLabel(h.month),
      revenue: h.revenueCents,
      forecast: undefined as number | undefined,
    })),
    ...forecast.map(f => ({
      label: parseMonthLabel(f.month),
      revenue: undefined as number | undefined,
      forecast: f.projectedRevenueCents,
    })),
  ];

  // Milestone projection statement
  const milestones = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000].map(m => m * 100);
  const nextMilestone = milestones.find(m => m > summary.currentMrrCents);
  let forecastStatement = "";
  if (nextMilestone) {
    const hitMonth = forecast.find(f => f.projectedRevenueCents >= nextMilestone);
    if (hitMonth) {
      forecastStatement = `On track to hit ${formatCents(nextMilestone)}/mo by ${parseMonthLabel(hitMonth.month)}`;
    } else if (forecast.length > 0) {
      const last = forecast[forecast.length - 1];
      forecastStatement = `Projected ${formatCents(last.projectedRevenueCents)}/mo in 3 months`;
    }
  }

  const MomIcon = mom > 0.5 ? TrendingUp : mom < -0.5 ? TrendingDown : Minus;
  const momColor = mom > 0.5 ? "text-acr-pos" : mom < -0.5 ? "text-acr-neg" : "text-muted-foreground";
  const momBg = mom > 0.5 ? "bg-acr-pos/10 text-acr-pos border-acr-pos/20" : mom < -0.5 ? "bg-acr-neg/10 text-acr-neg border-acr-neg/20" : "bg-muted text-muted-foreground";

  const maxRevenue = Math.max(
    ...history.map(h => h.revenueCents),
    ...forecast.map(f => f.projectedRevenueCents),
    goalCents ?? 0
  );

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-acr-accent" aria-hidden="true" />
              Revenue trajectory
            </CardTitle>
            {forecastStatement && (
              <p className="text-xs text-muted-foreground mt-0.5">{forecastStatement}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={`text-xs tabular-nums ${momBg}`} aria-label={`Month-over-month: ${mom > 0 ? "+" : ""}${mom.toFixed(1)}%`}>
              <MomIcon className="h-3 w-3 mr-1" aria-hidden="true" />
              {mom > 0 ? "+" : ""}{mom.toFixed(1)}% MoM
            </Badge>
            <Badge variant="outline" className="text-xs tabular-nums" aria-label={`Annual recurring revenue: ${formatCents(summary.arrCents)}`}>
              ARR {formatCents(summary.arrCents)}
            </Badge>
          </div>
        </div>
        {/* Sparkline stats row */}
        <dl className="flex items-center gap-4 pt-1 pb-0 m-0">
          <div>
            <dt className="text-xs text-muted-foreground">All-time revenue</dt>
            <dd className="text-sm font-semibold tabular-nums m-0">{formatCents(summary.totalRevenueAllTimeCents)}</dd>
          </div>
          <div aria-hidden="true" className="h-8 border-l" />
          <div>
            <dt className="text-xs text-muted-foreground">Previous MRR</dt>
            <dd className="text-sm font-semibold tabular-nums m-0">{formatCents(summary.prevMrrCents)}</dd>
          </div>
          <div aria-hidden="true" className="h-8 border-l" />
          <div>
            <dt className="text-xs text-muted-foreground">Current MRR</dt>
            <dd className={`text-sm font-bold tabular-nums m-0 ${momColor}`}>{formatCents(summary.currentMrrCents)}</dd>
          </div>
        </dl>
      </CardHeader>
      <CardContent className="pt-2">
        <div role="img" aria-label={`Revenue trajectory chart: current MRR ${formatCents(summary.currentMrrCents)}, ${mom > 0 ? "up" : mom < 0 ? "down" : "flat"} ${Math.abs(mom).toFixed(1)}% month over month${forecastStatement ? `. ${forecastStatement}` : ""}`}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fcastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatCents}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={50}
              domain={[0, maxRevenue * 1.15]}
            />
            <Tooltip content={<CustomTooltip />} />
            {goalCents && goalCents > 0 && (
              <ReferenceLine
                y={goalCents}
                stroke={chartColor(0)}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{ value: `Goal ${formatCents(goalCents)}`, position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }}
              />
            )}
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={chartColor(1)}
              strokeWidth={2}
              fill="url(#mrrGrad)"
              dot={false}
              name="Revenue"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="forecast"
              stroke={chartColor(2)}
              strokeWidth={2}
              strokeDasharray="6 4"
              fill="url(#fcastGrad)"
              dot={false}
              name="Forecast"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
        <ul aria-label="Chart legend" className="flex items-center gap-4 justify-end mt-1 list-none p-0 m-0">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-4 rounded-sm bg-acr-accent" />
            <span className="text-[10px] text-muted-foreground">Actual</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-4 rounded-sm bg-acr-brand opacity-60" style={{ backgroundImage: "repeating-linear-gradient(90deg, #a855f7 0, #a855f7 4px, transparent 4px, transparent 8px)" }} />
            <span className="text-[10px] text-muted-foreground">Forecast</span>
          </li>
          {goalCents && goalCents > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0.5 w-4 bg-acr-warn" style={{ borderTop: "2px dashed #f59e0b" }} />
              <span className="text-[10px] text-muted-foreground">Goal</span>
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
