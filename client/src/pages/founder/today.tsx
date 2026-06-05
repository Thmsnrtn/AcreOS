/**
 * /founder/today — the new founder landing page (Phase 4 of the Solene migration).
 *
 * When the `useNewFounderUI` flag is true, this is what Tom sees first
 * every time he opens the app — the morning pulse, what's waiting on him,
 * what shipped overnight, and a place to start a conversation with Solene.
 *
 * Sections (top-down):
 *   1. Morning pulse banner — the daily one-line Solene generates
 *      (Phase 7 wires the live endpoint; placeholder for now)
 *   2. Active asks — up to 3 most-recent open agent asks (compact);
 *      "View all" routes to /founder/build
 *   3. What shipped overnight — recent completed dispatches
 *   4. Decisions waiting — stub for the founder-decisions queue
 *      (shape documented inline; comes online in a later phase)
 *   5. Chat with Solene — STUB until Phase 2 backend + Phase 3 frontend
 *      both land; until then, point Tom back to the Claude Code CLI
 *
 * Krieger-bar A11y discipline:
 *   - mobile-first responsive (360 / 390 / 1280 / 1920)
 *   - light + dark theme — only design tokens, no hardcoded colors
 *   - touch targets ≥ 44×44 on mobile
 *   - keyboard navigation + visible focus rings (shadcn defaults)
 *   - aria-busy on loading skeletons
 *   - aria-live on async-loaded sections
 */

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sun,
  HelpCircle,
  GitCommit,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSoleneChat } from "@/hooks/useSoleneChat";
import { useToast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/clientLogger";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { createSoleneConversation } from "@/pages/founder/solene-chat";
import type { ContentBlock } from "@shared/schema/solene-conversations";

// ─── API contracts (provisional; some endpoints are stubs until later phases) ──

/**
 * GET /api/founder/solene/morning-pulse — Phase 7
 * Shape (provisional):
 *   { generatedAt: string, headline: string, body: string[], asOf: string }
 */
// Shape of the response from GET /api/founder/solene/morning-pulse
// (Phase 7). composeMorningPulse() in server/services/solene/continuousLoop.ts
// is the source of truth; this is its serialized form.
interface MorningPulseSnapshot {
  generatedAt: string;
  dayLabel: string;
  oneLine: string;
  mrr: number;
  trials: number;
  uptimePct: number;
  prodVersion: string;
  complianceOpenCount: number;
  weeklySpendUsd: number;
  decisionsWaitingCount: number;
  autonomyHorizonDays: number;
  envelopeStatus: "green" | "amber" | "red";
  dispatchesCompletedLast24h: number;
  dispatchesFlaggedLast24h: number;
  asksOpenCount: number;
  asksUrgentCount: number;
}

interface MorningPulseResponse {
  pulse: MorningPulseSnapshot | null;
  freshFromCache?: boolean;
}

/** GET /api/founder/asks — already shipped (L6.32). Compact shape. */
interface FounderAsk {
  id: number;
  askingAgentRole: string;
  questionSummary: string;
  status: "open" | "answered" | "superseded";
  askedAt: string;
}

/** GET /api/founder/dispatches?status=completed&limit=10 — already shipped. */
interface CompletedDispatch {
  id: number;
  agentRole: string;
  summary: string;
  completedAt: string;
  commitShas?: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Section: Morning Pulse Banner ───────────────────────────────────────
//
// Reads from the Phase 7 endpoint. Fresh GET re-composes if no row exists
// yet (first-time / post-deploy), so this should almost always render
// content rather than the empty state.

function MorningPulseBanner() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const { data, isLoading, isError } = useQuery<MorningPulseResponse>({
    queryKey: ["/api/founder/solene/morning-pulse"],
    queryFn: async () => {
      const res = await fetch("/api/founder/solene/morning-pulse", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load morning pulse: ${res.status}`);
      }
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const pulse = data?.pulse ?? null;

  return (
    <Card
      className="border-acr-warn/30 bg-acr-warn/5"
      aria-live="polite"
      data-testid="morning-pulse-banner"
    >
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-acr-warn/10 p-2 shrink-0">
            <Sun className="h-5 w-5 text-acr-warn" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-foreground">
                Morning pulse
              </h2>
              <span className="text-xs text-muted-foreground">{today}</span>
            </div>
            {isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : isError ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Couldn't reach the pulse endpoint. The 7am ET cron will
                refresh it on the next tick.
              </p>
            ) : pulse ? (
              <>
                <p className="mt-2 text-base font-medium text-foreground">
                  {pulse.oneLine}
                </p>
                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <li>
                    Autonomy: <span className="text-foreground">{pulse.autonomyHorizonDays}d</span>
                  </li>
                  <li>
                    MRR: <span className="text-foreground">${pulse.mrr}</span>
                  </li>
                  <li>
                    Trials: <span className="text-foreground">{pulse.trials}</span>
                  </li>
                  <li>
                    Uptime: <span className="text-foreground">{pulse.uptimePct}%</span>
                  </li>
                  <li>
                    Asks open: <span className="text-foreground">{pulse.asksOpenCount}</span>
                    {pulse.asksUrgentCount > 0 ? (
                      <span className="text-acr-warn"> ({pulse.asksUrgentCount} urgent)</span>
                    ) : null}
                  </li>
                  <li>
                    Envelope:{" "}
                    <span
                      className={
                        pulse.envelopeStatus === "green"
                          ? "text-acr-success"
                          : pulse.envelopeStatus === "amber"
                            ? "text-acr-warn"
                            : "text-destructive"
                      }
                    >
                      {pulse.envelopeStatus}
                    </span>
                  </li>
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                No pulse posted yet today. The 7am ET cron writes the first
                row; until it fires, the GET endpoint re-composes live on
                each request — if you're seeing this the live compose
                returned null too. Check worker logs.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section: Active Asks (compact) ─────────────────────────────────────

function ActiveAsksSection() {
  const { data, isLoading, isError } = useQuery<{ asks: FounderAsk[] }>({
    queryKey: ["/api/founder/asks", "open", "compact"],
    queryFn: async () => {
      const res = await fetch("/api/founder/asks?status=open&limit=3", {
        credentials: "include",
      });
      if (!res.ok) return { asks: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const asks = data?.asks ?? [];

  return (
    <Card aria-busy={isLoading} data-testid="active-asks-section">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Active asks
          {!isLoading && asks.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {asks.length}
            </Badge>
          )}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link
            href="/founder/build"
            aria-label="View all agent asks"
            data-testid="link-view-all-asks"
          >
            View all
            <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading asks">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load asks right now.
          </p>
        ) : asks.length === 0 ? (
          <EmptyState
            icon={HelpCircle}
            headline="No open asks"
            subtitle="Agents will surface questions here when they need your input to unblock a dispatch."
            // TODO(cta): passive surface — no user action when there are zero asks
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <ul className="space-y-2" aria-live="polite">
            {asks.map((ask) => (
              <li
                key={ask.id}
                className="flex items-start gap-3 rounded-md border border-border bg-card p-3 hover:bg-muted/40 transition-colors"
              >
                <Badge variant="outline" className="text-xs shrink-0 capitalize">
                  {ask.askingAgentRole}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-2">
                    {ask.questionSummary}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {relativeTime(ask.askedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: What Shipped Overnight ────────────────────────────────────

function ShippedOvernightSection() {
  const { data, isLoading, isError } = useQuery<{
    dispatches: CompletedDispatch[];
  }>({
    queryKey: ["/api/founder/dispatches", "completed", "today"],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/dispatches?status=completed&limit=10",
        { credentials: "include" }
      );
      if (!res.ok) return { dispatches: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const dispatches = data?.dispatches ?? [];

  return (
    <Card aria-busy={isLoading} data-testid="shipped-overnight-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCommit className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          What shipped overnight
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading dispatches">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load dispatch history right now.
          </p>
        ) : dispatches.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            headline="Nothing yet"
            subtitle="When agents complete dispatches, the most recent will show up here."
            // TODO(cta): passive surface — no user action when there are no dispatches
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <ul className="space-y-1.5" aria-live="polite">
            {dispatches.slice(0, 10).map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
              >
                <Badge
                  variant="outline"
                  className="text-xs shrink-0 capitalize"
                >
                  {d.agentRole}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-1">
                    {d.summary}
                  </p>
                  {d.commitShas && d.commitShas.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {d.commitShas.slice(0, 3).join(" · ")}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                  {relativeTime(d.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Decisions Waiting (stub) ───────────────────────────────────

function DecisionsWaitingSection() {
  // TODO(phase-?): the founder-decisions queue is a separate schema from
  // agent-asks. Expected shape (provisional):
  //   { id, summary, options[], proposed, dueBy, severity }
  // When the queue ships, replace this stub with a useQuery against
  // /api/founder/decisions?status=pending.
  return (
    <Card data-testid="decisions-waiting-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          Decisions waiting
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <EmptyState
          icon={AlertCircle}
          headline="No decisions waiting"
          subtitle="When Solene escalates something that needs your call, it shows up here."
          // TODO(cta): founder-decisions queue not yet wired — no action surface yet
          cta={{ label: "", _noOp: true }}
        />
      </CardContent>
    </Card>
  );
}

// ─── Section: Chat with Solene (compact panel, Phase 3) ──────────────────
//
// Shows the last 2-3 messages of the most recent active conversation (or an
// invitation to start one), plus a compact input. Sending bootstraps a new
// conversation when there's no active one, otherwise appends to the latest.
// Full chat experience lives at /founder/solene-chat.

interface RecentConversation {
  id: number;
  title: string | null;
  lastMessageAt: string;
}

function ChatWithSoleneSection() {
  const { toast } = useToast();
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [draft, setDraft] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);

  const { data: convoList, refetch: refetchConvos } = useQuery<{
    conversations: RecentConversation[];
  }>({
    queryKey: ["/api/founder/solene-chat/conversations", "today-panel"],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/solene-chat/conversations?archived=false&limit=1",
        { credentials: "include" },
      );
      if (!res.ok) return { conversations: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (activeConversationId == null && convoList?.conversations[0]?.id) {
      setActiveConversationId(convoList.conversations[0].id);
    }
  }, [convoList, activeConversationId]);

  const chat = useSoleneChat({
    conversationId: activeConversationId,
    onError: (err) => {
      toast({
        title: "Chat error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const content: ContentBlock[] = [{ type: "text", text: trimmed }];
    setDraft("");

    if (activeConversationId == null) {
      setBootstrapping(true);
      try {
        const id = await createSoleneConversation();
        setActiveConversationId(id);
        await refetchConvos();
        // Defer the send by one tick so the hook picks up the new id.
        setTimeout(() => {
          void chat.sendMessage(content);
        }, 0);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        clientLogger.error("[TodayChat] bootstrap failed", error);
        toast({
          title: "Couldn't start conversation",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setBootstrapping(false);
      }
      return;
    }

    await chat.sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend();
    }
  };

  // Last 3 messages for preview.
  const recentMessages = chat.messages.slice(-3);

  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="chat-with-solene-section"
    >
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Solene is here
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link
            href="/founder/solene-chat"
            aria-label="Open full chat with Solene"
            data-testid="link-open-full-chat"
          >
            Open full chat
            <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {recentMessages.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Ask Solene about the company, dispatches, capital, or anything
            else on your mind. Sending starts a new conversation.
          </p>
        ) : (
          <div
            className="space-y-2 max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-3"
            aria-live="polite"
            aria-label="Recent messages"
          >
            {recentMessages.map((m, i) => {
              const text = m.content
                .filter(
                  (b): b is { type: "text"; text: string } => b.type === "text",
                )
                .map((b) => b.text)
                .join(" ");
              return (
                <div
                  key={`${m.id}-${i}`}
                  className="flex gap-2 text-xs leading-relaxed"
                >
                  <span className="font-semibold shrink-0 text-muted-foreground capitalize">
                    {m.role}:
                  </span>
                  <span className="text-foreground line-clamp-2">
                    {text || (m.isStreaming ? "…" : "(no text)")}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Solene… (Cmd+Enter to send)"
            aria-label="Message Solene"
            disabled={chat.streaming || bootstrapping}
            rows={2}
            className="flex-1 min-h-[44px] resize-none text-sm"
            data-testid="input-today-solene-chat"
          />
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={
              chat.streaming || bootstrapping || draft.trim().length === 0
            }
            size="icon"
            aria-label="Send message to Solene"
            className="min-h-[44px] min-w-[44px] shrink-0"
            data-testid="button-today-send-solene"
          >
            {chat.streaming || bootstrapping ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function FounderTodayPage() {
  useDocumentTitle("Today · Founder");

  return (
    <PageShell maxWidth="5xl" label="Founder today">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Today
          </h1>
          <p className="text-sm text-muted-foreground">
            Your daily pulse, what's waiting on you, and what shipped overnight.
          </p>
        </header>

        <MorningPulseBanner />

        <div className="grid gap-4 md:gap-6 md:grid-cols-2">
          <ActiveAsksSection />
          <DecisionsWaitingSection />
        </div>

        <ShippedOvernightSection />

        <ChatWithSoleneSection />
      </div>
    </PageShell>
  );
}
