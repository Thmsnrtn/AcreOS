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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { TrendingUp, Check, X, PlayCircle, ArrowUpRight } from "lucide-react";
import { dollars, relative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";

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
  proposed: "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink",
  approved: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent",
  offered: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent",
  converted: "bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft/30 dark:text-acr-pos-soft-ink",
  declined: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
};

export default function FounderExpansionPage() {
  useDocumentTitle("Expansion radar");
  const { data, isLoading, isError, refetch } = useQuery<{ candidates: Candidate[] }>({
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
    onError: (e: Error) =>
      toast({
        title: "Couldn't run scan",
        description: `${e.message}. The candidate list is unchanged — try again.`,
        variant: "destructive",
      }),
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
    onError: (e: Error) =>
      toast({
        title: "Couldn't update candidate",
        description: `${e.message}. The candidate still has its previous status — try again.`,
        variant: "destructive",
      }),
  });

  const candidates = data?.candidates ?? [];
  const active = candidates.filter((c) => c.status === "proposed");
  const resolved = candidates.filter((c) => c.status !== "proposed");

  return (
    <PageShell label="Expansion Radar">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Expansion radar"
          icon={<TrendingUp className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="Weekly scan for Land Investors ready to upgrade. Scored on tenure, lead/deal growth, payment cadence, engagement. Top 5 candidates surface here for your approval. Approving queues a tier-upgrade offer from Forge."
          actions={
            <Button
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              size="sm"
              variant="outline"
              aria-label="Run expansion scan now"
            >
              <PlayCircle className="h-4 w-4 mr-1" aria-hidden="true" />
              {runNow.isPending ? "Scanning…" : "Run scan now"}
            </Button>
          }
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active candidates (<span className="tabular-nums">{active.length}</span>)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-live="polite">
                <span className="sr-only">Loading candidates…</span>
                <Skeleton className="h-24 w-full" />
              </div>
            ) : isError ? (
              <p className="text-sm text-acr-neg" role="alert">
                Couldn't load candidates. The expansion queue is unchanged —{" "}
                <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => refetch()}
                >
                  try again
                </button>.
              </p>
            ) : active.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                headline="No candidates this week"
                subtitle="The radar runs Mondays 08:00 UTC. Run now to scan immediately."
                // TODO(cta): expansion candidates are system-generated by the radar cron; "Run now" button is above
                cta={{ label: "", _noOp: true }}
              />
            ) : (
              <ul className="space-y-3" aria-label="Active expansion candidates">
                {active.map((c) => (
                  <li key={c.id}>
                    <CandidateRow
                      candidate={c}
                      onApprove={() => resolve.mutate({ id: c.id, status: "approved" })}
                      onReject={() => resolve.mutate({ id: c.id, status: "rejected" })}
                      onMarkOffered={() => resolve.mutate({ id: c.id, status: "offered" })}
                      busy={resolve.isPending}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {resolved.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">History (<span className="tabular-nums">{resolved.length}</span>)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2" aria-label="Resolved expansion candidates">
                {resolved.map((c) => (
                  <li key={c.id}>
                    <HistoryRow
                      candidate={c}
                      onMarkConverted={() => resolve.mutate({ id: c.id, status: "converted" })}
                      onMarkDeclined={() => resolve.mutate({ id: c.id, status: "declined" })}
                      busy={resolve.isPending}
                    />
                  </li>
                ))}
              </ul>
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
  const orgLabel = candidate.orgName ?? `Org #${candidate.organizationId}`;
  return (
    <div className="border border-border rounded-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-micro font-semibold text-foreground tabular-nums" aria-label={`Score ${candidate.score} of 100`}>
              Score {candidate.score}/100
            </span>
            <Badge variant="outline" className="text-micro">
              {candidate.currentTier} → {candidate.proposedTier}
            </Badge>
            {lift > 0 && (
              <Badge variant="secondary" className="text-micro tabular-nums" aria-label={`Estimated lift ${dollars(lift, { showSign: true })} per month`}>
                {dollars(lift, { showSign: true })}/mo
              </Badge>
            )}
            <span className="text-micro text-muted-foreground tabular-nums">
              {relative(candidate.createdAt)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{orgLabel}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{candidate.reasoning}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <Button
          size="sm"
          onClick={onApprove}
          disabled={busy}
          aria-label={`Approve upgrade for ${orgLabel}`}
        >
          <Check className="h-4 w-4 mr-1" aria-hidden="true" />
          Approve upgrade
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onMarkOffered}
          disabled={busy}
          aria-label={`Mark ${orgLabel} as already offered`}
        >
          <ArrowUpRight className="h-4 w-4 mr-1" aria-hidden="true" />
          Mark already offered
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          disabled={busy}
          aria-label={`Reject expansion for ${orgLabel}`}
        >
          <X className="h-4 w-4 mr-1" aria-hidden="true" />
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
  const orgLabel = candidate.orgName ?? `Org #${candidate.organizationId}`;
  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span
            className={`text-micro px-1.5 py-0.5 rounded capitalize ${STATUS_COLOR[candidate.status]}`}
            aria-label={`Status: ${candidate.status}`}
          >
            {candidate.status}
          </span>
          <span className="text-caption text-muted-foreground">
            {orgLabel} · score <span className="tabular-nums">{candidate.score}</span>
          </span>
        </div>
        <p className="text-xs text-foreground/80">
          {candidate.currentTier} → {candidate.proposedTier}
        </p>
      </div>
      {canFollowThrough && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onMarkConverted}
            disabled={busy}
            aria-label={`Mark ${orgLabel} as converted`}
          >
            Converted
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onMarkDeclined}
            disabled={busy}
            aria-label={`Mark ${orgLabel} as declined`}
          >
            Declined
          </Button>
        </div>
      )}
    </div>
  );
}
