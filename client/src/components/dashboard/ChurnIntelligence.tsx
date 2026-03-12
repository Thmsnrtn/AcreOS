import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ChurnData {
  churnMetrics: {
    monthlyChurnRate: string;
    totalPayingOrgs: number;
    cancellationsLast30d: number;
    industryBenchmark: number;
    status: "healthy" | "watch" | "critical";
  };
  atRiskOrgs: Array<{
    id: number;
    name: string;
    tier: string | null;
    daysSinceLastActive: number | null;
    churnSignal: string;
    lastActiveAt: string | null;
    createdAt: string | null;
  }>;
  recentCancellations: Array<{
    organizationId: number | null;
    fromTier: string | null;
    toTier: string | null;
    createdAt: string | null;
  }>;
  recommendations: string[];
}

const STATUS_STYLES: Record<string, { badge: string; dot: string; bar: string }> = {
  healthy: {
    badge: "bg-green-500/10 text-green-600 border-green-500/20",
    dot: "bg-green-500",
    bar: "bg-green-500",
  },
  watch: {
    badge: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  critical: {
    badge: "bg-red-500/10 text-red-600 border-red-500/20",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
};

export function ChurnIntelligence() {
  const { data, isLoading } = useQuery<ChurnData>({
    queryKey: ["/api/founder/intelligence/churn"],
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            Churn Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { churnMetrics, atRiskOrgs, recentCancellations, recommendations } = data;
  const churnRate = parseFloat(churnMetrics.monthlyChurnRate);
  const vsIndustry = churnRate - churnMetrics.industryBenchmark;
  const style = STATUS_STYLES[churnMetrics.status] ?? STATUS_STYLES.healthy;
  const churnBarWidth = Math.min(100, (churnRate / 10) * 100);
  const benchmarkBarWidth = Math.min(100, (churnMetrics.industryBenchmark / 10) * 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            Churn Intelligence
          </CardTitle>
          <Badge variant="outline" className={`text-xs ${style.badge}`}>
            <span className={`mr-1.5 h-1.5 w-1.5 rounded-full inline-block ${style.dot}`} />
            {churnMetrics.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rate vs benchmark */}
        <div className="grid grid-cols-3 gap-1 text-center">
          <div>
            <p className={`text-2xl font-bold ${churnMetrics.status === "healthy" ? "text-green-600" : churnMetrics.status === "watch" ? "text-amber-600" : "text-red-600"}`}>
              {churnRate.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground">Your churn</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-muted-foreground">{churnMetrics.industryBenchmark}%</p>
            <p className="text-[11px] text-muted-foreground">Industry avg</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${vsIndustry <= 0 ? "text-green-600" : "text-red-600"}`}>
              {vsIndustry > 0 ? "+" : ""}{vsIndustry.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground">vs benchmark</p>
          </div>
        </div>

        {/* Visual benchmark comparison bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0%</span>
            <span>5%</span>
            <span>10%+</span>
          </div>
          {/* Your rate */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>Your rate</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${style.bar}`}
                style={{ width: `${churnBarWidth}%` }}
              />
            </div>
          </div>
          {/* Industry */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>Industry avg</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-muted-foreground/40 transition-all"
                style={{ width: `${benchmarkBarWidth}%` }}
              />
            </div>
          </div>
        </div>

        {/* At-risk orgs */}
        {atRiskOrgs.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              {atRiskOrgs.length} paying {atRiskOrgs.length === 1 ? "org" : "orgs"} at risk
            </p>
            {atRiskOrgs.slice(0, 5).map(org => (
              <div key={org.id} className="flex items-center justify-between py-1 border-b last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    org.churnSignal === "high" ? "bg-red-500" : "bg-amber-500"
                  }`} />
                  <span className="text-sm truncate">{org.name}</span>
                  {org.tier && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 shrink-0 capitalize">
                      {org.tier}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">
                    {org.daysSinceLastActive != null
                      ? `${org.daysSinceLastActive}d idle`
                      : org.lastActiveAt
                      ? formatDistanceToNow(new Date(org.lastActiveAt), { addSuffix: true })
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
            {atRiskOrgs.length > 5 && (
              <p className="text-xs text-muted-foreground">+{atRiskOrgs.length - 5} more at risk</p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>No paying orgs at churn risk</span>
          </div>
        )}

        {/* Recent cancellations count */}
        {recentCancellations.length > 0 && (
          <div className="flex items-center justify-between text-xs pt-1 border-t">
            <span className="text-muted-foreground">Cancelled last 30d</span>
            <span className="font-medium text-red-500">{recentCancellations.length}</span>
          </div>
        )}

        {/* AI recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-1 pt-1 border-t">
            {recommendations.slice(0, 2).map((rec, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-blue-500 shrink-0 mt-0.5">→</span>
                <span>{rec}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
