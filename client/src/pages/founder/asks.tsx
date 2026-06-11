/**
 * /founder/asks — real-time inbox of agent-asks raised via L6.32
 * (founderCollab.askFounder) so Tom can see and answer them.
 *
 * Consumes the founder-collab API surface shipped in commit 05a2e122
 * (server/routes-founder-collab.ts — frozen):
 *
 *   GET  /api/founder/asks?status=open|answered|timed_out|superseded&limit=N
 *   GET  /api/founder/asks/:id
 *   POST /api/founder/asks/:id/answer    { answerText?, chosenOptionId? }
 *   POST /api/founder/asks/:id/supersede { reason }
 *
 * Layout mirrors /founder/dispatches:
 *   - 4 status summary cards (open / answered-24h / timed-out-24h / avg response)
 *   - Active asks table (status='open') with per-row Answer + Supersede actions
 *   - Recent terminal asks table (answered / timed_out / superseded) with
 *     expand-to-view-answer rows
 *   - 30s auto-refresh via useQuery refetchInterval
 *
 * Answer drawer renders a form whose shape depends on the ask's `answer_format`
 * (free_text / multi_choice / yes_no / numeric). The answered ask disappears
 * from the open list immediately on submit (optimistic UI via queryClient
 * invalidation + onMutate).
 *
 * W3-5 decomposition: shared types/helpers + the answer/supersede dialogs and
 * the terminal expandable row live in client/src/components/founder/asks/.
 * The tables, summary cards, and skeleton are named in-file sections below.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatRelative } from "@/lib/format";
import {
  HelpCircle,
  RefreshCw,
  CheckCircle2,
  CircleSlash,
  History,
  MessageSquare,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  URGENCY_TONE,
  agentClass,
  truncate,
  type AsksResponse,
  type FounderAsk,
} from "@/components/founder/asks/ask-shared";
import { TerminalAskRow } from "@/components/founder/asks/terminal-ask-row";
import { AnswerAskDialog } from "@/components/founder/asks/answer-ask-dialog";
import { SupersedeAskDialog } from "@/components/founder/asks/supersede-ask-dialog";

// ─── Query keys + time helpers ──────────────────────────────────────────────

const OPEN_QUERY_KEY = ["/api/founder/asks?status=open&limit=100"];
const ANSWERED_QUERY_KEY = ["/api/founder/asks?status=answered&limit=100"];
const TIMED_OUT_QUERY_KEY = ["/api/founder/asks?status=timed_out&limit=100"];
const SUPERSEDED_QUERY_KEY = [
  "/api/founder/asks?status=superseded&limit=100",
];

function isWithinLast24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= 24 * 60 * 60 * 1000;
}

/**
 * Time-until-timeout countdown with traffic-light color.
 * - green > 6h
 * - amber 1-6h
 * - red < 1h or expired
 */
function timeoutCountdown(
  timeoutAt: string | null | undefined,
): { label: string; toneClass: string } {
  if (!timeoutAt) return { label: "no deadline", toneClass: "text-muted-foreground" };
  const due = new Date(timeoutAt).getTime();
  if (!Number.isFinite(due)) {
    return { label: "—", toneClass: "text-muted-foreground" };
  }
  const ms = due - Date.now();
  if (ms <= 0) return { label: "overdue", toneClass: "text-acr-neg" };
  const hours = ms / (60 * 60 * 1000);
  let label: string;
  if (hours >= 24) label = `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h left`;
  else if (hours >= 1) label = `${Math.floor(hours)}h left`;
  else label = `${Math.max(1, Math.floor(ms / 60_000))}m left`;
  const toneClass =
    hours > 6
      ? "text-acr-pos"
      : hours > 1
      ? "text-acr-warn"
      : "text-acr-neg";
  return { label, toneClass };
}

// No duration helper exists in @/lib/format (formatRelative is anchored to
// "ago/in"); this formats an elapsed span (avg response time).
function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)}h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)}d`;
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

function AsksSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading agent asks…</span>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-3 space-y-2">
            <Skeleton announce={false} className="h-3 w-20" />
            <Skeleton announce={false} className="h-8 w-12" />
          </Card>
        ))}
      </div>
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton announce={false} className="h-5 w-40" />
            <Skeleton announce={false} className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[0, 1, 2].map((r) => (
              <Skeleton key={r} announce={false} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Summary cards ──────────────────────────────────────────────────────────

function SummaryCards({
  counts,
}: {
  counts: {
    open: number;
    answered24: number;
    timedOut24: number;
    avgResponseLabel: string;
  };
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Card className="p-3" data-testid="card-count-open">
        <div className="text-xs text-muted-foreground">Open</div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            counts.open > 0 ? "text-acr-warn" : ""
          }`}
        >
          {counts.open}
        </div>
      </Card>
      <Card className="p-3" data-testid="card-count-answered-24h">
        <div className="text-xs text-muted-foreground">
          Answered (24h)
        </div>
        <div className="text-2xl font-semibold tabular-nums text-acr-pos">
          {counts.answered24}
        </div>
      </Card>
      <Card className="p-3" data-testid="card-count-timed-out-24h">
        <div className="text-xs text-muted-foreground">
          Timed out (24h)
        </div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            counts.timedOut24 > 0 ? "text-acr-neg" : ""
          }`}
        >
          {counts.timedOut24}
        </div>
      </Card>
      <Card className="p-3" data-testid="card-avg-response">
        <div className="text-xs text-muted-foreground">
          Avg response time
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {counts.avgResponseLabel}
        </div>
      </Card>
    </div>
  );
}

// ─── Open asks table ────────────────────────────────────────────────────────

function OpenAsksTable({
  asks,
  onAnswer,
  onSupersede,
  onRefresh,
}: {
  asks: FounderAsk[];
  onAnswer: (a: FounderAsk) => void;
  onSupersede: (a: FounderAsk) => void;
  onRefresh: () => void;
}) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Open asks</CardTitle>
        <CardDescription>
          Questions waiting on your answer. Sorted by urgency, then by
          oldest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {asks.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            tone="celebratory"
            headline="No agents are waiting on you"
            subtitle="Anything they ask will show up here in real time. Auto-refreshes every 30 seconds."
            actionIcon={RefreshCw}
            cta={{
              label: "Refresh now",
              onClick: onRefresh,
              "data-testid": "empty-open-asks-refresh",
            }}
            testId="empty-open-asks"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border bg-muted/30">
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Agent
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Question
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Asked
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Urgency
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Timeout
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {asks.map((a) => {
                  const countdown = timeoutCountdown(a.timeoutAt);
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-border/40"
                      data-testid={`row-open-${a.id}`}
                    >
                      <td className="px-3 py-2 align-top">
                        <Badge
                          variant="outline"
                          className={`text-micro font-mono ${agentClass(
                            a.askingAgentRole,
                          )}`}
                        >
                          {a.askingAgentRole}
                        </Badge>
                      </td>
                      <td
                        className="px-3 py-2 max-w-md align-top"
                        title={a.questionSummary}
                      >
                        {truncate(a.questionSummary, 80)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground align-top">
                        {formatRelative(a.askedAt)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Badge
                          variant={URGENCY_TONE[a.urgency]}
                          className="text-micro"
                        >
                          {a.urgency}
                        </Badge>
                      </td>
                      <td
                        className={`px-3 py-2 align-top tabular-nums ${countdown.toneClass}`}
                      >
                        {countdown.label}
                      </td>
                      <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="default"
                          className="mr-2"
                          onClick={() => onAnswer(a)}
                          data-testid={`button-answer-${a.id}`}
                          aria-label={`Answer ask ${a.id} from ${a.askingAgentRole}`}
                        >
                          <MessageSquare
                            className="w-3 h-3 mr-1"
                            aria-hidden="true"
                          />
                          Answer
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSupersede(a)}
                          data-testid={`button-supersede-${a.id}`}
                          aria-label={`Supersede ask ${a.id} from ${a.askingAgentRole}`}
                        >
                          <CircleSlash
                            className="w-3 h-3 mr-1"
                            aria-hidden="true"
                          />
                          Supersede
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Terminal asks table ────────────────────────────────────────────────────

function TerminalAsksTable({
  asks,
  isLoading,
  error,
  onRetry,
}: {
  asks: FounderAsk[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent terminal asks</CardTitle>
        <CardDescription>
          Answered / timed out / superseded. Click a row to expand the
          full answer or reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div
            className="px-4 py-3 space-y-2"
            role="status"
            aria-live="polite"
          >
            <span className="sr-only">Loading terminal asks…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} announce={false} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            compact
            className="m-4"
            error={error}
            onRetry={onRetry}
            title="Couldn't load terminal asks"
          />
        ) : asks.length === 0 ? (
          /* TODO(cta): read-only history — it fills as open asks above get
             answered, timed out, or superseded; no direct user action. */
          <EmptyState
            icon={History}
            headline="No terminal asks yet"
            subtitle="Answered, timed-out, and superseded asks land here once resolved."
            cta={{ label: "", _noOp: true }}
            testId="empty-terminal-asks"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border bg-muted/30">
                  <th scope="col" className="px-3 py-2 text-left font-medium w-6">
                    <span className="sr-only">Expand</span>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Agent
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Question
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Resolved
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Answer
                  </th>
                </tr>
              </thead>
              <tbody>
                {asks.map((a) => (
                  <TerminalAskRow key={a.id} ask={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FounderAsksPage() {
  useDocumentTitle("Agent Asks — AcreOS");
  const qc = useQueryClient();

  // Open asks — primary list driving the page.
  const {
    data: openData,
    isLoading: openLoading,
    isError: openError,
    error: openErrorObj,
    refetch: refetchOpen,
    isFetching: openFetching,
  } = useQuery<AsksResponse>({
    queryKey: OPEN_QUERY_KEY,
    refetchInterval: 30_000,
  });

  // Terminal sets — answered + timed_out + superseded (each its own endpoint).
  const answeredQuery = useQuery<AsksResponse>({
    queryKey: ANSWERED_QUERY_KEY,
    refetchInterval: 30_000,
  });
  const timedOutQuery = useQuery<AsksResponse>({
    queryKey: TIMED_OUT_QUERY_KEY,
    refetchInterval: 30_000,
  });
  const supersededQuery = useQuery<AsksResponse>({
    queryKey: SUPERSEDED_QUERY_KEY,
    refetchInterval: 30_000,
  });

  const openAsks = openData?.asks ?? [];
  const answeredAsks = answeredQuery.data?.asks ?? [];
  const timedOutAsks = timedOutQuery.data?.asks ?? [];
  const supersededAsks = supersededQuery.data?.asks ?? [];

  const terminalLoading =
    answeredQuery.isLoading ||
    timedOutQuery.isLoading ||
    supersededQuery.isLoading;
  const terminalError =
    (answeredQuery.error ?? timedOutQuery.error ?? supersededQuery.error) as
      | Error
      | null;
  const retryTerminal = () => {
    answeredQuery.refetch();
    timedOutQuery.refetch();
    supersededQuery.refetch();
  };

  const counts = useMemo(() => {
    const answered24 = answeredAsks.filter((a) =>
      isWithinLast24h(a.answeredAt),
    ).length;
    const timedOut24 = timedOutAsks.filter((a) =>
      isWithinLast24h(a.answeredAt ?? a.timeoutAt),
    ).length;

    // Avg response time = mean(answeredAt - askedAt) across answered asks.
    let totalMs = 0;
    let n = 0;
    for (const a of answeredAsks) {
      if (!a.answeredAt) continue;
      const t0 = new Date(a.askedAt).getTime();
      const t1 = new Date(a.answeredAt).getTime();
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) continue;
      totalMs += t1 - t0;
      n += 1;
    }
    const avgMs = n > 0 ? totalMs / n : 0;

    return {
      open: openAsks.length,
      answered24,
      timedOut24,
      avgResponseLabel: n > 0 ? fmtDurationMs(avgMs) : "—",
    };
  }, [openAsks, answeredAsks, timedOutAsks]);

  // Combined terminal list — answered + timed_out + superseded, newest first.
  const terminalAsks = useMemo(() => {
    const all = [...answeredAsks, ...timedOutAsks, ...supersededAsks];
    return all.sort((a, b) => {
      const ta =
        new Date(a.answeredAt ?? a.timeoutAt ?? a.askedAt).getTime() || 0;
      const tb =
        new Date(b.answeredAt ?? b.timeoutAt ?? b.askedAt).getTime() || 0;
      return tb - ta;
    });
  }, [answeredAsks, timedOutAsks, supersededAsks]);

  // ─── Drawer/modal state ────────────────────────────────────────────────
  const [answerOpen, setAnswerOpen] = useState<FounderAsk | null>(null);
  const [supersedeOpen, setSupersedeOpen] = useState<FounderAsk | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: OPEN_QUERY_KEY });
    qc.invalidateQueries({ queryKey: ANSWERED_QUERY_KEY });
    qc.invalidateQueries({ queryKey: TIMED_OUT_QUERY_KEY });
    qc.invalidateQueries({ queryKey: SUPERSEDED_QUERY_KEY });
  };

  const refreshAll = () => {
    refetchOpen();
    qc.invalidateQueries({ queryKey: ANSWERED_QUERY_KEY });
    qc.invalidateQueries({ queryKey: TIMED_OUT_QUERY_KEY });
    qc.invalidateQueries({ queryKey: SUPERSEDED_QUERY_KEY });
  };

  return (
    <PageShell label="Agent Asks">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" aria-hidden="true" />
            Agent Asks
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Real-time questions from your agents that need your decision.
            Auto-refreshes every 30 seconds. Answer to unblock a dispatch;
            supersede if the situation changed and the ask is no longer
            relevant.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={refreshAll}
          disabled={openFetching}
          aria-label="Refresh agent asks"
          data-testid="button-refresh-asks"
        >
          <RefreshCw
            className={`w-4 h-4 mr-1 ${openFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      {openLoading ? (
        <AsksSkeleton />
      ) : openError ? (
        <QueryErrorState
          error={openErrorObj as Error | null}
          onRetry={() => refetchOpen()}
          isRetrying={openFetching}
          title="Couldn't load agent asks"
        />
      ) : (
        <>
          <SummaryCards counts={counts} />

          <OpenAsksTable
            asks={openAsks}
            onAnswer={setAnswerOpen}
            onSupersede={setSupersedeOpen}
            onRefresh={refreshAll}
          />

          <TerminalAsksTable
            asks={terminalAsks}
            isLoading={terminalLoading}
            error={terminalError}
            onRetry={retryTerminal}
          />

          <p className="text-xs text-muted-foreground mt-4">
            Showing {openAsks.length} open + {terminalAsks.length} terminal
            asks (max 100 per status). Auto-refresh every 30 seconds.
          </p>
        </>
      )}

      {/* Answer drawer (Dialog) */}
      <AnswerAskDialog
        ask={answerOpen}
        onClose={() => setAnswerOpen(null)}
        onSubmitted={() => {
          setAnswerOpen(null);
          invalidateAll();
        }}
      />

      {/* Supersede modal */}
      <SupersedeAskDialog
        ask={supersedeOpen}
        onClose={() => setSupersedeOpen(null)}
        onSubmitted={() => {
          setSupersedeOpen(null);
          invalidateAll();
        }}
      />
    </PageShell>
  );
}
