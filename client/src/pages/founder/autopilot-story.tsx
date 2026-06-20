/**
 * /founder/autopilot/story — the glass-box timeline.
 *
 * Every autonomous action, each expandable into its FULL reasoning chain:
 * the senses it read, the options it weighed, its honest forecast, which gate
 * decided, and how it turned out. The proof it works while you sleep — and a
 * pleasure to read rather than a log to audit.
 */

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ScrollText, ChevronDown, CheckCircle2, AlertCircle, PauseCircle, Send } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatRelative } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface TraceSenses {
  mrr: number;
  trials: number;
  supportBacklog: number;
  envelopeStatus: string;
  dispatchBacklog: number;
  openIncidents: number;
  complianceOpenCount: number;
}
interface ReasoningTrace {
  consideredMoves: Array<{ kind: string; priority: number; rationale: string }>;
  chosen: { kind: string; domain: string; playId?: string | null };
  senses: TraceSenses;
  forecast?: { successProb: number; n: number; confidence: string } | null;
  gate: { decision: string; decidedBy?: string };
  outcome: string;
  narrative: string;
  memory?: string | null;
}
interface StoryEntry {
  id: number;
  at: string | null;
  moveKind: string;
  domain: string;
  playId: string | null;
  outcome: string; // acted | escalated | suppressed
  vote: "success" | "failure" | "pending";
  reasoningTrace: ReasoningTrace | null;
}

function prettyKind(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const OUTCOME_META: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  acted: { icon: Send, tone: "text-primary", label: "Acted" },
  escalated: { icon: AlertCircle, tone: "text-acr-warn", label: "Asked you" },
  suppressed: { icon: PauseCircle, tone: "text-muted-foreground", label: "Held" },
};

function voteBadge(vote: StoryEntry["vote"]) {
  if (vote === "success") return <Badge variant="outline" className="border-acr-success/40 text-acr-success text-xs">went well</Badge>;
  if (vote === "failure") return <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">didn't land</Badge>;
  return null;
}

function StoryRow({ entry }: { entry: StoryEntry }) {
  const [open, setOpen] = useState(false);
  const meta = OUTCOME_META[entry.outcome] ?? OUTCOME_META.suppressed;
  const Icon = meta.icon;
  const t = entry.reasoningTrace;
  return (
    <motion.li variants={staggerItem} className="border-b border-border/60 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-2 py-3 text-left min-h-[44px] hover:bg-muted/40 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={open}
        data-testid={`story-row-${entry.id}`}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{prettyKind(entry.moveKind)}</span>
            <Badge variant="secondary" className="text-xs capitalize">{entry.domain}</Badge>
            {voteBadge(entry.vote)}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {t?.narrative ?? `${meta.label}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{entry.at ? formatRelative(entry.at) : ""}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </div>
      </button>
      {open && t && (
        <div className="px-9 pb-4 space-y-3 text-sm" data-testid={`story-detail-${entry.id}`}>
          <TraceBlock label="What I saw">
            {`MRR $${t.senses.mrr} · ${t.senses.trials} trials · ${t.senses.supportBacklog} waiting · runway ${t.senses.envelopeStatus}`}
            {t.senses.openIncidents > 0 ? ` · ${t.senses.openIncidents} incident(s)` : ""}
            {t.senses.complianceOpenCount > 0 ? ` · ${t.senses.complianceOpenCount} compliance` : ""}
          </TraceBlock>
          <TraceBlock label={`Options I weighed (${t.consideredMoves.length})`}>
            {t.consideredMoves.map((m) => prettyKind(m.kind)).join(" · ")}
          </TraceBlock>
          {t.memory && <TraceBlock label="What I remembered">{t.memory}</TraceBlock>}
          {t.forecast && (
            <TraceBlock label="My forecast">
              {t.forecast.confidence === "none"
                ? "No track record yet — couldn't predict honestly."
                : `~${Math.round(t.forecast.successProb * 100)}% likely to go well, from ${t.forecast.n} past run(s) (${t.forecast.confidence} confidence).`}
            </TraceBlock>
          )}
          <TraceBlock label="The gate">
            {t.gate.decision === "pass" ? "Cleared every gate." : `${t.gate.decision}${t.gate.decidedBy ? ` — ${t.gate.decidedBy.replace(/_/g, " ")}` : ""}.`}
          </TraceBlock>
        </div>
      )}
    </motion.li>
  );
}

function TraceBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-foreground/90">{children}</p>
    </div>
  );
}

export default function FounderAutopilotStoryPage() {
  useDocumentTitle("The Story · Founder");
  const { data, isLoading, isError, error, refetch } = useQuery<{ entries: StoryEntry[] }>({
    queryKey: ["/api/founder/autopilot/story"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/story", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load the story (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const entries = data?.entries ?? [];

  const board = useQuery<{ markdown: string; generatedAt: string }>({
    queryKey: ["/api/founder/autopilot/board-report"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/board-report", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load board report (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <PageShell maxWidth="4xl" label="The Story">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-foreground">The Story</h1>
          </div>
          <p className="text-base text-muted-foreground max-w-2xl">
            Everything the system did — and exactly why. Tap any action to see the full reasoning: what it saw, the
            options it weighed, its honest forecast, which gate decided, and how it turned out.
          </p>
        </header>

        {/* The board report — the CEO-to-board summary (OKR progress, decision
            quality, what needs you). Wire-for-real: boardReport + okr. */}
        {board.isLoading ? (
          <Skeleton className="h-40 w-full rounded-card" />
        ) : board.data?.markdown ? (
          <Card>
            <CardContent className="p-5">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground" data-testid="board-report">
                {board.data.markdown}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-card" />
            <Skeleton className="h-16 w-full rounded-card" />
            <Skeleton className="h-16 w-full rounded-card" />
          </div>
        ) : isError ? (
          <QueryErrorState
            error={error instanceof Error ? error : new Error("Failed")}
            title="The story isn't available right now"
            onRetry={() => void refetch()}
          />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="story-empty">
            Nothing here yet. Once the autopilot is acting, every move it makes will appear here with its full reasoning.
          </p>
        ) : (
          <Card>
            <CardContent className="p-2 sm:p-3">
              <motion.ul variants={staggerContainer} initial="hidden" animate="visible">
                {entries.map((e) => (
                  <StoryRow key={e.id} entry={e} />
                ))}
              </motion.ul>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
