import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { relative } from "@/lib/format";

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
    badge: "bg-acr-pos/10 text-acr-pos border-acr-pos/20",
    dot: "bg-acr-pos",
    bar: "bg-acr-pos",
  },
  watch: {
    badge: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
    dot: "bg-acr-warn",
    bar: "bg-acr-warn",
  },
  critical: {
    badge: "bg-acr-neg/10 text-acr-neg border-acr-neg/20",
    dot: "bg-acr-neg",
    bar: "bg-acr-neg",
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
            <TrendingDown className="h-4 w-4 text-acr-neg" aria-hidden="true" />
            Churn intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-busy="true" aria-label="Loading churn intelligence" className="space-y-2 animate-pulse">
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
            <TrendingDown className="h-4 w-4 text-acr-neg" aria-hidden="true" />
            Churn intelligence
          </CardTitle>
          <Badge variant="outline" className={`text-xs capitalize ${style.badge}`} aria-label={`Status: ${churnMetrics.status}`}>
            <span aria-hidden="true" className={`mr-1.5 h-1.5 w-1.5 rounded-full inline-block ${style.dot}`} />
            {churnMetrics.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rate vs benchmark */}
        <dl className="grid grid-cols-3 gap-1 text-center m-0">
          <div>
            <dd className={`text-2xl font-bold tabular-nums m-0 ${churnMetrics.status === "healthy" ? "text-acr-pos" : churnMetrics.status === "watch" ? "text-acr-warn" : "text-acr-neg"}`}>
              {churnRate.toFixed(1)}%
            </dd>
            <dt className="text-caption text-muted-foreground">Your churn</dt>
          </div>
          <div>
            <dd className="text-2xl font-bold text-muted-foreground tabular-nums m-0">{churnMetrics.industryBenchmark}%</dd>
            <dt className="text-caption text-muted-foreground">Industry avg</dt>
          </div>
          <div>
            <dd className={`text-2xl font-bold tabular-nums m-0 ${vsIndustry <= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
              {vsIndustry > 0 ? "+" : ""}{vsIndustry.toFixed(1)}%
            </dd>
            <dt className="text-caption text-muted-foreground">vs benchmark</dt>
          </div>
        </dl>

        {/* Visual benchmark comparison bar */}
        <div className="space-y-1.5" aria-hidden="true">
          <div className="flex justify-between text-micro text-muted-foreground">
            <span>0%</span>
            <span>5%</span>
            <span>10%+</span>
          </div>
          {/* Your rate */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-micro text-muted-foreground mb-0.5">
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
            <div className="flex justify-between text-micro text-muted-foreground mb-0.5">
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
            <p id="at-risk-heading" className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-acr-warn" aria-hidden="true" />
              <span className="tabular-nums">{atRiskOrgs.length}</span> paying {atRiskOrgs.length === 1 ? "org" : "orgs"} at risk
            </p>
            <ul aria-labelledby="at-risk-heading" className="list-none p-0 m-0">
              {atRiskOrgs.slice(0, 5).map(org => {
                const idleText = org.daysSinceLastActive != null
                  ? `${org.daysSinceLastActive}d idle`
                  : org.lastActiveAt
                  ? relative(org.lastActiveAt)
                  : "—";
                return (
                  <li
                    key={org.id}
                    className="flex items-center justify-between py-1 border-b last:border-0"
                    aria-label={`${org.name}${org.tier ? `, ${org.tier} tier` : ""}, ${idleText}, ${org.churnSignal} risk`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full shrink-0 ${
                        org.churnSignal === "high" ? "bg-acr-neg" : "bg-acr-warn"
                      }`} />
                      <span className="text-sm truncate">{org.name}</span>
                      {org.tier && (
                        <Badge variant="outline" className="text-micro py-0 px-1.5 h-4 shrink-0 capitalize">
                          {org.tier}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {idleText}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {atRiskOrgs.length > 5 && (
              <p className="text-xs text-muted-foreground">+<span className="tabular-nums">{atRiskOrgs.length - 5}</span> more at risk</p>
            )}
          </div>
        ) : (
          <div role="status" className="flex items-center gap-2 py-2 text-sm text-acr-pos">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>No paying orgs at churn risk</span>
          </div>
        )}

        {/* Recent cancellations count */}
        {recentCancellations.length > 0 && (
          <div className="flex items-center justify-between text-xs pt-1 border-t">
            <span className="text-muted-foreground">Cancelled last 30d</span>
            <span className="font-medium text-acr-neg tabular-nums">{recentCancellations.length}</span>
          </div>
        )}

        {/* AI recommendations */}
        {recommendations.length > 0 && (
          <ul aria-label="Recommendations" className="space-y-1 pt-1 border-t list-none p-0 m-0">
            {recommendations.slice(0, 2).map((rec, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span aria-hidden="true" className="text-acr-accent shrink-0 mt-0.5">→</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
