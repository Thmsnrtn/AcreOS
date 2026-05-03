/**
 * FounderPreviewPage — the supervise-in-real-time feed.
 *
 * Every auto-approved action flows through here BEFORE it commits.
 * The founder can cancel any action within its preview window (set
 * by ACTION_PREVIEW_WINDOW_SECONDS in /founder/settings).
 *
 * Default window is 0 — audit-only, everything commits immediately
 * and rows show up as already-committed. Raise the window to actively
 * supervise, e.g. during a release or when testing a new pattern.
 *
 * Two sections: Pending (live countdown + Cancel button) and Recent
 * (last 48h of committed/cancelled/failed actions for the audit trail).
 */

import { useEffect, useState } from "react";
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
import { Eye, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { relative, usd } from "@/lib/format";

interface PreviewRow {
  id: number;
  decisionId: number | null;
  agentCodename: string;
  itemType: string;
  actionSummary: string;
  actionReasoning: string | null;
  estimatedImpactCents: number | null;
  confidence: number | null;
  plannedAt: string;
  commitAt: string;
  committedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  status: "pending" | "committed" | "cancelled" | "failed";
  executionResult: string | null;
}

export default function FounderPreviewPage() {
  useDocumentTitle("Action preview");
  const { data, isLoading, isError, refetch } = useQuery<{ pending: PreviewRow[]; recent: PreviewRow[] }>({
    queryKey: ["/api/founder/intelligence/action-previews"],
    refetchInterval: 2_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/action-previews/${id}/cancel`, {
        reason: "Founder cancelled from preview",
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/action-previews"] });
      toast({ title: "Cancelled", description: "The action was cancelled before it committed." });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't cancel action",
        description: `${e.message}. The action may have already committed by the time you clicked — check the Recent list.`,
        variant: "destructive",
      }),
  });

  const pending = data?.pending ?? [];
  const recent = data?.recent ?? [];

  return (
    <PageShell label="Action Preview">
      <div className="space-y-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-6">
            <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
              <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Supervise in real time
            </h1>
            <p className="text-sm text-muted-foreground">
              Every auto-approved action flows through here before it commits. Set{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">ACTION_PREVIEW_WINDOW_SECONDS</code>{" "}
              in settings to control how long you have to cancel each action. The default (<span className="tabular-nums">0</span>) is
              audit-only — actions commit immediately and appear in the Recent list.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-acr-warn dark:text-acr-warn" aria-hidden="true" />
              Pending (<span className="tabular-nums">{pending.length}</span>)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-live="polite">
                <span className="sr-only">Loading pending actions…</span>
                <Skeleton className="h-16 w-full" />
              </div>
            ) : isError ? (
              <p className="text-sm text-acr-neg" role="alert">
                Couldn't load previews. Pending actions are still queued —{" "}
                <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => refetch()}
                >
                  try again
                </button>.
              </p>
            ) : pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No actions in flight. Raise the preview window setting to see actions as they're about to commit.
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Pending actions awaiting commit">
                {pending.map((p) => (
                  <li key={p.id}>
                    <PendingPreviewRow
                      row={p}
                      onCancel={() => cancelMutation.mutate(p.id)}
                      cancelling={cancelMutation.isPending}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent (last 48h)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-live="polite">
                <span className="sr-only">Loading recent actions…</span>
                <Skeleton className="h-16 w-full" />
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={Eye}
                title="No recent autonomous actions"
                description="Actions will appear here once the executor processes its first decisions."
              />
            ) : (
              <ul className="space-y-2" aria-label="Recent autonomous actions">
                {recent.map((r) => (
                  <li key={r.id}>
                    <RecentPreviewRow row={r} />
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

function PendingPreviewRow({
  row,
  onCancel,
  cancelling,
}: {
  row: PreviewRow;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const commitAtMs = new Date(row.commitAt).getTime();
  const secondsLeft = Math.max(0, (commitAtMs - now) / 1000);

  return (
    <div className="border border-acr-warn-soft dark:border-acr-warn-soft/40 bg-acr-warn-soft/50 dark:bg-acr-warn-soft/20 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">
              {row.agentCodename}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {row.itemType}
            </Badge>
            {row.confidence != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {row.confidence}% confidence
              </span>
            )}
            {row.estimatedImpactCents != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {usd(row.estimatedImpactCents / 100)} impact
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground mb-1">{row.actionSummary}</p>
          {row.actionReasoning && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {row.actionReasoning}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="text-xs font-mono text-acr-warn dark:text-acr-warn tabular-nums"
            aria-live="polite"
            aria-label={secondsLeft > 0 ? `${secondsLeft.toFixed(1)} seconds until commit` : "Committing now"}
          >
            {secondsLeft > 0 ? `${secondsLeft.toFixed(1)}s` : "committing…"}
          </span>
          <Button
            onClick={onCancel}
            disabled={cancelling || secondsLeft <= 0}
            size="sm"
            variant="destructive"
            data-testid={`cancel-preview-${row.id}`}
            aria-label={`Cancel ${row.agentCodename} action: ${row.actionSummary}`}
          >
            <X className="h-4 w-4 mr-1" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecentPreviewRow({ row }: { row: PreviewRow }) {
  const statusMeta =
    row.status === "committed"
      ? { icon: CheckCircle2, color: "text-acr-pos dark:text-acr-pos", label: "committed" }
      : row.status === "cancelled"
        ? { icon: X, color: "text-muted-foreground", label: "cancelled" }
        : row.status === "failed"
          ? { icon: AlertCircle, color: "text-acr-neg dark:text-acr-neg", label: "failed" }
          : { icon: Clock, color: "text-acr-warn dark:text-acr-warn", label: "pending" };
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded hover:bg-muted/40">
      <statusMeta.icon
        className={`h-4 w-4 ${statusMeta.color} shrink-0`}
        aria-label={`Status: ${statusMeta.label}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <code className="text-[10px] font-mono text-muted-foreground">{row.agentCodename}</code>
          <span className="text-[10px] text-muted-foreground" aria-hidden="true">·</span>
          <span className="text-[10px] text-muted-foreground">{statusMeta.label}</span>
          <span className="text-[10px] text-muted-foreground" aria-hidden="true">·</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {relative(row.plannedAt)}
          </span>
        </div>
        <p className="text-sm text-foreground truncate">{row.actionSummary}</p>
      </div>
    </div>
  );
}
