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
import { ScrollText, ChevronDown, CheckCircle2, AlertCircle, PauseCircle, Send, ShieldCheck } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryErrorState } from "@/components/query-error-state";
import { FounderAuthError } from "@/components/founder/FounderAuthError";
import { FounderPulseStrip } from "@/components/founder/PulseStrip";
import { GlassEngine } from "@/components/founder/GlassEngine";
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
  // Only the play/decision traces carry the rich reasoning shape. Governance
  // traces (gate_watch, gate_ripened — see server/services/autopilot/gateWatcher.ts)
  // and partial/legacy rows emit just { narrative, ... } WITHOUT
  // senses/consideredMoves/gate, so every rich field is optional and must be
  // guarded before access.
  consideredMoves?: Array<{ kind: string; priority: number; rationale: string }>;
  chosen?: { kind: string; domain: string; playId?: string | null };
  senses?: TraceSenses;
  forecast?: { successProb: number; n: number; confidence: string } | null;
  gate?: { decision: string; decidedBy?: string };
  outcome?: string;
  narrative?: string;
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

/**
 * Tiny line-grammar renderer for the board report (repo convention: no
 * markdown dependency — see solene/MessageBubble.tsx). The report emits
 * exactly `# title`, `## section`, `- bullet`, and plain paragraphs; the
 * previous raw <pre> showed the founder literal #/## marks.
 */
function BoardReportText({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={key} className="list-disc pl-5 space-y-1 text-sm leading-relaxed text-foreground">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      return;
    }
    flushBullets(`ul-${i}`);
    if (line.startsWith("## ")) {
      out.push(
        <h3 key={i} className="text-sm font-semibold text-foreground mt-4 first:mt-0">
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      out.push(
        <h2 key={i} className="text-base font-bold text-foreground">
          {line.slice(2)}
        </h2>,
      );
    } else if (line.trim().length > 0) {
      out.push(
        <p key={i} className="text-sm leading-relaxed text-foreground">
          {line}
        </p>,
      );
    }
  });
  flushBullets("ul-end");
  return <div className="space-y-2">{out}</div>;
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
      {open && t && (() => {
        // Governance/legacy traces lack the rich reasoning fields. Detect
        // whether ANY rich block is present; if none is, show an honest
        // fallback rather than crashing on t.senses.mrr etc.
        const hasRich = !!(t.senses || t.consideredMoves || t.gate || t.forecast || t.memory);
        return (
          <div className="px-9 pb-4 space-y-1.5 text-sm" data-testid={`story-detail-${entry.id}`}>
            {t.senses && (
              <TraceBlock label="What I saw">
                {`MRR $${t.senses.mrr} · ${t.senses.trials} trials · ${t.senses.supportBacklog} waiting · runway ${t.senses.envelopeStatus}`}
                {t.senses.openIncidents > 0 ? ` · ${t.senses.openIncidents} incident(s)` : ""}
                {t.senses.complianceOpenCount > 0 ? ` · ${t.senses.complianceOpenCount} compliance` : ""}
              </TraceBlock>
            )}
            {t.consideredMoves && (
              <TraceBlock label={`Options I weighed (${t.consideredMoves.length})`}>
                {t.consideredMoves.map((m) => prettyKind(m.kind)).join(" · ")}
              </TraceBlock>
            )}
            {t.memory && <TraceBlock label="What I remembered">{t.memory}</TraceBlock>}
            {t.forecast && (
              <TraceBlock label="My forecast">
                {t.forecast.confidence === "none"
                  ? "No track record yet — couldn't predict honestly."
                  : `~${Math.round(t.forecast.successProb * 100)}% likely to go well, from ${t.forecast.n} past run(s) (${t.forecast.confidence} confidence).`}
              </TraceBlock>
            )}
            {t.gate && (
              <TraceBlock label="The gate">
                {t.gate.decision === "pass" ? "Cleared every gate." : `${t.gate.decision}${t.gate.decidedBy ? ` — ${t.gate.decidedBy.replace(/_/g, " ")}` : ""}.`}
              </TraceBlock>
            )}
            {!hasRich && (
              <p className="text-muted-foreground italic" data-testid={`story-detail-sparse-${entry.id}`}>
                No detailed reasoning captured for this entry.
              </p>
            )}
          </div>
        );
      })()}
    </motion.li>
  );
}

// ── Governance — the Story as a reader of the two governance registries ─────
// (F5-lite). The payload is a pure read of shared/governance/constitution.ts +
// statuteRegister.ts via /api/founder/governance/coverage — every number below
// IS the registries' content, nothing is computed client-side beyond display.

interface GovernanceCoverageReport {
  asOf: string;
  constitution: {
    total: number;
    enforced: number;
    byKind: Record<string, number>;
    unenforcedHardStops: { count: number; ids: string[] };
    entries: Array<{ id: string; title: string; category: string; kind: string; refs: string[] }>;
  };
  statutes: {
    total: number;
    reviewed: number;
    byKind: Record<string, number>;
    unreviewed: { count: number; ids: string[] };
    entries: Array<{ id: string; title: string; kind: string; refs: string[]; reviewStatus: string }>;
  };
}

// Plain words for the enforcement vocabulary — never render a raw kind token
// at the founder (same discipline as the Letter's BUDGET_STATUS).
const ENFORCEMENT_LABEL: Record<string, { label: string; strong: boolean }> = {
  // Constitution kinds
  "code-invariant": { label: "enforced in code", strong: true },
  "ratchet-test": { label: "ratchet test", strong: true },
  lint: { label: "lint gate", strong: true },
  "prose-only": { label: "prose only — no automated backstop", strong: false },
  // Statute kinds
  "unit-test": { label: "unit-tested", strong: true },
  ratchet: { label: "ratchet test", strong: true },
  "refusal-path": { label: "refuses in code, refusal untested", strong: false },
};

function enforcementBadge(kind: string) {
  const meta = ENFORCEMENT_LABEL[kind] ?? { label: kind, strong: false };
  return (
    <Badge
      variant="outline"
      className={`text-xs ${meta.strong ? "border-acr-success/40 text-acr-success" : "border-acr-warn/40 text-acr-warn"}`}
    >
      {meta.label}
    </Badge>
  );
}

function GovernanceEntryRow({
  title,
  sub,
  kind,
  refs,
  extraBadge,
  testId,
}: {
  title: string;
  sub: string;
  kind: string;
  refs: string[];
  extraBadge?: ReactNode;
  testId: string;
}) {
  return (
    <li className="border-b border-border/60 px-2 py-3 last:border-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {enforcementBadge(kind)}
        {extraBadge}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      {refs.length > 0 && (
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground/80 break-all">
          {refs.join(" · ")}
        </p>
      )}
    </li>
  );
}

/**
 * The rules, read straight from the registries: what's enforced by code, what
 * still relies on vigilance, and which statutes a human has actually read.
 * Self-contained fetch so a timeline hiccup never hides the rules.
 */
function GovernanceSection() {
  const { data, isLoading, isError, error, refetch } = useQuery<GovernanceCoverageReport>({
    queryKey: ["/api/founder/governance/coverage"],
    queryFn: async () => {
      const res = await fetch("/api/founder/governance/coverage", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load governance coverage (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : new Error("Failed")}
        title="Couldn't read the governance registries"
        onRetry={() => void refetch()}
      />
    );
  }

  const c = data.constitution;
  const s = data.statutes;
  return (
    <div className="space-y-4" data-testid="story-governance">
      {/* The two headline fractions — the same rollups the ratchets pin. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3" data-testid="governance-constitution-rollup">
          <p className="text-xs text-muted-foreground">Standing decisions machine-enforced</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {c.enforced} of {c.total}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {c.unenforcedHardStops.count === 0
              ? "Every hard stop has an automated backstop."
              : `${c.unenforcedHardStops.count} hard stop(s) still rely on vigilance alone.`}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3" data-testid="governance-statutes-rollup">
          <p className="text-xs text-muted-foreground">Statute implementations human-reviewed</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {s.reviewed} of {s.total}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {s.unreviewed.count === 0
              ? "Every statute implementation has been read by a human."
              : `${s.unreviewed.count} implement a law no one has reviewed yet.`}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center gap-2 px-2 pt-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">The constitution — standing decisions</h2>
          </div>
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            Each decision below is recorded doctrine, with exactly how it is enforced today. Changing one is
            founder-only, at its source — this page only reads.
          </p>
          <ul role="list" className="mt-2">
            {c.entries.map((entry) => (
              <GovernanceEntryRow
                key={entry.id}
                title={entry.title}
                sub={entry.id}
                kind={entry.kind}
                refs={entry.refs}
                testId={`governance-invariant-${entry.id}`}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2 sm:p-3">
          <div className="flex items-center gap-2 px-2 pt-2">
            <ScrollText className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">The statute register — laws this code implements</h2>
          </div>
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            A map, not a claim of compliance: where the code takes a legal obligation on, and who has checked it.
          </p>
          <ul role="list" className="mt-2">
            {s.entries.map((entry) => (
              <GovernanceEntryRow
                key={entry.id}
                title={entry.title}
                sub={entry.id}
                kind={entry.kind}
                refs={entry.refs}
                extraBadge={
                  entry.reviewStatus === "UNREVIEWED" ? (
                    <Badge variant="outline" className="border-acr-warn/40 text-acr-warn text-xs">
                      unreviewed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-acr-success/40 text-acr-success text-xs">
                      {entry.reviewStatus.replace(/-/g, " ")}
                    </Badge>
                  )
                }
                testId={`governance-statute-${entry.id}`}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// Compact, scannable trace row: the label sits in a fixed left column on
// desktop (label | value on one line) and stacks above the value on mobile.
// Same information as before, ~40% less vertical sprawl per action.
function TraceBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:w-36 sm:pt-px">{label}</p>
      <p className="min-w-0 text-foreground/90">{children}</p>
    </div>
  );
}

const STORY_TABS = ["timeline", "engine", "governance"] as const;

// Deep-link support (?tab=governance — the Letter's "rules that are code" row
// lands here). Same URL-read pattern as founder/studio.tsx.
function readStoryTabFromUrl(): (typeof STORY_TABS)[number] {
  if (typeof window === "undefined") return "timeline";
  const param = new URLSearchParams(window.location.search).get("tab");
  if (param && (STORY_TABS as readonly string[]).includes(param)) return param as (typeof STORY_TABS)[number];
  return "timeline";
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
      {/* F1 — ambient liveness on every door (experience-legibility.md) */}
      <div className="mb-4"><FounderPulseStrip /></div>
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
            <CardContent className="p-5" data-testid="board-report">
              <BoardReportText markdown={board.data.markdown} />
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
          <FounderAuthError
            error={error instanceof Error ? error : new Error("Failed")}
            title="The story isn't available right now"
            onRetry={() => void refetch()}
          />
        ) : (
          <Tabs defaultValue={readStoryTabFromUrl()}>
            <TabsList>
              <TabsTrigger value="timeline" data-testid="story-tab-timeline">The timeline</TabsTrigger>
              <TabsTrigger value="engine" data-testid="story-tab-engine">The engine</TabsTrigger>
              <TabsTrigger value="governance" data-testid="story-tab-governance">The rules</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="mt-4">
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="story-empty">
                  Nothing here yet. Once the autopilot is acting, every move it makes will appear here with its full
                  reasoning.
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
            </TabsContent>
            <TabsContent value="engine" className="mt-4">
              {/* The Engine derives from the SAME loaded entries as the
                  timeline — a failed load is caught by the shared error
                  branch above, so it never renders "no moves yet" over a
                  fetch failure. */}
              <GlassEngine entries={entries} />
            </TabsContent>
            <TabsContent value="governance" className="mt-4">
              {/* The rules the engine runs under — read straight from the two
                  governance registries. Own fetch + own states. */}
              <GovernanceSection />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PageShell>
  );
}
