// @ts-nocheck
/**
 * Outcome Feedback — Sovereign Company Protocol v6
 *
 * Shows the CEO whether their approved decisions actually helped.
 * "47 of 50 decisions led to positive outcomes this month."
 */

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, BarChart3 } from "lucide-react";

export default function OutcomeFeedback() {
  const { data: timeline } = useQuery({
    queryKey: ["/api/founder/intelligence/activity-timeline"],
    refetchInterval: 300000,
  });

  const entries = (timeline as any)?.entries || [];

  // Calculate outcome stats
  const withVerification = entries.filter((e: any) => e.verification);
  const verified = withVerification.filter((e: any) => e.verification?.success);
  const failed = withVerification.filter((e: any) => !e.verification?.success);
  const pending = entries.filter((e: any) => !e.verification && e.outcome === "success");

  const totalActions = entries.length;
  const successRate = totalActions > 0 ? Math.round((entries.filter((e: any) => e.outcome === "success").length / totalActions) * 100) : 0;

  if (totalActions === 0) return null;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Agent Performance</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-emerald-900/20 border border-emerald-900/30">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-lg font-semibold text-emerald-400">{verified.length}</p>
          <p className="text-[10px] text-gray-500">Verified good</p>
        </div>
        <div className="p-2 rounded-lg bg-yellow-900/20 border border-yellow-900/30">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <Clock className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <p className="text-lg font-semibold text-yellow-400">{pending.length}</p>
          <p className="text-[10px] text-gray-500">Awaiting check</p>
        </div>
        <div className="p-2 rounded-lg bg-red-900/20 border border-red-900/30">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <XCircle className="w-3.5 h-3.5 text-red-400" />
          </div>
          <p className="text-lg font-semibold text-red-400">{failed.length}</p>
          <p className="text-[10px] text-gray-500">Didn't help</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">
        {successRate}% action success rate across {totalActions} recent actions
      </p>
    </div>
  );
}