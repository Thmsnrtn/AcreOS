/**
 * FounderPromptEvolutionsPage — review + approve prompt revisions
 * proposed by the monthly meta-agent.
 *
 * Each row shows: which agent, why the meta-agent thought this
 * needed revising (performance data snapshot), the revised prompt,
 * and a side-by-side of what changed in the reasoning field.
 *
 * Approve → applies the revision to the live agent prompt.
 * Reject → marks the proposal dead; the meta-agent won't re-file
 * it unless the underlying performance signal reappears.
 */

import { useState, useId } from "react";
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
import { Brain, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { relative } from "@/lib/format";
import { PromptDiffViewer } from "@/components/prompt-diff-viewer";
import { PageHeader } from "@/components/ui/page-header";

interface EvolutionProposal {
  id: number;
  agentCodename: string;
  currentPromptHash: string;
  proposedPrompt: string;
  proposalReason: string;
  performanceDataBefore: Record<string, any> | null;
  status: string;
  createdAt: string;
}

export default function FounderPromptEvolutionsPage() {
  useDocumentTitle("Prompt evolutions");
  const { data, isLoading, isError, refetch } = useQuery<{ proposals: EvolutionProposal[] }>({
    queryKey: ["/api/founder/intelligence/prompt-evolutions"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const approve = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/prompt-evolutions/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/prompt-evolutions"] });
      toast({ title: "Applied", description: "The agent's prompt has been updated." });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't apply revision",
        description: `${e.message}. The agent is still running its previous prompt — try again or reject this proposal.`,
        variant: "destructive",
      }),
  });

  const reject = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/prompt-evolutions/${id}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/prompt-evolutions"] });
      toast({ title: "Rejected" });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't reject proposal",
        description: `${e.message}. The proposal is still pending — try again.`,
        variant: "destructive",
      }),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/prompt-evolutions/run-now", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/prompt-evolutions"] });
      toast({ title: "Meta-agent ran", description: "New proposals (if any) are now in the queue." });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't run meta-agent",
        description: `${e.message}. The proposal queue is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const proposals = data?.proposals ?? [];

  return (
    <PageShell label="Prompt Evolutions">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Prompt evolutions"
          icon={<Brain className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="Revisions the monthly meta-agent has proposed based on per-agent performance data (outcome scores, founder overrides, calibration). Approving applies the new prompt immediately. Rejecting marks the proposal dead."
          actions={
            <Button
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              variant="outline"
              size="sm"
              data-testid="run-meta-now"
              aria-label="Run the prompt-evolution meta-agent now"
            >
              {runNow.isPending ? "Running…" : "Run meta-agent now"}
            </Button>
          }
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8" role="status" aria-live="polite">
              <span className="sr-only">Loading prompt-evolution proposals…</span>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load proposals. The proposal queue is unchanged —{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>.
            </CardContent>
          </Card>
        ) : proposals.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="No pending proposals"
            description="The meta-agent runs on the 1st of each month. You can also run it on demand from the button above."
          />
        ) : (
          <ul className="space-y-6" aria-label="Pending prompt-evolution proposals">
            {proposals.map((p) => (
              <li key={p.id}>
                <EvolutionCard
                  proposal={p}
                  onApprove={() => approve.mutate(p.id)}
                  onReject={() => reject.mutate(p.id)}
                  busy={approve.isPending || reject.isPending}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}

function EvolutionCard({
  proposal,
  onApprove,
  onReject,
  busy,
}: {
  proposal: EvolutionProposal;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const before = proposal.performanceDataBefore ?? {};

  const { data: detail } = useQuery<{ proposal: EvolutionProposal; currentPrompt: string | null }>({
    queryKey: [`/api/founder/intelligence/prompt-evolutions/${proposal.id}`],
    enabled: expanded,
    staleTime: 60_000,
  });
  const currentPrompt = detail?.currentPrompt ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary">{proposal.agentCodename}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {relative(proposal.createdAt)}
              </span>
            </div>
            <CardTitle className="text-base font-medium">{proposal.proposalReason}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={onApprove}
              disabled={busy}
              size="sm"
              data-testid={`approve-evolution-${proposal.id}`}
              aria-label={`Approve revision for ${proposal.agentCodename}`}
            >
              <Check className="h-4 w-4 mr-1" aria-hidden="true" />
              Approve
            </Button>
            <Button
              onClick={onReject}
              disabled={busy}
              variant="outline"
              size="sm"
              data-testid={`reject-evolution-${proposal.id}`}
              aria-label={`Reject revision for ${proposal.agentCodename}`}
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              Reject
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.keys(before).length > 0 && (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {Object.entries(before).slice(0, 8).map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium text-foreground tabular-nums">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground min-h-9"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? "Hide" : "Show"} prompt diff for ${proposal.agentCodename}`}
        >
          {expanded ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
          {expanded ? "Hide diff" : "Show diff"}
        </button>
        {expanded && (
          <div id={detailsId}>
            {currentPrompt ? (
              <PromptDiffViewer current={currentPrompt} proposed={proposal.proposedPrompt} />
            ) : (
              <pre className="bg-muted/50 p-3 rounded text-caption whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                {proposal.proposedPrompt}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
