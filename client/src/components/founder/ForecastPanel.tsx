// @ts-nocheck
/**
 * Forecast Panel — Sovereign Company Protocol v6
 *
 * Shows MRR projections with confidence bands, milestones, runway, and unit economics.
 * "You'll hit $10K MRR by June (high confidence)"
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Target, Fuel, Users } from "lucide-react";
import { usd } from "@/lib/format";
import { DataProvenanceChip } from "@/components/data-provenance-chip";

export default function ForecastPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/founder/intelligence/forecast"],
    refetchInterval: 600000, // 10 min
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-3" role="status" aria-busy="true" aria-label="Loading forecast">
        {[1,2,3].map(i => <div key={i} className="h-12 bg-acr-bg-sunken/50 rounded-card animate-pulse" />)}
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  const forecast = data as any;
  if (!forecast) return null;

  const { mrr, runway, unitEconomics } = forecast;

  return (
    <div className="space-y-4 p-4">
      {/* MRR + Growth */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-card bg-acr-pos/10">
          <TrendingUp className="w-5 h-5 text-acr-pos" aria-hidden="true" />
        </div>
        <div>
          <p className="text-lg font-semibold text-muted-foreground tabular-nums">
            {usd(mrr?.currentMRR || 0, { noCents: true })} MRR
          </p>
          <p className="text-xs text-muted-foreground">
            {mrr?.growthRatePct > 0 ? "+" : ""}{mrr?.growthRatePct || 0}% monthly growth
          </p>
        </div>
      </div>

      {/* Projections */}
      {mrr?.projections?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">6-month projection</p>
          <div className="grid grid-cols-3 gap-2">
            {mrr.projections.slice(0, 3).map((p: any) => (
              <div key={p.month} className="p-2 rounded-card bg-acr-bg-sunken/40 border border-border/30 text-center">
                <p className="text-micro text-muted-foreground">{p.month}</p>
                <p className="text-sm font-medium text-muted-foreground tabular-nums">{usd(p.projected, { noCents: true })}</p>
                <p className="text-micro text-muted-foreground tabular-nums">{usd(p.low, { noCents: true })}–{usd(p.high, { noCents: true })}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {mrr?.milestones?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Milestones</p>
          {mrr.milestones.slice(0, 3).map((m: any) => (
            <div key={m.target} className="flex items-center gap-2 px-3 py-1.5 rounded-card bg-acr-bg-sunken/30">
              <Target className="w-3.5 h-3.5 text-acr-warn" aria-hidden="true" />
              <span className="text-sm text-muted-foreground tabular-nums">{usd(m.target, { noCents: true })}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {m.estimatedDate || "—"}
              </span>
              {m.confidence && (
                <DataProvenanceChip
                  source={`MRR model · ${m.confidence.charAt(0).toUpperCase() + m.confidence.slice(1)} confidence`}
                  classification="modeled"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Runway + Unit Economics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-card bg-acr-bg-sunken/40 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Fuel className="w-3.5 h-3.5 text-acr-accent" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Runway</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {runway?.isProfitable ? "Profitable" : runway?.runwayMonths ? `~${runway.runwayMonths} months` : "Calculating…"}
          </p>
        </div>
        <div className="p-2.5 rounded-card bg-acr-bg-sunken/40 border border-border/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-acr-brand" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Customers</span>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {unitEconomics?.totalCustomers || 0} at {usd(unitEconomics?.avgRevenuePerCustomer || 0, { noCents: true })}/mo
          </p>
        </div>
      </div>
    </div>
  );
}