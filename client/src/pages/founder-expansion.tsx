/**
 * FounderExpansionPage — the upsell radar.
 *
 * Weekly-computed list of customers most ready to upgrade, each with
 * a score, concrete signals, and a proposed tier move. Founder approves
 * → Forge queues an upgrade offer (email + in-app nudge, sim-wrapped
 * when SIMULATION_MODE is on).
 *
 * This is the growth side of the ledger. Sophie plays defense (churn).
 * Onboarding autonomy handles activation. This page is how the
 * platform plays offense.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Check, X, PlayCircle, ArrowUpRight } from "lucide-react";
import { dollars, relative } from "@/lib/format";

interface Candidate {
  id: number;
  organizationId: number;
  weekKey: string;
  currentTier: string;
  proposedTier: string;
  score: number;
  reasoning: string;
  estimatedMrrLiftCents: number | null;
  status: "proposed" | "approved" | "rejected" | "offered" | "converted" | "declined";
  founderNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  orgName: string | null;
}

const STATUS_COLOR: Record<Candidate["status"], string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  offered: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  converted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  declined: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
};

export default function FounderExpansionPage() {
  const { data, isLoading, isError } = useQuery<{ candidates: Candidate[] }>({
    queryKey: ["/api/founder/intelligence/expansion"],
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const runNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/intelligence/expansion/run-now", {})).json(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/expansion"] });
      toast({ title: "Scan complete", description: `${r.qualifiers ?? 0} qualifiers this week.` });
    },
  });

  const resolve = useMutation({
    mutationFn: async (args: { id: number; status: Candidate["status"] }) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/expansion/${args.id}/resolve`, {
        status: args.status,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/expansion"] });
      toast({ title: "Updated" });
    },
  });

  const candidates = data?.candidates ?? [];
  const active = candidates.filter((c) => c.status === "proposed");
  const resolved = candidates.filter((c) => c.status !== "proposed");

  return (
    <PageShell label="Expansion Radar">
      <div className="space-y-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-6 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                Expansion radar
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Weekly scan for Land Investors ready to upgrade. Scored on tenure, lead/deal growth,
                payment cadence, engagement. Top 5 candidates surface here for your approval.
                Approving queues a tier-upgrade offer from Forge.
              </p>
            </div>
            <Button onClick={() => runNow.mutate()} disabled={runNow.isPending} size="sm" variant="outline">
              <PlayCircle className="h-4 w-4 mr-1" />
              {runNow.isPending ? "Scanning…" : "Run scan now"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active candidates ({active.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : isError ? (
              <p className="text-sm text-red-600">Could not load candidates.</p>
            ) : active.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No candidates this week"
                description="The radar runs Mondays 08:00 UTC. Run now to scan immediately."
              />
            ) : (
              <div className="space-y-3">
                {active.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    onApprove={() => resolve.mutate({ id: c.id, status: "approved" })}
                    onReject={() => resolve.mutate({ id: c.id, status: "rejected" })}
                    onMarkOffered={() => resolve.mutate({ id: c.id, status: "offered" })}
                    busy={resolve.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {resolved.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">History ({resolved.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {resolved.map((c) => (
                <HistoryRow key={c.id} candidate={c} onMarkConverted={() => resolve.mutate({ id: c.id, status: "converted" })} onMarkDeclined={() => resolve.mutate({ id: c.id, status: "declined" })} busy={resolve.isPending} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function CandidateRow({
  candidate,
  onApprove,
  onReject,
  onMarkOffered,
  busy,
}: {
  candidate: Candidate;
  onApprove: () => void;
  onReject: () => void;
  onMarkOffered: () => void;
  busy: boolean;
}) {
  const lift = candidate.estimatedMrrLiftCents ?? 0;
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-semibold text-foreground">
              Score {candidate.score}/100
            </span>
            <Badge variant="outline" className="text-[10px]">
              {candidate.currentTier} → {candidate.proposedTier}
            </Badge>
            {lift > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {dollars(lift, { showSign: true })}/mo
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground">
              {relative(candidate.createdAt)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {candidate.orgName ?? `Org #${candidate.organizationId}`}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{candidate.reasoning}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <Button size="sm" onClick={onApprove} disabled={busy}>
          <Check className="h-4 w-4 mr-1" />
          Approve upgrade
        </Button>
        <Button size="sm" variant="outline" onClick={onMarkOffered} disabled={busy}>
          <ArrowUpRight className="h-4 w-4 mr-1" />
          Mark already offered
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
          <X className="h-4 w-4 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}

function HistoryRow({
  candidate,
  onMarkConverted,
  onMarkDeclined,
  busy,
}: {
  candidate: Candidate;
  onMarkConverted: () => void;
  onMarkDeclined: () => void;
  busy: boolean;
}) {
  const canFollowThrough = candidate.status === "approved" || candidate.status === "offered";
  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[candidate.status]}`}>
            {candidate.status}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {candidate.orgName ?? `Org #${candidate.organizationId}`} · score {candidate.score}
          </span>
        </div>
        <p className="text-xs text-foreground/80">
          {candidate.currentTier} → {candidate.proposedTier}
        </p>
      </div>
      {canFollowThrough && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onMarkConverted} disabled={busy}>
            Converted
          </Button>
          <Button size="sm" variant="ghost" onClick={onMarkDeclined} disabled={busy}>
            Declined
          </Button>
        </div>
      )}
    </div>
  );
}
