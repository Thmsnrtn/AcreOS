/**
 * /founder/build — the fifth of the five founder doors (Phase 5 of the Solene
 * migration).
 *
 * "What's in flight right now" — the engineering-side counterpart to Today's
 * shipped-overnight panel. Tom uses this to glance at:
 *
 *   - Counts strip: in-flight dispatches / pending approval / open asks /
 *     audit findings (last 30 days, from team-system-audit)
 *   - Top 5 in-flight dispatches (queued + in_progress) with elapsed time
 *   - Top 5 open asks
 *   - CTA to dispatch a new task via Solene chat
 *
 * Data sources (all already shipped earlier in the migration):
 *   - GET /api/founder/dispatches?status=queued&limit=20
 *   - GET /api/founder/dispatches?status=in_progress&limit=20
 *   - GET /api/founder/asks?status=open&limit=20
 *   - GET /api/founder/team-system-audit/recent  (cross-run totals)
 *
 * Krieger-bar A11y discipline mirrors today.tsx + team.tsx + money.tsx.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Workflow,
  MessageCircleQuestion,
  ShieldAlert,
  Hourglass,
  Sparkles,
  ArrowRight,
  Hammer,
  DollarSign,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";

// ─── API contracts ──────────────────────────────────────────────────────

interface DispatchRow {
  id: number;
  agentRole: string;
  status: string;
  promptText: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface AskRow {
  id: number;
  askingAgentRole: string;
  status: string;
  urgency: string;
  questionText: string;
  askedAt: string;
}

interface TeamSystemAuditSummary {
  runs: Array<{ id: number; runStartedAt: string }>;
  summary: {
    totalRuns: number;
    driftSignalCount: number;
    totalFindings: number;
    byDimension: Record<string, number>;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function relativeElapsed(fromIso: string): string {
  const then = new Date(fromIso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── Counts strip ───────────────────────────────────────────────────────

function CountTile({
  label,
  value,
  icon: Icon,
  testId,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── AI cost ceiling fuel-gauge tile ──────────────────────────────────────

interface CeilingStatus {
  windowHours: number;
  usedUsd: number;
  ceilingUsd: number;
  remainingUsd: number;
  usedPct: number;
  alertThresholdUsd: number;
  atCeiling: boolean;
  aboveAlert: boolean;
}

function AiCostCeilingTile() {
  const { data, isLoading } = useQuery<CeilingStatus>({
    queryKey: ["/api/founder/ai-cost/ceiling-status"],
    queryFn: async () => {
      const res = await fetch("/api/founder/ai-cost/ceiling-status", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load ceiling status: ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <Card data-testid="build-ai-cost-tile">
        <CardContent className="p-4">
          <Skeleton className="h-4 w-1/3 mb-2" />
          <Skeleton className="h-6 w-1/2 mb-3" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  const barColorClass = data.atCeiling
    ? "bg-destructive"
    : data.aboveAlert
      ? "bg-acr-warn"
      : "bg-acr-success";
  const statusLabel = data.atCeiling
    ? "At ceiling"
    : data.aboveAlert
      ? "Above alert"
      : "Within budget";

  return (
    <Card data-testid="build-ai-cost-tile">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              AI spend, last {data.windowHours}h
            </span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/founder/ai-costs"
              aria-label="Open AI cost dashboard"
              data-testid="link-ai-cost-dashboard"
            >
              Details
              <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span
            className="text-2xl font-semibold tabular-nums text-foreground"
            data-testid="ai-cost-used-usd"
          >
            ${data.usedUsd.toFixed(2)}
          </span>
          <span className="text-sm text-muted-foreground">
            / ${data.ceilingUsd.toFixed(2)} cap
          </span>
          <span
            className={cn(
              "text-xs ml-auto font-medium",
              data.atCeiling
                ? "text-destructive"
                : data.aboveAlert
                  ? "text-acr-warn"
                  : "text-acr-success",
            )}
          >
            {statusLabel}
          </span>
        </div>
        <div
          className="h-2 w-full bg-muted rounded-full overflow-hidden"
          aria-label="AI cost usage"
        >
          <div
            className={cn("h-full transition-all", barColorClass)}
            style={{ width: `${Math.min(100, data.usedPct).toFixed(1)}%` }}
            data-testid="ai-cost-bar"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {data.atCeiling
            ? "AI is paused for the rolling 24h window. Cap clears as old calls roll off."
            : `${data.usedPct.toFixed(0)}% of daily cap used. ${data.aboveAlert ? "Email alert was sent for this window." : "Threshold for email alert: $" + data.alertThresholdUsd.toFixed(2) + "."}`}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function FounderBuildPage() {
  useDocumentTitle("Build · Founder");

  const queuedQuery = useQuery<{ dispatches: DispatchRow[] }>({
    queryKey: ["/api/founder/dispatches", "queued", "build-page"],
    queryFn: async () => {
      const res = await fetch("/api/founder/dispatches?status=queued&limit=20", {
        credentials: "include",
      });
      if (!res.ok) return { dispatches: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const inProgressQuery = useQuery<{ dispatches: DispatchRow[] }>({
    queryKey: ["/api/founder/dispatches", "in_progress", "build-page"],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/dispatches?status=in_progress&limit=20",
        { credentials: "include" },
      );
      if (!res.ok) return { dispatches: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const asksQuery = useQuery<{ asks: AskRow[] }>({
    queryKey: ["/api/founder/asks", "open", "build-page"],
    queryFn: async () => {
      const res = await fetch("/api/founder/asks?status=open&limit=20", {
        credentials: "include",
      });
      if (!res.ok) return { asks: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const auditQuery = useQuery<TeamSystemAuditSummary>({
    queryKey: ["/api/founder/team-system-audit/recent", "build-page"],
    queryFn: async () => {
      const res = await fetch("/api/founder/team-system-audit/recent", {
        credentials: "include",
      });
      if (!res.ok)
        return {
          runs: [],
          summary: {
            totalRuns: 0,
            driftSignalCount: 0,
            totalFindings: 0,
            byDimension: {},
          },
        };
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const queued = queuedQuery.data?.dispatches ?? [];
  const inProgress = inProgressQuery.data?.dispatches ?? [];
  const openAsks = asksQuery.data?.asks ?? [];
  const auditTotal = auditQuery.data?.summary.totalFindings ?? 0;

  // Top 5 in-flight, prioritising in-progress over queued so Tom sees what's
  // actually running.
  const inFlight: DispatchRow[] = [...inProgress, ...queued].slice(0, 5);
  const inFlightLoading =
    queuedQuery.isLoading || inProgressQuery.isLoading;
  // The in-flight list is the page's primary surface. If either dispatch
  // fetch fails outright (network), surface an error + retry rather than an
  // empty list that reads as "nothing running".
  const inFlightError = inProgressQuery.isError || queuedQuery.isError;
  const inFlightErrorObj =
    inProgressQuery.error instanceof Error
      ? inProgressQuery.error
      : queuedQuery.error instanceof Error
      ? queuedQuery.error
      : null;
  const inFlightRefetching =
    inProgressQuery.isRefetching || queuedQuery.isRefetching;

  const topAsks = openAsks.slice(0, 5);

  return (
    <PageShell maxWidth="5xl" label="Founder build">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Build
          </h1>
          <p className="text-sm text-muted-foreground">
            What's in flight right now — dispatches, asks, and audit findings.
          </p>
        </header>

        {/* ── Counts strip ────────────────────────────────────────────── */}
        <div
          className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4"
          aria-busy={
            inProgressQuery.isLoading ||
            queuedQuery.isLoading ||
            asksQuery.isLoading ||
            auditQuery.isLoading
          }
        >
          <CountTile
            label="In flight"
            value={
              inFlightLoading ? "…" : inProgress.length + queued.length
            }
            icon={Workflow}
            testId="build-count-in-flight"
          />
          <CountTile
            label="Queued"
            value={queuedQuery.isLoading ? "…" : queued.length}
            icon={Hourglass}
            testId="build-count-queued"
          />
          <CountTile
            label="Open asks"
            value={asksQuery.isLoading ? "…" : openAsks.length}
            icon={MessageCircleQuestion}
            testId="build-count-open-asks"
          />
          <CountTile
            label="Audit findings"
            value={auditQuery.isLoading ? "…" : auditTotal}
            icon={ShieldAlert}
            testId="build-count-audit-findings"
          />
        </div>

        {/* ── AI cost ceiling status ──────────────────────────────────── */}
        <AiCostCeilingTile />

        {/* ── In-flight dispatches ────────────────────────────────────── */}
        <Card
          aria-busy={inFlightLoading}
          data-testid="build-in-flight-section"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              In-flight dispatches
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link
                href="/founder/dispatches"
                aria-label="View all dispatches"
                data-testid="link-view-all-dispatches"
              >
                View all
                <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {inFlightLoading ? (
              <div className="space-y-2" aria-label="Loading dispatches">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : inFlightError ? (
              <QueryErrorState
                error={inFlightErrorObj}
                onRetry={() => {
                  inProgressQuery.refetch();
                  queuedQuery.refetch();
                }}
                isRetrying={inFlightRefetching}
                compact
                title="Couldn't load dispatches"
                description="We hit a snag loading what's in flight. Your data is safe — try again."
                testId="founder-build-query-error"
              />
            ) : inFlight.length === 0 ? (
              <EmptyState
                icon={Workflow}
                headline="Nothing in flight"
                subtitle="When the dispatch queue fires, the active work shows up here."
                // TODO(cta): no founder action — dispatch ingest is automated
                cta={{ label: "", _noOp: true }}
                actionIcon={null}
                testId="build-in-flight-empty"
              />
            ) : (
              <ul className="space-y-2" aria-live="polite">
                {inFlight.map((d) => {
                  const inProg = d.status === "in_progress";
                  const elapsedFrom =
                    inProg && d.startedAt ? d.startedAt : d.queuedAt;
                  return (
                    <li
                      key={d.id}
                      className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                    >
                      <Badge
                        variant={inProg ? "default" : "outline"}
                        className="text-xs shrink-0 capitalize"
                      >
                        {d.agentRole}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground line-clamp-2">
                          {d.promptText}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {inProg ? "running" : "queued"} · {relativeElapsed(elapsedFrom)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Open asks ───────────────────────────────────────────────── */}
        <Card aria-busy={asksQuery.isLoading} data-testid="build-asks-section">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircleQuestion
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              Open asks
              {!asksQuery.isLoading && openAsks.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {openAsks.length}
                </Badge>
              )}
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link
                href="/founder/asks"
                aria-label="View all open asks"
                data-testid="link-view-all-asks-build"
              >
                View all
                <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {asksQuery.isLoading ? (
              <div className="space-y-2" aria-label="Loading asks">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : topAsks.length === 0 ? (
              <EmptyState
                icon={MessageCircleQuestion}
                headline="No open asks"
                subtitle="Agents have everything they need right now."
                tone="celebratory"
                // TODO(cta): passive surface — no user action when asks are empty
                cta={{ label: "", _noOp: true }}
                actionIcon={null}
                testId="build-asks-empty"
              />
            ) : (
              <ul className="space-y-2" aria-live="polite">
                {topAsks.map((ask) => (
                  <li
                    key={ask.id}
                    className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <Badge variant="outline" className="text-xs shrink-0 capitalize">
                      {ask.askingAgentRole}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground line-clamp-2">
                        {ask.questionText}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {ask.urgency !== "normal" ? `${ask.urgency} · ` : ""}
                        {relativeElapsed(ask.askedAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── CTA: dispatch via Solene ────────────────────────────────── */}
        <Card
          className="border-primary/30 bg-primary/5"
          data-testid="build-dispatch-cta"
        >
          <CardContent className="p-4 md:p-5 flex items-start gap-3">
            <div className="rounded-card bg-primary/10 p-2 shrink-0">
              <Hammer className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">
                Need to dispatch new work?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                Ask Solene to brief and dispatch the right agent. She knows the
                roster, the queue, and what each member is best at right now.
              </p>
              <Button asChild className="mt-3" size="sm">
                <Link
                  href="/founder/solene-chat"
                  aria-label="Ask Solene to dispatch a task"
                  data-testid="link-dispatch-via-solene"
                >
                  Ask Solene to dispatch
                  <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="pt-2 text-center">
          <Link
            href="/founder/solene-chat"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-ask-solene-build"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Ask Solene about the build
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
