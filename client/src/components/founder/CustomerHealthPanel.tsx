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
    return <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />)}</div>;
  }

  const { customers = [], summary = {} } = (data as any) || {};

  return (
    <div className="p-4 space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3">
        <Heart className="w-5 h-5 text-pink-400" />
        <p className="text-sm text-gray-300 flex-1">{summary.summary || "Loading..."}</p>
      </div>

      {/* Health distribution */}
      {summary.total > 0 && (
        <div className="flex gap-1.5 h-2 rounded-full overflow-hidden">
          {summary.healthy > 0 && (
            <div className="bg-emerald-500 rounded-full" style={{ flex: summary.healthy }} title={`${summary.healthy} healthy`} />
          )}
          {summary.atRisk > 0 && (
            <div className="bg-yellow-500 rounded-full" style={{ flex: summary.atRisk }} title={`${summary.atRisk} at risk`} />
          )}
          {summary.critical > 0 && (
            <div className="bg-red-500 rounded-full" style={{ flex: summary.critical }} title={`${summary.critical} critical`} />
          )}
        </div>
      )}

      {/* Customer list (worst first) */}
      {customers.slice(0, 5).map((c: any) => {
        const TrendIcon = c.trend === "improving" ? TrendingUp : c.trend === "declining" ? TrendingDown : Minus;
        const trendColor = c.trend === "improving" ? "text-emerald-400" : c.trend === "declining" ? "text-red-400" : "text-gray-500";
        const healthColor = c.healthScore >= 70 ? "text-emerald-400" : c.healthScore >= 40 ? "text-yellow-400" : "text-red-400";

        return (
          <div key={c.orgId} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/30 border border-gray-700/20">
            {c.healthScore < 40 && <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{c.orgName}</p>
              <p className="text-[10px] text-gray-500">
                {c.details.plan} · {c.details.daysSinceLastLogin === 999 ? "Never logged in" : `${c.details.daysSinceLastLogin}d since login`}
              </p>
            </div>
            <span className={`text-sm font-medium ${healthColor}`}>{c.healthScore}</span>
            <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
          </div>
        );
      })}

      {customers.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-2">No customer data available yet.</p>
      )}
    </div>
  );
}