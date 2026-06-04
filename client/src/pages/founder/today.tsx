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

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sun,
  HelpCircle,
  GitCommit,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Sparkles,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";

// ─── API contracts (provisional; some endpoints are stubs until later phases) ──

/**
 * GET /api/founder/solene/morning-pulse — Phase 7
 * Shape (provisional):
 *   { generatedAt: string, headline: string, body: string[], asOf: string }
 */
interface MorningPulse {
  generatedAt: string;
  headline: string;
  body: string[];
  asOf: string;
}

/** GET /api/founder/asks — already shipped (L6.32). Compact shape. */
interface FounderAsk {
  id: number;
  agentRole: string;
  question: string;
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
// Phase 7 will wire /api/founder/solene/morning-pulse. Until then, this
// renders a clearly-marked TODO with the expected shape documented above.

function MorningPulseBanner() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // TODO(phase-7): replace stub with `useQuery<MorningPulse>` against
  // /api/founder/solene/morning-pulse. Endpoint comes online in Phase 7.
  // Explicit annotation keeps TS from narrowing to `never` when literally null.
  const pulse = null as MorningPulse | null;

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
            {pulse ? (
              <>
                <p className="mt-2 text-base font-medium text-foreground">
                  {pulse.headline}
                </p>
                {pulse.body.map((line, i) => (
                  <p
                    key={i}
                    className="mt-1 text-sm text-muted-foreground leading-relaxed"
                  >
                    {line}
                  </p>
                ))}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Solene's daily pulse generator comes online in Phase 7. Until
                then, this banner stays a placeholder. Expected shape:{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {`{ headline, body[], asOf }`}
                </code>{" "}
                from <code className="text-xs">GET /api/founder/solene/morning-pulse</code>.
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
                  {ask.agentRole}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-2">
                    {ask.question}
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

// ─── Section: Chat with Solene (stub until Phase 2 + Phase 3) ────────────

function ChatWithSoleneSection() {
  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="chat-with-solene-section"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles
            className="h-4 w-4 text-primary"
            aria-hidden="true"
          />
          Chat with Solene
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          The in-app Solene chat surface arrives in Phase 3. The backend
          (Phase 2) is being built in parallel. Until both land, use the
          Claude Code CLI session you already have open.
        </p>
        <Button
          asChild
          disabled
          variant="outline"
          aria-disabled="true"
          className="cursor-not-allowed opacity-60"
        >
          <span>
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Open chat (Phase 3)
          </span>
        </Button>
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
