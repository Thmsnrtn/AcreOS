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

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, Check, X, PlayCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

const CATEGORY_COLOR: Record<string, string> = {
  revenue: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  retention: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  product: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  ops: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  risk: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function FounderStrategyPage() {
  const { data, isLoading, isError } = useQuery<{ proposals: StrategicProposal[] }>({
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
  });

  const runSynthesis = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/intelligence/strategic-proposals/run-synthesis", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/strategic-proposals"] });
      toast({ title: "Synthesis complete" });
    },
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
  });

  const proposals = data?.proposals ?? [];
  const synthesized = proposals.filter((p) => p.status === "synthesized");
  const weekly = proposals.filter((p) => p.status === "proposed");

  return (
    <PageShell label="Strategic Proposals">
      <div className="space-y-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-6 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-muted-foreground" />
                Strategic proposals
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The proactive layer. Each week agents propose moves in their domain. On the 1st, a
                synthesis pass picks the top 3-5 recurring signals and surfaces them for your
                approval. Approved moves become the sanctioned direction.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => runWeekly.mutate()}
                disabled={runWeekly.isPending}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {runWeekly.isPending ? "Running…" : "Run weekly"}
              </Button>
              <Button
                onClick={() => runSynthesis.mutate()}
                disabled={runSynthesis.isPending}
                size="sm"
              >
                <PlayCircle className="h-4 w-4 mr-1" />
                {runSynthesis.isPending ? "Synthesizing…" : "Run synthesis"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Synthesized (the picks) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">This month's synthesized moves ({synthesized.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : isError ? (
              <p className="text-sm text-red-600">Could not load.</p>
            ) : synthesized.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No synthesized moves yet. Either the synthesis hasn't run, or the pass decided this
                month is quiet and chose "hold steady."
              </p>
            ) : (
              synthesized.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onApprove={(feedback) => resolve.mutate({ id: p.id, action: "approve", feedback })}
                  onReject={(feedback) => resolve.mutate({ id: p.id, action: "reject", feedback })}
                  busy={resolve.isPending}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Weekly raw */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Weekly raw proposals ({weekly.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekly.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No weekly proposals"
                description="Weekly proposals fire Sundays at 00:00 UTC. Run one now from the button above to seed the queue."
              />
            ) : (
              weekly.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onApprove={(feedback) => resolve.mutate({ id: p.id, action: "approve", feedback })}
                  onReject={(feedback) => resolve.mutate({ id: p.id, action: "reject", feedback })}
                  busy={resolve.isPending}
                  compact
                />
              ))
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
  const [feedback, setFeedback] = useState("");
  const catColor = CATEGORY_COLOR[proposal.category] ?? "bg-muted text-muted-foreground";

  return (
    <div className={`border border-border rounded-lg ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="secondary" className="text-[10px]">
              {proposal.proposedBy}
            </Badge>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${catColor}`}>
              {proposal.category}
            </span>
            <span className="text-[10px] text-muted-foreground">{proposal.confidence}% confidence</span>
            {proposal.estimatedImpactCents != null && (
              <span className="text-[10px] text-muted-foreground">
                ${(proposal.estimatedImpactCents / 100).toLocaleString()} impact
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(proposal.createdAt), { addSuffix: true })}
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
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Optional feedback (saved with the decision)…"
          className="text-xs h-16 mt-2"
          aria-label="Feedback"
        />
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <Button size="sm" onClick={() => onApprove(feedback || undefined)} disabled={busy}>
          <Check className="h-4 w-4 mr-1" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onReject(feedback || undefined)} disabled={busy}>
          <X className="h-4 w-4 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}
