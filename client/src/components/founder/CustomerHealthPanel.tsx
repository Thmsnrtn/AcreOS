// @ts-nocheck
/**
 * Customer Health Panel — Sovereign Company Protocol v6
 *
 * Shows customer health at a glance: healthy vs at-risk vs critical.
 * Worst-health customers listed first with trend arrows.
 */

import { useQuery } from "@tanstack/react-query";
import { Heart, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

export default function CustomerHealthPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/founder/intelligence/customer-health"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return <div role="status" aria-busy="true" aria-label="Loading customer health" className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-acr-bg-sunken/50 rounded-lg animate-pulse" />)}</div>;
  }

  const { customers = [], summary = {} } = (data as any) || {};

  return (
    <div className="p-4 space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3">
        <Heart className="w-5 h-5 text-acr-brand" aria-hidden="true" />
        <p className="text-sm text-muted-foreground flex-1">{summary.summary || "Loading…"}</p>
      </div>

      {/* Health distribution */}
      {summary.total > 0 && (
        <div
          role="img"
          aria-label={`Distribution: ${summary.healthy ?? 0} healthy, ${summary.atRisk ?? 0} at risk, ${summary.critical ?? 0} critical`}
          className="flex gap-1.5 h-2 rounded-full overflow-hidden"
        >
          {summary.healthy > 0 && (
            <div className="bg-acr-pos rounded-full" style={{ flex: summary.healthy }} aria-hidden="true" />
          )}
          {summary.atRisk > 0 && (
            <div className="bg-acr-warn rounded-full" style={{ flex: summary.atRisk }} aria-hidden="true" />
          )}
          {summary.critical > 0 && (
            <div className="bg-acr-neg rounded-full" style={{ flex: summary.critical }} aria-hidden="true" />
          )}
        </div>
      )}

      {/* Customer list (worst first) */}
      {customers.length > 0 && (
        <ul aria-label="At-risk customers" className="space-y-3 list-none p-0 m-0">
          {customers.slice(0, 5).map((c: any) => {
            const TrendIcon = c.trend === "improving" ? TrendingUp : c.trend === "declining" ? TrendingDown : Minus;
            const trendColor = c.trend === "improving" ? "text-acr-pos" : c.trend === "declining" ? "text-acr-neg" : "text-muted-foreground";
            const healthColor = c.healthScore >= 70 ? "text-acr-pos" : c.healthScore >= 40 ? "text-acr-warn" : "text-acr-neg";
            const loginText = c.details.daysSinceLastLogin === 999 ? "Never logged in" : `${c.details.daysSinceLastLogin}d since login`;

            return (
              <li
                key={c.orgId}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-acr-bg-sunken/30 border border-border/20"
                aria-label={`${c.orgName}: health ${c.healthScore}, ${c.trend ?? "stable"}, ${c.details.plan}, ${loginText}`}
              >
                {c.healthScore < 40 && <AlertTriangle className="w-3.5 h-3.5 text-acr-neg flex-shrink-0" aria-hidden="true" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{c.orgName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {c.details.plan} · <span className="tabular-nums">{loginText}</span>
                  </p>
                </div>
                <span className={`text-sm font-medium tabular-nums ${healthColor}`}>{c.healthScore}</span>
                <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}

      {customers.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No customer data available yet.</p>
      )}
    </div>
  );
}