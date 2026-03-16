import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Minus, Target, DollarSign, Users, Zap, Activity, Loader2 } from "lucide-react";

interface KPIMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  target?: number;
  previousPeriod?: number;
  trend: "up" | "down" | "flat";
  category: "revenue" | "pipeline" | "acquisition" | "efficiency";
  format: "number" | "currency" | "percent";
}

const CATEGORY_CONFIG = {
  revenue: { label: "Revenue", icon: DollarSign, color: "text-green-600" },
  pipeline: { label: "Pipeline", icon: Activity, color: "text-blue-600" },
  acquisition: { label: "Acquisition", icon: Target, color: "text-purple-600" },
  efficiency: { label: "Efficiency", icon: Zap, color: "text-yellow-600" },
};

function formatValue(value: number, format: string, unit: string): string {
  if (format === "currency") {
    return `$${(value / 100).toLocaleString()}`;
  }
  if (format === "percent") {
    return `${value.toFixed(1)}%`;
  }
  return `${value.toLocaleString()} ${unit}`.trim();
}

function getTrendIcon(trend: string) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-green-600" />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-red-600" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

function getChangePercent(current: number, previous: number): string {
  if (previous === 0) return "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export default function KPIDashboardPage() {
  const { data, isLoading } = useQuery<{ metrics: KPIMetric[]; period: string; updatedAt: string }>({
    queryKey: ["/api/kpis"],
    queryFn: () => fetch("/api/kpis").then(r => r.json()),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading KPIs...
        </div>
      </PageShell>
    );
  }

  const metrics = data?.metrics ?? [];
  const categories = Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>;

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-kpi-dashboard-title">
            KPI Dashboard
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Real-time key performance indicators across all business areas.
          </p>
        </div>
        {data?.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {categories.map(category => {
        const config = CATEGORY_CONFIG[category];
        const Icon = config.icon;
        const categoryMetrics = metrics.filter(m => m.category === category);
        if (categoryMetrics.length === 0) return null;

        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${config.color}`} />
              <h2 className="text-sm font-semibold">{config.label}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {categoryMetrics.map(kpi => {
                const targetPct = kpi.target ? Math.min(100, Math.round((kpi.value / kpi.target) * 100)) : null;
                return (
                  <Card key={kpi.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <p className="text-xs text-muted-foreground leading-tight">{kpi.label}</p>
                        {getTrendIcon(kpi.trend)}
                      </div>
                      <p className="text-xl font-bold">{formatValue(kpi.value, kpi.format, kpi.unit)}</p>
                      {kpi.previousPeriod !== undefined && (
                        <p className={`text-xs ${kpi.trend === "up" ? "text-green-600" : kpi.trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                          {getChangePercent(kpi.value, kpi.previousPeriod)} vs last period
                        </p>
                      )}
                      {kpi.target && targetPct !== null && (
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Target</span>
                            <span>{targetPct}%</span>
                          </div>
                          <Progress
                            value={targetPct}
                            className={`h-1 ${targetPct >= 100 ? "[&>div]:bg-green-500" : targetPct >= 75 ? "" : "[&>div]:bg-yellow-500"}`}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </PageShell>
  );
}
