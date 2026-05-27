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
    <section aria-labelledby="active-delegations-heading" className="p-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-acr-warn" aria-hidden="true" />
        <h3 id="active-delegations-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">Active delegations</h3>
      </div>

      <ul aria-labelledby="active-delegations-heading" className="space-y-2 list-none p-0 m-0">
        {delegations.map((d: any) => {
          const name = AGENT_NAMES[d.agentCodename] || d.agentCodename;
          const expiresIn = Math.max(0, Math.round((new Date(d.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60)));
          const expiryText = expiresIn > 0 ? `Expires in ${expiresIn}h` : "Expiring soon";

          return (
            <li
              key={d.id}
              className="flex items-center gap-2 px-3 py-2 rounded-card bg-acr-warn-soft/10 border border-acr-warn-soft/20"
              aria-label={`${name} elevated to level ${d.toLevel}, ${expiryText}, reason: ${d.reason}`}
            >
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-acr-warn">{name}</span> — elevated to Level <span className="tabular-nums">{d.toLevel}</span>
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <p className="text-micro text-muted-foreground">
                    <span className="tabular-nums">{expiryText}</span> · {d.reason}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => revokeMutation.mutate(d.id)}
                disabled={revokeMutation.isPending}
                aria-busy={revokeMutation.isPending}
                aria-label={`Revoke delegation for ${name}`}
                className="p-1 text-muted-foreground hover:text-acr-neg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}