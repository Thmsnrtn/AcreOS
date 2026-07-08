/**
 * /founder/team — the second of the five founder doors (Phase 5 of the Solene
 * migration).
 *
 * Aggregation view of the 12-member roster (canonical agent codenames):
 *
 *   - One card per team member
 *   - Active / Phase 1 / Phase 2 / Phase 3 status badge
 *   - Last-7d dispatch count (completed)
 *   - Open agent-asks count
 *
 * Click-through to a per-agent deep-dive is a TODO until `/founder/dive/agents/:id`
 * ships; cards are non-interactive for now (no broken nav).
 *
 * Data sources:
 *   - `CANONICAL_AGENT_CODENAMES` from shared/schema/agent-codenames.ts
 *   - `GET /api/founder/dispatches?status=completed&limit=100`
 *   - `GET /api/founder/asks?status=open&limit=100`
 *
 * Krieger-bar A11y discipline (same as today.tsx):
 *   - mobile-first responsive (1 col → 2 col → 3 col)
 *   - light + dark via design tokens, no hardcoded colors
 *   - touch targets ≥ 44×44
 *   - aria-busy on loading skeletons
 *   - aria-live on async-loaded sections
 */

import React from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageCircleQuestion, GitCommit, Sparkles, ArrowRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  CANONICAL_AGENT_CODENAMES,
  type CanonicalAgentCodename,
} from "@shared/schema/agent-codenames";

// ─── Roster metadata ─────────────────────────────────────────────────────
//
// Mirrors MEMORY.md "THE TEAM" sections. Status determines the visible
// phase badge and whether the card is dim. The role line is the founder-
// facing description, not the constitution title.

interface AgentMeta {
  codename: CanonicalAgentCodename;
  displayName: string;
  role: string;
  /** active | phase-1 | phase-2 | phase-3 — controls badge + dim. */
  phase: "active" | "phase-1" | "phase-2" | "phase-3";
}

const ROSTER: AgentMeta[] = [
  { codename: "solene", displayName: "Solene", role: "Chief of Staff / COO", phase: "active" },
  { codename: "iris", displayName: "Iris", role: "CTO", phase: "active" },
  { codename: "soren", displayName: "Soren", role: "CGO — brand, content, acquisition", phase: "active" },
  { codename: "beatrice", displayName: "Beatrice", role: "CRO — compliance, legal, security", phase: "active" },
  { codename: "krieger", displayName: "Krieger", role: "Customer-Surface UX", phase: "active" },
  { codename: "maren", displayName: "Maren", role: "CPO — product strategy", phase: "phase-1" },
  { codename: "lena", displayName: "Lena", role: "CFO / CIO — capital allocation", phase: "phase-1" },
  { codename: "rafe", displayName: "Rafe", role: "CCO — customer success", phase: "phase-2" },
  { codename: "andrei", displayName: "Andrei", role: "AI/ML Engineer (Pax)", phase: "phase-2" },
  { codename: "tess", displayName: "Tess", role: "Site Reliability Engineer", phase: "phase-3" },
  { codename: "iyari", displayName: "Iyari", role: "Chief of Future — R&D", phase: "phase-3" },
  { codename: "quinn", displayName: "Quinn", role: "Chief of Alignment", phase: "phase-3" },
  { codename: "henrik", displayName: "Henrik", role: "Founder Coach (optional)", phase: "phase-3" },
];

// Render the static roster as the type system expects (12+1 = 13 entries; the
// migration spec calls "12 members" because Henrik is optional/non-instrumented,
// but we render all 13 so Tom can see the full team-state at a glance).

const PHASE_BADGE_LABEL: Record<AgentMeta["phase"], string> = {
  active: "Active",
  "phase-1": "Phase 1",
  "phase-2": "Phase 2",
  "phase-3": "Phase 3",
};

// ─── API contracts (provisional shape; routes already shipped) ──────────

interface DispatchListItem {
  id: number;
  agentRole: string;
  status: string;
  completedAt: string | null;
  queuedAt: string;
}

interface FounderAskRow {
  id: number;
  askingAgentRole: string;
  status: string;
  askedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function countCompletedLast7d(
  dispatches: DispatchListItem[],
  agent: CanonicalAgentCodename,
): number {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  return dispatches.filter((d) => {
    if (d.agentRole !== agent) return false;
    if (d.status !== "completed") return false;
    if (!d.completedAt) return false;
    const t = new Date(d.completedAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

function countOpenAsks(asks: FounderAskRow[], agent: CanonicalAgentCodename): number {
  return asks.filter((a) => a.askingAgentRole === agent && a.status === "open").length;
}

function initials(name: string): string {
  // First letter of the first word; fallback to the full first char.
  const first = name.trim().charAt(0).toUpperCase();
  return first || "?";
}

// ─── Card ────────────────────────────────────────────────────────────────

function AgentCard({
  meta,
  completedCount,
  openAskCount,
}: {
  meta: AgentMeta;
  completedCount: number;
  openAskCount: number;
}) {
  const dormant = meta.phase !== "active";
  return (
    <motion.div variants={staggerItem}>
      <Link
        href={`/founder/dispatches?agent=${meta.codename}`}
        className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`View ${meta.displayName}'s dispatch history (${completedCount} completed in last 7 days)`}
        data-testid={`team-card-link-${meta.codename}`}
      >
      <Card
        className={`transition-colors hover:border-primary/60 ${dormant ? "opacity-70" : ""}`}
        data-testid={`team-card-${meta.codename}`}
      >
        <CardContent className="p-4 flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold"
            aria-hidden="true"
          >
            {initials(meta.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {meta.displayName}
              </h3>
              <Badge
                variant={meta.phase === "active" ? "default" : "outline"}
                className="text-xs"
              >
                {PHASE_BADGE_LABEL[meta.phase]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {meta.role}
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span
                className="inline-flex items-center gap-1"
                aria-label={`${completedCount} dispatches completed in last 7 days`}
              >
                <GitCommit className="h-3 w-3" aria-hidden="true" />
                {completedCount} / 7d
              </span>
              <span
                className="inline-flex items-center gap-1"
                aria-label={`${openAskCount} open asks`}
              >
                <MessageCircleQuestion className="h-3 w-3" aria-hidden="true" />
                {openAskCount} asks
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      </Link>
    </motion.div>
  );
}

function AgentCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function FounderTeamPage() {
  useDocumentTitle("Team · Founder");

  const dispatchesQuery = useQuery<{ dispatches: DispatchListItem[] }>({
    queryKey: ["/api/founder/dispatches", "completed", "team-page"],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/dispatches?status=completed&limit=100",
        { credentials: "include" },
      );
      if (!res.ok) return { dispatches: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const asksQuery = useQuery<{ asks: FounderAskRow[] }>({
    queryKey: ["/api/founder/asks", "open", "team-page"],
    queryFn: async () => {
      const res = await fetch("/api/founder/asks?status=open&limit=100", {
        credentials: "include",
      });
      if (!res.ok) return { asks: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const isLoading = dispatchesQuery.isLoading || asksQuery.isLoading;
  const isError = dispatchesQuery.isError && asksQuery.isError;
  const dispatches = dispatchesQuery.data?.dispatches ?? [];
  const asks = asksQuery.data?.asks ?? [];

  const activeCount = ROSTER.filter((m) => m.phase === "active").length;

  return (
    <PageShell maxWidth="5xl" label="Founder team">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Team
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} active · {ROSTER.length - activeCount} dormant. Counts
            show completed dispatches in the last 7 days and open asks.
          </p>
        </header>

        {isError ? (
          <QueryErrorState
            error={
              (dispatchesQuery.error as Error | null) ??
              (asksQuery.error as Error | null) ??
              new Error("Failed to load team data")
            }
            onRetry={() => {
              void dispatchesQuery.refetch();
              void asksQuery.refetch();
            }}
            title="Couldn't load team activity"
            description="The team roster is still shown below; the activity counts will reappear when the data loads."
            testId="founder-team-error"
          />
        ) : null}

        <section aria-busy={isLoading} aria-live="polite">
          {isLoading ? (
            <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {ROSTER.map((m) => (
                <AgentCardSkeleton key={m.codename} />
              ))}
            </div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {ROSTER.map((m) => (
                <AgentCard
                  key={m.codename}
                  meta={m}
                  completedCount={countCompletedLast7d(dispatches, m.codename)}
                  openAskCount={countOpenAsks(asks, m.codename)}
                />
              ))}
            </motion.div>
          )}
        </section>

        {/* Roster-completeness sanity check — the canonical list and the rendered
            roster should always stay in sync. If they drift, render a banner so
            Iris notices on the next visit. */}
        {ROSTER.length !== CANONICAL_AGENT_CODENAMES.length && (
          <Card className="border-acr-warn/30 bg-acr-warn/5">
            <CardContent className="p-3 text-xs text-acr-warn">
              Roster drift detected: {ROSTER.length} cards rendered but{" "}
              {CANONICAL_AGENT_CODENAMES.length} canonical codenames exist. Update{" "}
              <code>ROSTER</code> in <code>founder/team.tsx</code>.
            </CardContent>
          </Card>
        )}

        <div className="pt-2 text-center">
          <Link
            href="/founder/solene-chat"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-ask-solene-team"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Ask Solene about the team
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        {/* Marker to keep the Users import live even if iconography shifts. */}
        <span className="sr-only" aria-hidden="true">
          <Users className="h-3 w-3" />
        </span>
      </div>
    </PageShell>
  );
}
