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
import { Wrench, Check, X, Clock, Rocket } from "lucide-react";
import { relative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";

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
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function FounderToolsPage() {
  const { data, isLoading, isError } = useQuery<{ proposals: ToolProposalRow[] }>({
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
  });

  const proposals = data?.proposals ?? [];
  const byStatus: Record<string, ToolProposalRow[]> = { proposed: [], approved: [], building: [], shipped: [], rejected: [] };
  for (const p of proposals) byStatus[p.status]?.push(p);

  return (
    <PageShell label="Tool Proposals">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Capability growth queue"
          icon={<Wrench className="h-5 w-5 text-muted-foreground" />}
          description={`What the system needs to do its job better. Proposals come from agents and from the monthly strategic synthesis. Approving a proposal doesn't build it — it moves it onto the engineering backlog. Mark it "building" when you start, "shipped" when it's live.`}
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">Could not load tool proposals.</CardContent>
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
              return (
                <Card key={status}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base capitalize flex items-center gap-2">
                      {status === "proposed" && <Clock className="h-4 w-4 text-amber-600" />}
                      {status === "approved" && <Check className="h-4 w-4 text-emerald-600" />}
                      {status === "building" && <Clock className="h-4 w-4 text-blue-600" />}
                      {status === "shipped" && <Rocket className="h-4 w-4 text-emerald-600" />}
                      {status === "rejected" && <X className="h-4 w-4 text-muted-foreground" />}
                      {status} ({rows.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {rows.map((p) => (
                      <ToolProposalCard
                        key={p.id}
                        row={p}
                        onResolve={(newStatus, notes) =>
                          resolveMutation.mutate({ id: p.id, status: newStatus, notes })
                        }
                        isSubmitting={resolveMutation.isPending}
                      />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </PageShell>
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
  const [notes, setNotes] = useState(row.founderNotes ?? "");
  const showActions = row.status === "proposed" || row.status === "approved" || row.status === "building";

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="secondary" className="text-[10px]">{row.proposedBy}</Badge>
            <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[row.category]}</Badge>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${COMPLEXITY_COLOR[row.estimatedComplexity]}`}>
              {row.estimatedComplexity}
            </span>
            {row.estimatedImpactCents != null && (
              <span className="text-[10px] text-muted-foreground">
                ${(row.estimatedImpactCents / 100).toLocaleString()} impact
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {relative(row.createdAt)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{row.title}</h3>
          <p className="text-xs text-foreground/80 mb-2 leading-relaxed">{row.description}</p>
          <p className="text-[11px] text-muted-foreground mb-1">
            <span className="font-medium text-foreground/80">Gap:</span> {row.capabilityGap}
          </p>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">Benefit:</span> {row.expectedBenefit}
          </p>
        </div>
      </div>
      {showActions && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (shown when you move this forward)…"
            className="text-xs h-16"
            aria-label="Founder notes"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {row.status === "proposed" && (
              <>
                <Button size="sm" onClick={() => onResolve("approved", notes)} disabled={isSubmitting}>
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onResolve("rejected", notes)} disabled={isSubmitting}>
                  <X className="h-4 w-4 mr-1" />
                  Reject
                </Button>
              </>
            )}
            {row.status === "approved" && (
              <Button size="sm" onClick={() => onResolve("building", notes)} disabled={isSubmitting}>
                <Clock className="h-4 w-4 mr-1" />
                Mark building
              </Button>
            )}
            {row.status === "building" && (
              <Button size="sm" onClick={() => onResolve("shipped", notes)} disabled={isSubmitting}>
                <Rocket className="h-4 w-4 mr-1" />
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
