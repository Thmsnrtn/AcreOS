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
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatRelative } from "@/lib/format";
import {
  HelpCircle,
  RefreshCw,
  AlertCircle,
  CircleSlash,
  MessageSquare,
  ChevronDown,
  ChevronRight,
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type AskStatus = "open" | "answered" | "timed_out" | "superseded";
type AskFormat = "free_text" | "multi_choice" | "yes_no" | "numeric";
type AskUrgency = "urgent" | "normal" | "low";

interface AskOption {
  id: string;
  label: string;
  description?: string;
}

interface FounderAsk {
  id: number;
  askedAt: string;
  askingAgentRole: string;
  askingDispatchId: number | null;
  questionSummary: string;
  questionBody: string;
  options: AskOption[] | null;
  answerFormat: AskFormat;
  status: AskStatus;
  answeredAt: string | null;
  answerText: string | null;
  answerChosenOptionId: string | null;
  pagerEventId: number | null;
  timeoutAt: string | null;
  urgency: AskUrgency;
}

interface AsksResponse {
  asks: FounderAsk[];
  count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OPEN_QUERY_KEY = ["/api/founder/asks?status=open&limit=100"];
const ANSWERED_QUERY_KEY = ["/api/founder/asks?status=answered&limit=100"];
const TIMED_OUT_QUERY_KEY = ["/api/founder/asks?status=timed_out&limit=100"];
const SUPERSEDED_QUERY_KEY = [
  "/api/founder/asks?status=superseded&limit=100",
];

const STATUS_TONE: Record<
  AskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "default",
  answered: "secondary",
  timed_out: "destructive",
  superseded: "outline",
};

const URGENCY_TONE: Record<
  AskUrgency,
  "default" | "secondary" | "destructive" | "outline"
> = {
  urgent: "destructive",
  normal: "default",
  low: "outline",
};

// Distinct color hint per agent role — uses Tailwind tokens, no hard-coded
// hex. The Badge tone is unified ('outline'); we apply a className tint.
const AGENT_ROLE_CLASS: Record<string, string> = {
  iris: "border-blue-500/40 text-blue-600 dark:text-blue-300",
  soren: "border-purple-500/40 text-purple-600 dark:text-purple-300",
  beatrice: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  krieger: "border-amber-500/40 text-amber-600 dark:text-amber-300",
  "general-purpose": "border-slate-500/40 text-slate-600 dark:text-slate-300",
  solene: "border-pink-500/40 text-pink-600 dark:text-pink-300",
};

function agentClass(role: string): string {
  return AGENT_ROLE_CLASS[role] ?? "border-border text-muted-foreground";
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

function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)}h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)}d`;
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
  const { data: answeredData } = useQuery<AsksResponse>({
    queryKey: ANSWERED_QUERY_KEY,
    refetchInterval: 30_000,
  });
  const { data: timedOutData } = useQuery<AsksResponse>({
    queryKey: TIMED_OUT_QUERY_KEY,
    refetchInterval: 30_000,
  });
  const { data: supersededData } = useQuery<AsksResponse>({
    queryKey: SUPERSEDED_QUERY_KEY,
    refetchInterval: 30_000,
  });

  const openAsks = openData?.asks ?? [];
  const answeredAsks = answeredData?.asks ?? [];
  const timedOutAsks = timedOutData?.asks ?? [];
  const supersededAsks = supersededData?.asks ?? [];

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

      {/* Loading state */}
      {openLoading ? (
        <div className="space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : openError ? (
        <Card>
          <CardContent className="pt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            Couldn't load agent asks
            {openErrorObj
              ? `: ${getErrorMessage(openErrorObj)}`
              : "."}{" "}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetchOpen()}
              aria-label="Retry loading agent asks"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status summary cards */}
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

          {/* Active asks */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Open asks</CardTitle>
              <CardDescription>
                Questions waiting on your answer. Sorted by urgency, then by
                oldest first.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {openAsks.length === 0 ? (
                <p
                  className="px-4 py-6 text-sm text-muted-foreground text-center"
                  data-testid="empty-open-asks"
                >
                  No agents are waiting on you. Anything they ask will show up
                  here in real time.
                </p>
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
                      {openAsks.map((a) => {
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
                                onClick={() => setAnswerOpen(a)}
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
                                onClick={() => setSupersedeOpen(a)}
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

          {/* Terminal asks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent terminal asks</CardTitle>
              <CardDescription>
                Answered / timed out / superseded. Click a row to expand the
                full answer or reason.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {terminalAsks.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No terminal asks yet.
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
                      {terminalAsks.map((a) => (
                        <TerminalAskRow key={a.id} ask={a} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

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

// ─── Subcomponents ──────────────────────────────────────────────────────────

function TerminalAskRow({ ask: a }: { ask: FounderAsk }) {
  const [open, setOpen] = useState(false);
  const tone = STATUS_TONE[a.status];
  const resolvedAt = a.answeredAt ?? a.timeoutAt ?? null;

  const chosenLabel = useMemo(() => {
    if (!a.answerChosenOptionId) return null;
    const opt = (a.options ?? []).find((o) => o.id === a.answerChosenOptionId);
    return opt?.label ?? a.answerChosenOptionId;
  }, [a]);

  const answerSummary =
    a.status === "answered"
      ? chosenLabel ?? a.answerText ?? "—"
      : a.status === "timed_out"
      ? "no answer recorded"
      : a.status === "superseded"
      ? (a.answerText ?? "marked no-longer-relevant")
      : "—";

  return (
    <>
      <tr
        className="border-b border-border/40 cursor-pointer hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
        data-testid={`row-terminal-${a.id}`}
      >
        <td className="px-3 py-2 align-top">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label={open ? `Collapse ask ${a.id}` : `Expand ask ${a.id}`}
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
        <td className="px-3 py-2 align-top">
          <Badge
            variant="outline"
            className={`text-micro font-mono ${agentClass(a.askingAgentRole)}`}
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
        <td className="px-3 py-2 align-top">
          <Badge variant={tone} className="text-micro">
            {a.status}
          </Badge>
        </td>
        <td className="px-3 py-2 text-muted-foreground align-top">
          {formatRelative(resolvedAt)}
        </td>
        <td
          className="px-3 py-2 max-w-md text-foreground/80 align-top"
          title={answerSummary}
        >
          {truncate(answerSummary, 80)}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20" data-testid={`row-terminal-expanded-${a.id}`}>
          <td />
          <td colSpan={5} className="px-3 py-3 space-y-3">
            <div>
              <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                Question
              </div>
              <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {a.questionBody}
              </pre>
            </div>

            {a.options && a.options.length > 0 && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  Options offered
                </div>
                <ul className="text-xs space-y-1">
                  {a.options.map((o) => (
                    <li
                      key={o.id}
                      className={
                        o.id === a.answerChosenOptionId
                          ? "font-semibold text-acr-pos"
                          : "text-muted-foreground"
                      }
                    >
                      • {o.label}
                      {o.description ? (
                        <span className="text-muted-foreground/80">
                          {" "}
                          — {o.description}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {a.answerText && (
              <div>
                <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
                  {a.status === "superseded" ? "Supersede reason" : "Your answer"}
                </div>
                <pre className="text-xs font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                  {a.answerText}
                </pre>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Asked / Resolved
                </div>
                <div className="text-muted-foreground">
                  {formatRelative(a.askedAt)} · {formatRelative(resolvedAt)}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-muted-foreground mb-1">
                  Answer format · Urgency
                </div>
                <div className="font-mono text-muted-foreground">
                  {a.answerFormat} · {a.urgency}
                </div>
              </div>
              {a.askingDispatchId != null && (
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground mb-1">
                    Dispatch
                  </div>
                  <div className="font-mono">#{a.askingDispatchId}</div>
                </div>
              )}
              {a.pagerEventId != null && (
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground mb-1">
                    Pager event
                  </div>
                  <div className="font-mono">#{a.pagerEventId}</div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Answer dialog ──────────────────────────────────────────────────────────

interface AnswerAskDialogProps {
  ask: FounderAsk | null;
  onClose: () => void;
  onSubmitted: () => void;
}

function AnswerAskDialog({ ask, onClose, onSubmitted }: AnswerAskDialogProps) {
  const { toast } = useToast();
  const [answerText, setAnswerText] = useState("");
  const [chosenOptionId, setChosenOptionId] = useState<string>("");

  // Reset state whenever the ask changes.
  // Using inline useState resets requires effect; do it via a key prop on
  // the form below.

  const mutation = useMutation({
    mutationFn: async (input: {
      askId: number;
      answerText?: string;
      chosenOptionId?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/asks/${input.askId}/answer`,
        {
          answerText: input.answerText,
          chosenOptionId: input.chosenOptionId,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Answer failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Ask #${vars.askId} answered` });
      onSubmitted();
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  if (!ask) return null;

  const submit = () => {
    if (ask.answerFormat === "multi_choice") {
      if (!chosenOptionId) {
        toast({
          title: "Choose an option",
          description: "Please select one of the offered options.",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, chosenOptionId });
      return;
    }
    if (ask.answerFormat === "yes_no") {
      // Submitted via the dedicated Yes/No buttons below.
      // This codepath is only hit if the user pressed an explicit Submit
      // before clicking yes/no — guard against empty text.
      if (!answerText) {
        toast({
          title: "Choose yes or no",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, answerText });
      return;
    }
    if (ask.answerFormat === "numeric") {
      const trimmed = answerText.trim();
      if (!trimmed || !Number.isFinite(Number(trimmed))) {
        toast({
          title: "Enter a number",
          description: "The numeric answer must parse as a number.",
          variant: "destructive",
        });
        return;
      }
      mutation.mutate({ askId: ask.id, answerText: trimmed });
      return;
    }
    // free_text
    if (!answerText.trim()) {
      toast({
        title: "Answer cannot be empty",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({ askId: ask.id, answerText: answerText.trim() });
  };

  return (
    <Dialog
      open={ask !== null}
      onOpenChange={(o) => {
        if (!o) {
          setAnswerText("");
          setChosenOptionId("");
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-2xl"
        aria-labelledby={`answer-ask-${ask.id}-title`}
        aria-describedby={`answer-ask-${ask.id}-desc`}
        data-testid={`dialog-answer-${ask.id}`}
      >
        <DialogHeader>
          <DialogTitle
            id={`answer-ask-${ask.id}-title`}
            className="flex items-center gap-2"
          >
            <Badge
              variant="outline"
              className={`text-micro font-mono ${agentClass(ask.askingAgentRole)}`}
            >
              {ask.askingAgentRole}
            </Badge>
            <span>asks</span>
            <Badge variant={URGENCY_TONE[ask.urgency]} className="text-micro">
              {ask.urgency}
            </Badge>
          </DialogTitle>
          <DialogDescription
            id={`answer-ask-${ask.id}-desc`}
            className="font-medium text-foreground"
          >
            {ask.questionSummary}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Full body — rendered as markdown-friendly preformatted text.
              We don't render full markdown here to keep the surface secure
              and dependency-light; pre-wrap handles line breaks + lists. */}
          <div>
            <div className="uppercase tracking-wide text-muted-foreground text-xs mb-1">
              Context
            </div>
            <pre className="text-xs font-mono bg-muted/40 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap">
              {ask.questionBody}
            </pre>
          </div>

          {/* Form, switched on answer_format */}
          {ask.answerFormat === "free_text" && (
            <div className="space-y-1">
              <Label htmlFor={`answer-text-${ask.id}`}>Your answer</Label>
              <Textarea
                id={`answer-text-${ask.id}`}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={5}
                placeholder="Type your answer…"
                data-testid={`textarea-answer-${ask.id}`}
              />
              <div className="text-micro text-muted-foreground text-right">
                {answerText.length} character{answerText.length === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {ask.answerFormat === "multi_choice" && (ask.options ?? []).length > 0 && (
            <div className="space-y-2">
              <Label>Choose one</Label>
              <RadioGroup
                value={chosenOptionId}
                onValueChange={setChosenOptionId}
                aria-label="Answer options"
                data-testid={`radio-options-${ask.id}`}
              >
                {(ask.options ?? []).map((o) => (
                  <div key={o.id} className="flex items-start gap-2">
                    <RadioGroupItem
                      value={o.id}
                      id={`opt-${ask.id}-${o.id}`}
                      data-testid={`radio-option-${o.id}`}
                    />
                    <Label
                      htmlFor={`opt-${ask.id}-${o.id}`}
                      className="font-normal cursor-pointer leading-snug"
                    >
                      <div className="font-medium">{o.label}</div>
                      {o.description && (
                        <div className="text-xs text-muted-foreground">
                          {o.description}
                        </div>
                      )}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {ask.answerFormat === "yes_no" && (
            <div className="space-y-1">
              <Label>Your answer</Label>
              <div className="flex gap-2">
                <Button
                  variant={answerText === "yes" ? "default" : "outline"}
                  onClick={() => setAnswerText("yes")}
                  data-testid={`button-yes-${ask.id}`}
                  aria-label="Answer yes"
                  aria-pressed={answerText === "yes"}
                >
                  Yes
                </Button>
                <Button
                  variant={answerText === "no" ? "default" : "outline"}
                  onClick={() => setAnswerText("no")}
                  data-testid={`button-no-${ask.id}`}
                  aria-label="Answer no"
                  aria-pressed={answerText === "no"}
                >
                  No
                </Button>
              </div>
            </div>
          )}

          {ask.answerFormat === "numeric" && (
            <div className="space-y-1">
              <Label htmlFor={`answer-num-${ask.id}`}>Your answer (number)</Label>
              <Input
                id={`answer-num-${ask.id}`}
                type="number"
                inputMode="decimal"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="e.g. 1500"
                data-testid={`input-numeric-${ask.id}`}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setAnswerText("");
              setChosenOptionId("");
              onClose();
            }}
            data-testid="button-answer-cancel"
            aria-label="Cancel answering"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={mutation.isPending}
            data-testid={`button-answer-submit-${ask.id}`}
            aria-label="Submit answer"
          >
            {mutation.isPending ? "Submitting…" : "Submit answer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Supersede dialog ───────────────────────────────────────────────────────

interface SupersedeAskDialogProps {
  ask: FounderAsk | null;
  onClose: () => void;
  onSubmitted: () => void;
}

function SupersedeAskDialog({
  ask,
  onClose,
  onSubmitted,
}: SupersedeAskDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: async (input: { askId: number; reason: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/asks/${input.askId}/supersede`,
        { reason: input.reason },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Supersede failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Ask #${vars.askId} superseded` });
      onSubmitted();
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  if (!ask) return null;

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({
        title: "Reason required",
        description: "Please explain why this ask is no longer relevant.",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({ askId: ask.id, reason: trimmed });
  };

  return (
    <Dialog
      open={ask !== null}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        aria-labelledby={`supersede-ask-${ask.id}-title`}
        data-testid={`dialog-supersede-${ask.id}`}
      >
        <DialogHeader>
          <DialogTitle id={`supersede-ask-${ask.id}-title`}>
            Supersede this ask?
          </DialogTitle>
          <DialogDescription>
            Mark this ask as no-longer-relevant. The agent won't get an answer
            — your reason is recorded for the agent's context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{ask.askingAgentRole}</span>:{" "}
            <span className="italic">{truncate(ask.questionSummary, 100)}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`supersede-reason-${ask.id}`}>
              Reason (required)
            </Label>
            <Textarea
              id={`supersede-reason-${ask.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. situation changed — already shipped a different fix"
              data-testid={`textarea-supersede-reason-${ask.id}`}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setReason("");
              onClose();
            }}
            data-testid="button-supersede-cancel"
            aria-label="Cancel supersede"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={mutation.isPending}
            data-testid={`button-supersede-submit-${ask.id}`}
            aria-label="Confirm supersede"
          >
            {mutation.isPending ? "Submitting…" : "Supersede"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
