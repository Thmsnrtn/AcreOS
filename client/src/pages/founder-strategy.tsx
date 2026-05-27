/**
 * FounderStrategyPage — review and approve strategic proposals.
 *
 * Two sections:
 *   1. This month's synthesized moves (what the synthesis pass picked)
 *   2. All weekly raw proposals (to see what the system is thinking
 *      before the monthly synthesis)
 *
 * Approve → marks the proposal approved. Approved proposals become
 * the founder-sanctioned direction and feed the next Founder Letter.
 * Reject → marks dead; synthesis pass won't re-pick similar patterns.
 */

import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Lightbulb, Check, X, PlayCircle, RefreshCw } from "lucide-react";
import { relative, usd } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";

interface StrategicProposal {
  id: number;
  proposedBy: string;
  weekKey: string;
  monthKey: string | null;
  title: string;
  rationale: string;
  estimatedImpactCents: number | null;
  confidence: number;
  category: string;
  status: "proposed" | "synthesized" | "approved" | "rejected" | "executed" | "deferred";
  founderFeedback: string | null;
  createdAt: string;
}

// Strategic category → semantic --acr-* tone (Tier 1 pattern). Categories
// don't map 1:1 to status semantics, but we project them onto the available
// tones: revenue→pos, ops→warn (operational alerts), risk→neg, retention/
// product→brand/accent (informational categorization).
const CATEGORY_COLOR: Record<string, string> = {
  revenue: "bg-acr-pos-soft text-acr-pos border-transparent",
  retention: "bg-acr-brand-soft text-acr-brand border-transparent",
  product: "bg-acr-accent/10 text-acr-accent border-transparent",
  ops: "bg-acr-warn-soft text-acr-warn border-transparent",
  risk: "bg-acr-neg-soft text-acr-neg border-transparent",
};

export default function FounderStrategyPage() {
  useDocumentTitle("Strategic proposals");
  const { data, isLoading, isError, refetch } = useQuery<{ proposals: StrategicProposal[] }>({
    queryKey: ["/api/founder/intelligence/strategic-proposals"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const runWeekly = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/intelligence/strategic-proposals/run-weekly", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/strategic-proposals"] });
      toast({ title: "Weekly run complete" });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't run weekly proposals",
        description: `${e.message}. The proposal queue is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const runSynthesis = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/intelligence/strategic-proposals/run-synthesis", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/strategic-proposals"] });
      toast({ title: "Synthesis complete" });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't run synthesis",
        description: `${e.message}. Synthesized moves are unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const resolve = useMutation({
    mutationFn: async (args: { id: number; action: "approve" | "reject"; feedback?: string }) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/strategic-proposals/${args.id}/${args.action}`, {
        feedback: args.feedback,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/strategic-proposals"] });
      toast({ title: "Updated" });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't update proposal",
        description: `${e.message}. The proposal still has its previous status — try again.`,
        variant: "destructive",
      }),
  });

  const proposals = data?.proposals ?? [];
  const synthesized = proposals.filter((p) => p.status === "synthesized");
  const weekly = proposals.filter((p) => p.status === "proposed");

  // Bulk-clear: defer every open weekly proposal in one click. Skips the
  // synthesized list so the founder can't accidentally clear the high-signal
  // monthly slate. Uses the existing reject endpoint with feedback="defer".
  const bulkDeferWeekly = useMutation({
    mutationFn: async () => {
      const ids = weekly.map((p) => p.id);
      const results = await Promise.allSettled(
        ids.map((id) =>
          apiRequest("POST", `/api/founder/intelligence/strategic-proposals/${id}/reject`, {
            feedback: "bulk-deferred from founder queue",
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: ids.length, failed };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/strategic-proposals"] });
      toast({
        title: r.failed === 0 ? `Cleared ${r.total} weekly proposals` : `Cleared ${r.total - r.failed} of ${r.total}`,
        description: r.failed > 0 ? `${r.failed} couldn't be cleared — try again.` : undefined,
        variant: r.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't bulk-clear",
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <PageShell label="Strategic Proposals">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Strategic proposals"
          icon={<Lightbulb className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="The proactive layer. Each week agents propose moves in their domain. On the 1st, a synthesis pass picks the top 3-5 recurring signals and surfaces them for your approval. Approved moves become the sanctioned direction."
          actions={
            <>
              <Button
                onClick={() => runWeekly.mutate()}
                disabled={runWeekly.isPending}
                variant="outline"
                size="sm"
                aria-label="Run weekly proposal pass now"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${runWeekly.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                {runWeekly.isPending ? "Running…" : "Run weekly"}
              </Button>
              <Button
                onClick={() => runSynthesis.mutate()}
                disabled={runSynthesis.isPending}
                size="sm"
                aria-label="Run monthly synthesis now"
              >
                <PlayCircle className="h-4 w-4 mr-1" aria-hidden="true" />
                {runSynthesis.isPending ? "Synthesizing…" : "Run synthesis"}
              </Button>
            </>
          }
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">This month's synthesized moves (<span className="tabular-nums">{synthesized.length}</span>)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-live="polite">
                <span className="sr-only">Loading synthesized moves…</span>
                <Skeleton className="h-16 w-full" />
              </div>
            ) : isError ? (
              <p className="text-sm text-acr-neg" role="alert">
                Couldn't load proposals. The proposal queue is unchanged —{" "}
                <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => refetch()}
                >
                  try again
                </button>.
              </p>
            ) : synthesized.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No synthesized moves yet. Either the synthesis hasn't run, or the pass decided this
                month is quiet and chose "hold steady."
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Synthesized strategic moves">
                {synthesized.map((p) => (
                  <li key={p.id}>
                    <ProposalRow
                      proposal={p}
                      onApprove={(feedback) => resolve.mutate({ id: p.id, action: "approve", feedback })}
                      onReject={(feedback) => resolve.mutate({ id: p.id, action: "reject", feedback })}
                      busy={resolve.isPending}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Weekly raw proposals (<span className="tabular-nums">{weekly.length}</span>)</CardTitle>
            {weekly.length > 0 && (
              <Button
                onClick={() => {
                  if (window.confirm(`Defer ${weekly.length} weekly proposal${weekly.length === 1 ? "" : "s"}? This rejects them all in bulk.`)) {
                    bulkDeferWeekly.mutate();
                  }
                }}
                disabled={bulkDeferWeekly.isPending}
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                aria-label={`Clear all ${weekly.length} weekly proposals`}
                data-testid="button-bulk-defer-weekly-proposals"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                {bulkDeferWeekly.isPending ? "Clearing…" : `Clear all (${weekly.length})`}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {weekly.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No weekly proposals"
                description="Weekly proposals fire Sundays at 00:00 UTC. Run one now from the button above to seed the queue."
              />
            ) : (
              <ul className="space-y-2" aria-label="Weekly raw strategic proposals">
                {weekly.map((p) => (
                  <li key={p.id}>
                    <ProposalRow
                      proposal={p}
                      onApprove={(feedback) => resolve.mutate({ id: p.id, action: "approve", feedback })}
                      onReject={(feedback) => resolve.mutate({ id: p.id, action: "reject", feedback })}
                      busy={resolve.isPending}
                      compact
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function ProposalRow({
  proposal,
  onApprove,
  onReject,
  busy,
  compact = false,
}: {
  proposal: StrategicProposal;
  onApprove: (feedback?: string) => void;
  onReject: (feedback?: string) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const feedbackId = useId();
  const [feedback, setFeedback] = useState("");
  const catColor = CATEGORY_COLOR[proposal.category] ?? "bg-muted text-muted-foreground";

  return (
    <div className={`border border-border rounded-card ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="secondary" className="text-[10px]">
              {proposal.proposedBy}
            </Badge>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${catColor}`}
              aria-label={`Category: ${proposal.category}`}
            >
              {proposal.category}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{proposal.confidence}% confidence</span>
            {proposal.estimatedImpactCents != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums" aria-label={`Estimated impact ${usd(proposal.estimatedImpactCents / 100)}`}>
                {usd(proposal.estimatedImpactCents / 100)} impact
              </span>
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {relative(proposal.createdAt)}
            </span>
          </div>
          <h3 className={`${compact ? "text-sm" : "text-base"} font-semibold text-foreground mb-1`}>
            {proposal.title}
          </h3>
          <p className={`${compact ? "text-xs" : "text-sm"} text-foreground/80 leading-relaxed`}>
            {proposal.rationale}
          </p>
        </div>
      </div>
      {!compact && (
        <>
          <Label htmlFor={feedbackId} className="sr-only">Feedback for {proposal.title}</Label>
          <Textarea
            id={feedbackId}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional feedback (saved with the decision)…"
            className="text-xs h-16 mt-2"
          />
        </>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <Button
          size="sm"
          onClick={() => onApprove(feedback || undefined)}
          disabled={busy}
          aria-label={`Approve "${proposal.title}"`}
        >
          <Check className="h-4 w-4 mr-1" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReject(feedback || undefined)}
          disabled={busy}
          aria-label={`Reject "${proposal.title}"`}
        >
          <X className="h-4 w-4 mr-1" aria-hidden="true" />
          Reject
        </Button>
      </div>
    </div>
  );
}
