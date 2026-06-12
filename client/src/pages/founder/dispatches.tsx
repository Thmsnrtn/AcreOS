/**
 * /founder/dispatches — live view of the solene_dispatch_queue.
 *
 * Visibility surface for the auto-dispatch system shipped in K1+K3
 * (cd290f4c / 751e15db / f16a29b9). Backend endpoints live in
 *   server/routes-dispatch.ts
 * (frozen — this page is read-against, not edit-against).
 *
 *   - 4 status summary cards (queued / in_progress / completed-24h / failed-24h)
 *   - Active dispatches table (queued + in_progress, cancellable)
 *   - Recent terminal dispatches table (completed / failed / cancelled),
 *     click row -> expand to full prompt + result + commit SHAs.
 *   - Auto-refresh every 30s via useQuery refetchInterval.
 *
 * Mirrors the founder/telemetry.tsx layout (status cards + table + auto-refresh)
 * and the founder/agent-queue.tsx mutation/toast patterns.
 */

import { useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatRelative } from "@/lib/format";
import {
  Workflow,
  RefreshCw,
  AlertCircle,
  CircleSlash,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type DispatchStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

type ReviewStatus = "pending" | "passed" | "flagged" | "skipped" | null;

interface DispatchResult {
  success: boolean;
  costUsd: number;
  durationMs: number;
  tokenInput: number;
  tokenOutput: number;
  errorMessage: string | null;
  commitsReferenced: string[];
  filesModified: string[];
  followUpOpportunities: Record<string, unknown>;
  recordedAt: string;
}

interface DispatchRow {
  id: number;
  queuedAt: string;
  status: DispatchStatus;
  priority: number;
  sourceType: string;
  sourceId: string;
  agentRole: string;
  promptText: string;
  maxCostUsd: number;
  timeoutMs: number;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  resultFullPath: string | null;
  enqueuedBy: string | null;
  // reviewStatus is not currently in shapeDispatchRow (server frozen),
  // but the field IS in the underlying query row. The client treats
  // it as optional — once the server starts exposing it, the UI lights up.
  reviewStatus?: ReviewStatus;
  result: DispatchResult | null;
}

interface DispatchesResponse {
  dispatches: DispatchRow[];
  count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<
  DispatchStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  in_progress: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const REVIEW_TONE: Record<
  NonNullable<ReviewStatus>,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  passed: "secondary",
  flagged: "destructive",
  skipped: "outline",
};

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(2)}`;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function isWithinLast24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= 24 * 60 * 60 * 1000;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FounderDispatchesPage() {
  useDocumentTitle("Dispatches — AcreOS");
  const { toast } = useToast();
  const qc = useQueryClient();

  // /founder/dispatches?agent=<codename> — per-agent drill-down from the
  // /founder/team cards. Filtering is client-side over the same 200-row
  // window the unfiltered view uses.
  const searchString = useSearch();
  const agentFilter = new URLSearchParams(searchString).get("agent");

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<DispatchesResponse>({
      queryKey: ["/api/founder/dispatches?limit=200"],
      refetchInterval: 30_000,
    });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/dispatches/${id}/cancel`,
        { reason: "founder cancelled from /founder/dispatches" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Cancel failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      toast({ title: `Dispatch #${id} cancelled` });
      qc.invalidateQueries({
        queryKey: ["/api/founder/dispatches?limit=200"],
      });
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const allDispatches = data?.dispatches ?? [];
  const dispatches = useMemo(
    () =>
      agentFilter
        ? allDispatches.filter((d) => d.agentRole === agentFilter)
        : allDispatches,
    [allDispatches, agentFilter],
  );

  const counts = useMemo(() => {
    let queued = 0;
    let inProgress = 0;
    let completed24 = 0;
    let failed24 = 0;
    for (const d of dispatches) {
      if (d.status === "queued") queued++;
      else if (d.status === "in_progress") inProgress++;
      else if (d.status === "completed" && isWithinLast24h(d.completedAt))
        completed24++;
      else if (d.status === "failed" && isWithinLast24h(d.completedAt))
        failed24++;
    }
    return { queued, inProgress, completed24, failed24 };
  }, [dispatches]);

  const active = useMemo(
    () =>
      dispatches.filter(
        (d) => d.status === "queued" || d.status === "in_progress",
      ),
    [dispatches],
  );

  const terminal = useMemo(
    () =>
      dispatches.filter(
        (d) =>
          d.status === "completed" ||
          d.status === "failed" ||
          d.status === "cancelled",
      ),
    [dispatches],
  );

  return (
    <PageShell label="Dispatches">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Workflow className="w-6 h-6 text-primary" aria-hidden="true" />
            Dispatches
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Real-time view of the auto-dispatch queue. Auto-refreshes every 30
            seconds. Queued rows can be cancelled; in-progress rows are
            mid-call and cannot be safely interrupted.
          </p>
          {agentFilter && (
            <Badge
              variant="secondary"
              className="mt-2 gap-1 pr-1"
              data-testid="badge-agent-filter"
            >
              <span className="font-mono">{agentFilter}</span> only
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                aria-label={`Clear ${agentFilter} filter and show all agents`}
                data-testid="button-clear-agent-filter"
                onClick={() =>
                  window.history.replaceState(null, "", "/founder/dispatches")
                }
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </Button>
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh dispatches"
          data-testid="button-refresh-dispatches"
        >
          <RefreshCw
            className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            Couldn't load dispatches.{" "}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              aria-label="Retry loading dispatches"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card className="p-3" data-testid="card-count-queued">
              <div className="text-xs text-muted-foreground">Queued</div>
              <div className="text-2xl font-semibold tabular-nums">
                {counts.queued}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-count-in-progress">
              <div className="text-xs text-muted-foreground">In progress</div>
              <div className="text-2xl font-semibold tabular-nums">
                {counts.inProgress}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-count-completed-24h">
              <div className="text-xs text-muted-foreground">
                Completed (24h)
              </div>
              <div className="text-2xl font-semibold tabular-nums text-acr-pos">
                {counts.completed24}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-count-failed-24h">
              <div className="text-xs text-muted-foreground">Failed (24h)</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  counts.failed24 > 0 ? "text-acr-neg" : ""
                }`}
              >
                {counts.failed24}
              </div>
            </Card>
          </div>

          {/* Active dispatches */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Active dispatches</CardTitle>
              <CardDescription>
                Queued + in-progress rows. Queued rows can be cancelled.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {active.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No active dispatches.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border bg-muted/30">
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          ID
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Status
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Agent
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Source
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Queued
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Started
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Cost cap
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((d) => (
                        <tr
                          key={d.id}
                          className="border-b border-border/40"
                          data-testid={`row-active-${d.id}`}
                        >
                          <td className="px-3 py-2 font-mono">#{d.id}</td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={STATUS_TONE[d.status]}
                              className="text-micro"
                            >
                              {d.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-mono">{d.agentRole}</td>
                          <td className="px-3 py-2 font-mono text-caption">
                            <span className="text-muted-foreground">
                              {d.sourceType}
                            </span>
                            <span className="mx-1">/</span>
                            <span title={d.sourceId}>
                              {truncate(d.sourceId, 24)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatRelative(d.queuedAt)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatRelative(d.startedAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {fmtCost(d.maxCostUsd)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {d.status === "queued" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => cancelMutation.mutate(d.id)}
                                disabled={cancelMutation.isPending}
                                data-testid={`button-cancel-${d.id}`}
                                aria-label={`Cancel dispatch ${d.id}`}
                              >
                                <CircleSlash
                                  className="w-3 h-3 mr-1"
                                  aria-hidden="true"
                                />
                                Cancel
                              </Button>
                            ) : (
                              <span className="text-muted-foreground italic">
                                running
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent terminal dispatches */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Recent terminal dispatches
              </CardTitle>
              <CardDescription>
                Completed / failed / cancelled. Click a row to expand the full
                prompt, result, and commit SHAs.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {terminal.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No terminal dispatches yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border bg-muted/30">
                        <th scope="col" className="px-3 py-2 text-left font-medium w-6">
                          <span className="sr-only">Expand</span>
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          ID
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Status
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Agent
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Result
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Cost
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Duration
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Review
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {terminal.map((d) => (
                        <TerminalRow key={d.id} dispatch={d} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground mt-4">
            Showing {dispatches.length} most recent dispatches (max 200).
            Auto-refresh every 30 seconds.
          </p>
        </>
      )}
    </PageShell>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function TerminalRow({ dispatch: d }: { dispatch: DispatchRow }) {
  const [open, setOpen] = useState(false);
  const review = d.reviewStatus;
  const reviewTone = review ? REVIEW_TONE[review] : "outline";

  return (
    <>
      <tr
        className="border-b border-border/40 cursor-pointer hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
        data-testid={`row-terminal-${d.id}`}
      >
        <td className="px-3 py-2 align-top">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={open ? `Collapse dispatch ${d.id}` : `Expand dispatch ${d.id}`}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3 h-3" aria-hidden="true" />
            )}
          </Button>
        </td>
        <td className="px-3 py-2 font-mono align-top">#{d.id}</td>
        <td className="px-3 py-2 align-top">
          <Badge variant={STATUS_TONE[d.status]} className="text-micro">
            {d.status}
          </Badge>
        </td>
        <td className="px-3 py-2 font-mono align-top">{d.agentRole}</td>
        <td
          className="px-3 py-2 max-w-md text-foreground/80 align-top"
          title={d.resultSummary ?? d.result?.errorMessage ?? ""}
        >
          {truncate(d.resultSummary ?? d.result?.errorMessage ?? null, 80)}
        </td>
        <td className="px-3 py-2 text-right align-top">
          {fmtCost(d.result?.costUsd)}
        </td>
        <td className="px-3 py-2 text-right text-muted-foreground align-top">
          {fmtDuration(d.result?.durationMs)}
        </td>
        <td className="px-3 py-2 align-top">
          {review ? (
            <Badge variant={reviewTone} className="text-micro">
              {review}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20" data-testid={`row-terminal-expanded-${d.id}`}>
          <td />
          <td colSpan={7} className="px-3 py-3 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Source
                </div>
                <div className="font-mono">
                  {d.sourceType} / {d.sourceId}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Enqueued by
                </div>
                <div className="font-mono">{d.enqueuedBy ?? "—"}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Queued / Started / Completed
                </div>
                <div className="text-muted-foreground">
                  {formatRelative(d.queuedAt)} · {formatRelative(d.startedAt)} ·{" "}
                  {formatRelative(d.completedAt)}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Tokens
                </div>
                <div className="font-mono text-muted-foreground">
                  in {d.result?.tokenInput ?? "—"} · out{" "}
                  {d.result?.tokenOutput ?? "—"}
                </div>
              </div>
            </div>

            <div>
              <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                Prompt
              </div>
              <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {d.promptText}
              </pre>
            </div>

            {d.resultSummary && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  Result summary
                </div>
                <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                  {d.resultSummary}
                </pre>
              </div>
            )}

            {d.result?.errorMessage && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  Error
                </div>
                <pre className="text-xs font-mono bg-destructive/10 text-destructive rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                  {d.result.errorMessage}
                </pre>
              </div>
            )}

            {d.result?.commitsReferenced &&
              d.result.commitsReferenced.length > 0 && (
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                    Commits referenced
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {d.result.commitsReferenced.map((sha) => (
                      <code
                        key={sha}
                        className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono"
                      >
                        {sha.slice(0, 12)}
                      </code>
                    ))}
                  </div>
                </div>
              )}

            {d.result?.filesModified && d.result.filesModified.length > 0 && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  Files modified
                </div>
                <div className="flex flex-wrap gap-1">
                  {d.result.filesModified.map((f) => (
                    <code
                      key={f}
                      className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono"
                    >
                      {f}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {d.resultFullPath && (
              <div className="text-xs text-muted-foreground">
                Full transcript:{" "}
                <code className="font-mono">{d.resultFullPath}</code>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
