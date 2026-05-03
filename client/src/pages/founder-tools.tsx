/**
 * FounderToolsPage — capability-growth queue.
 *
 * Shows tool proposals from agents and the strategic-synthesis pass.
 * Each row describes a missing integration, data source, capability,
 * or rubric — what the team can't do today, what becomes possible
 * once shipped, and how complex it looks.
 *
 * Founder approves, rejects, or moves to 'building' (engineering
 * backlog). Approved tools become the source of truth for the
 * next quarter's roadmap — the system is effectively telling the
 * founder what it needs to do its job better.
 */

import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FounderPageShell } from "@/components/founder/founder-page-shell";
import "./today.css";
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
import { Wrench, Check, X, Clock, Rocket } from "lucide-react";
import { relative, usd } from "@/lib/format";

interface ToolProposalRow {
  id: number;
  proposedBy: string;
  title: string;
  description: string;
  category: "integration" | "data_source" | "capability" | "rubric";
  capabilityGap: string;
  expectedBenefit: string;
  estimatedComplexity: "low" | "medium" | "high";
  estimatedImpactCents: number | null;
  status: "proposed" | "approved" | "rejected" | "building" | "shipped";
  founderNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const CATEGORY_LABEL: Record<ToolProposalRow["category"], string> = {
  integration: "Integration",
  data_source: "Data source",
  capability: "Capability",
  rubric: "Rubric",
};

const COMPLEXITY_COLOR: Record<string, string> = {
  low: "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos",
  medium: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn",
  high: "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg",
};

export default function FounderToolsPage() {
  useDocumentTitle("Capability growth queue");
  const { data, isLoading, isError, refetch } = useQuery<{ proposals: ToolProposalRow[] }>({
    queryKey: ["/api/founder/intelligence/tool-proposals"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const resolveMutation = useMutation({
    mutationFn: async (args: {
      id: number;
      status: "approved" | "rejected" | "building" | "shipped";
      notes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/tool-proposals/${args.id}/resolve`, {
        status: args.status,
        notes: args.notes,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/tool-proposals"] });
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
  const byStatus: Record<string, ToolProposalRow[]> = { proposed: [], approved: [], building: [], shipped: [], rejected: [] };
  for (const p of proposals) byStatus[p.status]?.push(p);

  return (
    <FounderPageShell
      eyebrow="Founder · tools"
      title="Capability growth queue"
      titleSoft={`${proposals.length} proposal${proposals.length === 1 ? "" : "s"} in flight.`}
      pageTitle="Tool Proposals"
    >
      <div className="space-y-6 max-w-5xl mx-auto">
        <p className="text-sm text-muted-foreground">
          What the system needs to do its job better. Proposals come from
          agents and from the monthly strategic synthesis. Approving a
          proposal doesn&rsquo;t build it &mdash; it moves it onto the
          engineering backlog. Mark it &ldquo;building&rdquo; when you start,
          &ldquo;shipped&rdquo; when it&rsquo;s live.
        </p>

        {isLoading ? (
          <Card>
            <CardContent className="p-8" role="status" aria-live="polite">
              <span className="sr-only">Loading tool proposals…</span>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load tool proposals. The proposal queue is unchanged —{" "}
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
            icon={Wrench}
            title="No proposals yet"
            description="The strategic synthesis will surface capability gaps automatically when it detects recurring 'I couldn't act because I lack X' signals. You can also manually seed proposals from the agent chat."
          />
        ) : (
          <>
            {(["proposed", "approved", "building", "shipped", "rejected"] as const).map((status) => {
              const rows = byStatus[status];
              if (rows.length === 0) return null;
              const statusLabel = status[0].toUpperCase() + status.slice(1);
              return (
                <Card key={status}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      {status === "proposed" && <Clock className="h-4 w-4 text-acr-warn" aria-hidden="true" />}
                      {status === "approved" && <Check className="h-4 w-4 text-acr-pos" aria-hidden="true" />}
                      {status === "building" && <Clock className="h-4 w-4 text-acr-accent" aria-hidden="true" />}
                      {status === "shipped" && <Rocket className="h-4 w-4 text-acr-pos" aria-hidden="true" />}
                      {status === "rejected" && <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      {statusLabel} (<span className="tabular-nums">{rows.length}</span>)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3" aria-label={`${statusLabel} tool proposals`}>
                      {rows.map((p) => (
                        <li key={p.id}>
                          <ToolProposalCard
                            row={p}
                            onResolve={(newStatus, notes) =>
                              resolveMutation.mutate({ id: p.id, status: newStatus, notes })
                            }
                            isSubmitting={resolveMutation.isPending}
                          />
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </FounderPageShell>
  );
}

function ToolProposalCard({
  row,
  onResolve,
  isSubmitting,
}: {
  row: ToolProposalRow;
  onResolve: (status: "approved" | "rejected" | "building" | "shipped", notes?: string) => void;
  isSubmitting: boolean;
}) {
  const notesId = useId();
  const [notes, setNotes] = useState(row.founderNotes ?? "");
  const showActions = row.status === "proposed" || row.status === "approved" || row.status === "building";

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="secondary" className="text-[10px]">{row.proposedBy}</Badge>
            <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[row.category]}</Badge>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${COMPLEXITY_COLOR[row.estimatedComplexity]}`}
              aria-label={`Estimated complexity: ${row.estimatedComplexity}`}
            >
              {row.estimatedComplexity}
            </span>
            {row.estimatedImpactCents != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums" aria-label={`Estimated impact ${usd(row.estimatedImpactCents / 100)}`}>
                {usd(row.estimatedImpactCents / 100)} impact
              </span>
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {relative(row.createdAt)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{row.title}</h3>
          <p className="text-xs text-foreground/80 mb-2 leading-relaxed">{row.description}</p>
          <dl className="space-y-1 text-[11px] text-muted-foreground">
            <div>
              <dt className="font-medium text-foreground/80 inline">Gap: </dt>
              <dd className="inline">{row.capabilityGap}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground/80 inline">Benefit: </dt>
              <dd className="inline">{row.expectedBenefit}</dd>
            </div>
          </dl>
        </div>
      </div>
      {showActions && (
        <div className="mt-3 space-y-2">
          <Label htmlFor={notesId} className="sr-only">Founder notes for {row.title}</Label>
          <Textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (shown when you move this forward)…"
            className="text-xs h-16"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {row.status === "proposed" && (
              <>
                <Button
                  size="sm"
                  onClick={() => onResolve("approved", notes)}
                  disabled={isSubmitting}
                  aria-label={`Approve ${row.title}`}
                >
                  <Check className="h-4 w-4 mr-1" aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve("rejected", notes)}
                  disabled={isSubmitting}
                  aria-label={`Reject ${row.title}`}
                >
                  <X className="h-4 w-4 mr-1" aria-hidden="true" />
                  Reject
                </Button>
              </>
            )}
            {row.status === "approved" && (
              <Button
                size="sm"
                onClick={() => onResolve("building", notes)}
                disabled={isSubmitting}
                aria-label={`Mark ${row.title} as building`}
              >
                <Clock className="h-4 w-4 mr-1" aria-hidden="true" />
                Mark building
              </Button>
            )}
            {row.status === "building" && (
              <Button
                size="sm"
                onClick={() => onResolve("shipped", notes)}
                disabled={isSubmitting}
                aria-label={`Mark ${row.title} as shipped`}
              >
                <Rocket className="h-4 w-4 mr-1" aria-hidden="true" />
                Mark shipped
              </Button>
            )}
          </div>
        </div>
      )}
      {!showActions && row.founderNotes && (
        <p className="mt-2 text-xs text-muted-foreground italic">Notes: {row.founderNotes}</p>
      )}
    </div>
  );
}
