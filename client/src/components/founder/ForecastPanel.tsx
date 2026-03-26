// @ts-nocheck
/**
 * Forecast Panel — Sovereign Company Protocol v6
 *
 * Shows MRR projections with confidence bands, milestones, runway, and unit economics.
 * "You'll hit $10K MRR by June (high confidence)"
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Target, Fuel, Users } from "lucide-react";

export default function ForecastPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/founder/intelligence/forecast"],
    refetchInterval: 600000, // 10 min
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-800/50 rounded-lg animate-pulse" />)}</div>;
  }

  const forecast = data as any;
  if (!forecast) return null;

  const { mrr, runway, unitEconomics } = forecast;

  return (
    <div className="space-y-4 p-4">
      {/* MRR + Growth */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-100">
            ${(mrr?.currentMRR || 0).toLocaleString()} MRR
          </p>
          <p className="text-xs text-gray-400">
            {mrr?.growthRatePct > 0 ? "+" : ""}{mrr?.growthRatePct || 0}% monthly growth
          </p>
        </div>
      </div>

      {/* Projections */}
      {mrr?.projections?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">6-Month Projection</p>
          <div className="grid grid-cols-3 gap-2">
            {mrr.projections.slice(0, 3).map((p: any) => (
              <div key={p.month} className="p-2 rounded-lg bg-gray-800/40 border border-gray-700/30 text-center">
                <p className="text-[10px] text-gray-500">{p.month}</p>
                <p className="text-sm font-medium text-gray-200">${p.projected.toLocaleString()}</p>
                <p className="text-[10px] text-gray-600">${p.low.toLocaleString()}-${p.high.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {mrr?.milestones?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Milestones</p>
          {mrr.milestones.slice(0, 3).map((m: any) => (
            <div key={m.target} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/30">
              <Target className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-sm text-gray-300">${m.target.toLocaleString()}</span>
              <span className="ml-auto text-xs text-gray-500">
                {m.estimatedDate || "—"}
              </span>
              {m.confidence && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  m.confidence === "high" ? "bg-emerald-900/30 text-emerald-400" :
                  m.confidence === "medium" ? "bg-yellow-900/30 text-yellow-400" :
                  "bg-red-900/30 text-red-400"
                }`}>
                  {m.confidence}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Runway + Unit Economics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-gray-800/40 border border-gray-700/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Fuel className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs text-gray-500">Runway</span>
          </div>
          <p className="text-sm text-gray-300">
            {runway?.isProfitable ? "Profitable" : runway?.runwayMonths ? `~${runway.runwayMonths} months` : "Calculating..."}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-gray-800/40 border border-gray-700/30">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs text-gray-500">Customers</span>
          </div>
          <p className="text-sm text-gray-300">
            {unitEconomics?.totalCustomers || 0} at ${unitEconomics?.avgRevenuePerCustomer || 0}/mo
          </p>
        </div>
      </div>
    </div>
  );
}