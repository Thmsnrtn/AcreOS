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
    <section aria-labelledby="agent-performance-heading" className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-400" aria-hidden="true" />
        <h3 id="agent-performance-heading" className="text-xs font-medium text-gray-500 uppercase tracking-wide m-0">Agent performance</h3>
      </div>

      <ul aria-label="Outcome breakdown" className="grid grid-cols-3 gap-2 text-center list-none p-0 m-0">
        <li className="p-2 rounded-lg bg-emerald-900/20 border border-emerald-900/30" aria-label={`${verified.length} verified good`}>
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-emerald-400 tabular-nums m-0">{verified.length}</p>
          <p className="text-[10px] text-gray-500 m-0">Verified good</p>
        </li>
        <li className="p-2 rounded-lg bg-yellow-900/20 border border-yellow-900/30" aria-label={`${pending.length} awaiting check`}>
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <Clock className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-yellow-400 tabular-nums m-0">{pending.length}</p>
          <p className="text-[10px] text-gray-500 m-0">Awaiting check</p>
        </li>
        <li className="p-2 rounded-lg bg-red-900/20 border border-red-900/30" aria-label={`${failed.length} didn't help`}>
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <XCircle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-red-400 tabular-nums m-0">{failed.length}</p>
          <p className="text-[10px] text-gray-500 m-0">Didn't help</p>
        </li>
      </ul>

      <p className="text-xs text-gray-400 text-center">
        <span className="tabular-nums">{successRate}%</span> action success rate across <span className="tabular-nums">{totalActions}</span> recent actions
      </p>
    </section>
  );
}