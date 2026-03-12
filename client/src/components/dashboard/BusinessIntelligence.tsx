import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface BIData {
  arrCents: number;
  mrrCents: number;
  churnRate: number;
  nrr: number;
  customerHealthDistribution: Array<{ band: string; count: number }>;
  ltvCac: { ltv: number | null; cac: number | null; ratio: number | null; note: string };
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

const BAND_COLORS: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  critical: "bg-red-700",
};

const BAND_LABELS: Record<string, string> = {
  green: "Healthy",
  yellow: "At Risk",
  red: "High Risk",
  critical: "Critical",
};

function MetricCard({ title, value, sub, trend }: { title: string; value: string; sub?: string; trend?: "up" | "down" | "flat" }) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className="text-xs text-muted-foreground font-medium">{title}</p>
        <div className="flex items-end gap-2 mt-1">
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {trend && <TrendIcon className={`h-4 w-4 mb-0.5 ${trendColor}`} />}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function BusinessIntelligence() {
  const { data, isLoading } = useQuery<BIData>({
    queryKey: ["/api/founder/intelligence/business-intelligence"],
    staleTime: 3600 * 1000, // 1 hour — no polling
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Business Intelligence</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalOrgs = data.customerHealthDistribution.reduce((sum, d) => sum + Number(d.count), 0) || 1;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Business Intelligence</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard
          title="ARR"
          value={formatCents(data.arrCents)}
          sub={`MRR: ${formatCents(data.mrrCents)}`}
        />
        <MetricCard
          title="LTV:CAC"
          value={data.ltvCac.ratio ? `${data.ltvCac.ratio.toFixed(1)}×` : "—"}
          sub={data.ltvCac.note}
        />
        <MetricCard
          title="Monthly Churn"
          value={`${data.churnRate.toFixed(1)}%`}
          trend={data.churnRate < 2 ? "up" : data.churnRate > 5 ? "down" : "flat"}
          sub={data.churnRate < 2 ? "Excellent retention" : data.churnRate > 5 ? "Needs attention" : "Within range"}
        />
        <MetricCard
          title="NRR"
          value={`${data.nrr.toFixed(0)}%`}
          trend={data.nrr >= 100 ? "up" : "down"}
          sub={data.nrr >= 100 ? "Net expansion" : "Net contraction"}
        />
        {/* Cohort Retention — placeholder until cohort query is added */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">Cohort Retention</p>
            <p className="text-sm text-muted-foreground mt-2">Available after 30d data</p>
          </CardContent>
        </Card>

        {/* Customer Health Distribution */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium mb-2">Customer Health</p>
            <div className="space-y-1.5">
              {data.customerHealthDistribution.length > 0 ? (
                data.customerHealthDistribution.map(({ band, count }) => (
                  <div key={band} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${BAND_COLORS[band] ?? "bg-gray-400"}`} />
                    <span className="text-xs text-muted-foreground flex-1">{BAND_LABELS[band] ?? band}</span>
                    <span className="text-xs font-medium">{count}</span>
                    <span className="text-xs text-muted-foreground">
                      ({Math.round((Number(count) / totalOrgs) * 100)}%)
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Run scoring pass to see data</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
