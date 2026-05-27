/**
 * OrgHealthMonitor — extracted from founder-dashboard.tsx (F-D #4).
 *
 * Pure move; no behavior change. Same /api/founder/org-health and
 * /api/founder/revenue/waterfall query keys.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { usd } from "@/lib/format";

interface OrgHealthItem {
  id: number;
  name: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  dunningStage: string | null;
  healthScore: number;
  healthStatus: "healthy" | "watch" | "at_risk" | "critical" | "founder";
  issues: string[];
  mrr: number;
}

const HEALTH_CONFIG = {
  critical: { label: "Critical", bg: "bg-acr-neg/10", text: "text-acr-neg", bar: "bg-acr-neg", dot: "bg-acr-neg" },
  at_risk: { label: "At Risk", bg: "bg-acr-warn/10", text: "text-acr-warn", bar: "bg-acr-warn", dot: "bg-acr-warn" },
  watch: { label: "Watch", bg: "bg-acr-warn/10", text: "text-acr-warn", bar: "bg-acr-warn", dot: "bg-acr-warn" },
  healthy: { label: "Healthy", bg: "bg-acr-pos/10", text: "text-acr-pos", bar: "bg-acr-pos", dot: "bg-acr-pos" },
  founder: { label: "Founder", bg: "bg-primary/10", text: "text-primary", bar: "bg-primary", dot: "bg-primary" },
};

export function OrgHealthMonitor() {
  const [showAll, setShowAll] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: orgs, isLoading } = useQuery<OrgHealthItem[]>({
    queryKey: ["/api/founder/org-health"],
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: waterfallData } = useQuery<{
    tiers: Array<{ tier: string; label: string; count: number; activeCount: number; atRiskCount: number; mrr: number; atRiskMrr: number }>;
    totalMrr: number;
    atRiskMrr: number;
    totalOrgs: number;
  }>({
    queryKey: ["/api/founder/revenue/waterfall"],
  });

  if (isLoading) return (
    <div className="p-6 border rounded-xl bg-card space-y-3">
      <div className="h-5 bg-muted animate-pulse rounded w-1/4" />
      {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
    </div>
  );

  const allOrgs = orgs || [];
  const filtered = filterStatus === "all" ? allOrgs : allOrgs.filter(o => o.healthStatus === filterStatus);
  const displayed = showAll ? filtered : filtered.slice(0, 12);

  const counts = allOrgs.reduce<Record<string, number>>((acc, o) => {
    acc[o.healthStatus] = (acc[o.healthStatus] || 0) + 1;
    return acc;
  }, {});

  const atRiskCount = (counts.critical || 0) + (counts.at_risk || 0);
  const totalMrr = waterfallData?.totalMrr || 0;
  const atRiskMrr = waterfallData?.atRiskMrr || 0;

  return (
    <div className="p-6 border rounded-xl bg-card space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" aria-hidden="true" />
            Customer health
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            {allOrgs.length} organizations · {usd(totalMrr, { noCents: Number.isInteger(totalMrr) })} MRR
            {atRiskMrr > 0 && <span className="text-acr-neg ml-2">· {usd(atRiskMrr, { noCents: Number.isInteger(atRiskMrr) })} at risk</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(counts).filter(([k]) => k !== 'founder').map(([status, count]) => {
            const cfg = HEALTH_CONFIG[status as keyof typeof HEALTH_CONFIG] || HEALTH_CONFIG.healthy;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
                aria-pressed={filterStatus === status}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filterStatus === status ? `${cfg.bg} ${cfg.text} ${cfg.bg}` : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} aria-hidden="true" />
                {cfg.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* MRR waterfall by tier */}
      {waterfallData && (
        <div className="grid grid-cols-5 gap-2">
          {waterfallData.tiers.filter(t => t.tier !== 'free').map((t) => (
            <div key={t.tier} className="p-3 border rounded-card text-center">
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-lg font-bold text-primary mt-0.5 tabular-nums">{usd(t.mrr, { noCents: Number.isInteger(t.mrr) })}</div>
              <div className="text-xs text-muted-foreground">{t.activeCount} active</div>
              {t.atRiskCount > 0 && (
                <div className="text-xs text-acr-neg font-medium">{t.atRiskCount} at risk</div>
              )}
            </div>
          ))}
        </div>
      )}

      {atRiskCount > 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-acr-neg/5 border border-acr-neg/30 rounded-card text-sm text-acr-neg">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {atRiskCount} organization{atRiskCount > 1 ? 's' : ''} at risk — check the unified action queue at /founder for recommended responses
        </div>
      )}

      <div className="space-y-1.5">
        {displayed.map((org) => {
          const cfg = HEALTH_CONFIG[org.healthStatus] || HEALTH_CONFIG.healthy;
          return (
            <div key={org.id} className="flex items-center gap-3 p-2.5 rounded-card hover:bg-muted/20 transition-colors group">
              <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{org.name}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{org.subscriptionTier}</Badge>
                  {org.issues.length > 0 && (
                    <span className={`text-xs ${cfg.text} truncate`}>{org.issues[0]}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${cfg.bar}`}
                    style={{ width: `${org.healthScore}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-7 text-right">{org.healthScore}</span>
              </div>
              {org.mrr > 0 && (
                <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">${org.mrr}/mo</span>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > 12 && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-expanded={showAll}
        >
          {showAll ? "Show less" : `Show ${filtered.length - 12} more`}
        </button>
      )}
    </div>
  );
}
