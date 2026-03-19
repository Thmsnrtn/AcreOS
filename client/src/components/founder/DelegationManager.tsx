// @ts-nocheck
/**
 * Delegation Manager — Sovereign Company Protocol v6
 *
 * Shows active temporary delegations. CEO can see which agents
 * have elevated authority and revoke delegations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Clock, X } from "lucide-react";

const AGENT_NAMES: Record<string, string> = {
  sophie_csm: "Sophie", forge_revenue: "Forge", sentinel_devops: "Sentinel",
  atlas_cto: "Atlas", beacon_marketing: "Beacon", ledger_finance: "Ledger",
  oracle_analytics: "Oracle", compass_pm: "Compass", shield_legal: "Shield",
  crucible_qa: "Crucible",
};

export default function DelegationManager() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["/api/founder/intelligence/delegations"],
    refetchInterval: 60000,
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/founder/intelligence/delegations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/intelligence/delegations"] }),
  });

  const delegations = (data as any)?.delegations || [];

  if (delegations.length === 0) return null;

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Delegations</span>
      </div>

      {delegations.map((d: any) => {
        const name = AGENT_NAMES[d.agentCodename] || d.agentCodename;
        const expiresIn = Math.max(0, Math.round((new Date(d.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60)));

        return (
          <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-900/20">
            <div className="flex-1">
              <p className="text-sm text-gray-200">
                <span className="font-medium text-amber-400">{name}</span> — elevated to Level {d.toLevel}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3 h-3 text-gray-500" />
                <p className="text-[10px] text-gray-500">
                  {expiresIn > 0 ? `Expires in ${expiresIn}h` : "Expiring soon"} · {d.reason}
                </p>
              </div>
            </div>
            <button
              onClick={() => revokeMutation.mutate(d.id)}
              className="p-1 text-gray-500 hover:text-red-400 transition-colors"
              title="Revoke delegation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}