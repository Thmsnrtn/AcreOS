/**
 * Pillar R — Trust graduation.
 *
 * Shows every (agent, category) row with its current tier, streaks,
 * lifetime acceptance/retract counts, and founder-override flag.
 * Inline buttons flip the tier or set/clear an override flag.
 *
 * F1 slice 4: no longer its own route. This is the "Trust graduation" tab of
 * the agents hub (/founder/admin/agents?tab=trust) — where you go when The
 * Letter surfaces a tier_promotion you want to fast-forward or a
 * tier_demotion you want to reverse.
 */
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Lock, Unlock, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { formatDate } from "@/lib/format";

type Tier = "manual" | "notify_only" | "silent" | "suspended";
type Override = "force_silent" | "freeze_manual" | null;

interface GraduationRow {
  id: number;
  agentCodename: string;
  actionCategory: string;
  graduationTier: Tier;
  consecutiveAccepted: number;
  consecutiveRetracted: number;
  totalAccepted: number;
  totalRetracted: number;
  founderOverride: Override;
  tierChangedAt: string;
}

interface GraduationResponse {
  generatedAt: string;
  rows: GraduationRow[];
}

const TIER_BADGE: Record<Tier, { label: string; className: string }> = {
  silent: { label: "silent", className: "bg-acr-pos-soft text-acr-pos border-transparent" },
  notify_only: { label: "notify_only", className: "bg-acr-brand-soft text-acr-brand border-transparent" },
  manual: { label: "manual", className: "bg-muted text-muted-foreground border-transparent" },
  suspended: { label: "suspended", className: "bg-acr-neg-soft text-acr-neg border-transparent" },
};

/** Shell-less body — rendered as the "Trust graduation" tab of the agents hub
 *  (/founder/admin/agents?tab=trust, F1 slice 4). */
export function TrustGraduationContent() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery<GraduationResponse>({
    queryKey: ["/api/founder/graduation"],
    staleTime: 30_000,
  });

  const overrideMut = useMutation({
    mutationFn: async (body: { agentCodename: string; actionCategory: string; tier: Tier; override: Override }) => {
      return apiRequest("POST", "/api/founder/graduation/override", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/graduation"] });
      toast({ title: "Tier updated", description: "The graduation tier has been changed." });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to update tier", description: String(err?.message ?? err) });
    },
  });

  const grouped = useMemo(() => {
    const out: Record<string, GraduationRow[]> = {};
    for (const row of data?.rows ?? []) {
      (out[row.agentCodename] ??= []).push(row);
    }
    return out;
  }, [data]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-acr-brand" aria-hidden="true" />
            Trust graduation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-(agent, category) tier ladder. Override forces a tier; without an override flag,
            agents auto-promote (manual → notify_only after 10, → silent after 50) and auto-demote
            on retracts.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load the graduation table.{" "}
              <button type="button" className="underline hover:no-underline" onClick={() => refetch()}>
                try again
              </button>
            </CardContent>
          </Card>
        ) : Object.keys(grouped).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No (agent, category) graduation rows yet. Rows are created on the agent's first
              acceptance — once executor or support-brain auto-resolves anything.
            </CardContent>
          </Card>
        ) : (
          Object.entries(grouped).map(([agent, rows]) => (
            <Card key={agent}>
              <CardHeader>
                <CardTitle className="text-base">{agent}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 flex-wrap rounded-card border p-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{row.actionCategory}</span>
                        <Badge className={TIER_BADGE[row.graduationTier].className}>
                          {TIER_BADGE[row.graduationTier].label}
                        </Badge>
                        {row.founderOverride && (
                          <Badge variant="outline" className="text-xs">
                            <Lock className="w-3 h-3 mr-1" aria-hidden="true" />
                            {row.founderOverride}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums flex flex-wrap gap-3">
                        <span>{row.consecutiveAccepted} consecutive ✓</span>
                        <span>{row.consecutiveRetracted} consecutive ✗</span>
                        <span>{row.totalAccepted} lifetime ✓</span>
                        <span>{row.totalRetracted} lifetime ✗</span>
                        <span>last changed {formatDate(row.tierChangedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={overrideMut.isPending || row.graduationTier === "silent"}
                        onClick={() =>
                          overrideMut.mutate({
                            agentCodename: row.agentCodename,
                            actionCategory: row.actionCategory,
                            tier: "silent",
                            override: "force_silent",
                          })
                        }
                      >
                        <ArrowUpRight className="w-3 h-3 mr-1" aria-hidden="true" />
                        Force silent
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={overrideMut.isPending || row.founderOverride === "freeze_manual"}
                        onClick={() =>
                          overrideMut.mutate({
                            agentCodename: row.agentCodename,
                            actionCategory: row.actionCategory,
                            tier: "manual",
                            override: "freeze_manual",
                          })
                        }
                      >
                        <Lock className="w-3 h-3 mr-1" aria-hidden="true" />
                        Freeze manual
                      </Button>
                      {row.founderOverride && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={overrideMut.isPending}
                          onClick={() =>
                            overrideMut.mutate({
                              agentCodename: row.agentCodename,
                              actionCategory: row.actionCategory,
                              tier: row.graduationTier,
                              override: null,
                            })
                          }
                        >
                          <Unlock className="w-3 h-3 mr-1" aria-hidden="true" />
                          Clear override
                        </Button>
                      )}
                      {row.graduationTier === "suspended" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={overrideMut.isPending}
                          onClick={() =>
                            overrideMut.mutate({
                              agentCodename: row.agentCodename,
                              actionCategory: row.actionCategory,
                              tier: "manual",
                              override: null,
                            })
                          }
                        >
                          <ShieldAlert className="w-3 h-3 mr-1" aria-hidden="true" />
                          Un-suspend
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
    </div>
  );
}
