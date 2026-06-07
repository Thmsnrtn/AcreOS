/**
 * /founder — Solene's daily pulse, rendered as a pull-first CEO surface.
 *
 * Founder-gated. Shows everything Tom needs in one calm scroll:
 *   1. Daily one-line header (the same data ntfy pushes)
 *   2. Autonomy Horizon — big number + 5-axis breakdown
 *   3. Capital position — MRR / burn / runway / draw projection
 *   4. Phase + OKR strip
 *   5. Team activity — last 5 commits
 *   6. Decisions waiting
 *   7. Deep Tools links
 *
 * Design discipline (Kai's bar):
 *   - Fraunces serif for the big Horizon number (tabular-nums)
 *   - One typography hierarchy: display → title → body → label
 *   - One color story: --acr-* tokens throughout
 *   - Mobile-first: single column on phones, 2-col grid at md+
 *   - Every number contextualized with what it means
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  GitCommit,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Users,
  Target,
  Zap,
  Shield,
  Heart,
  BarChart2,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { cn } from "@/lib/utils";

// ─── API types ────────────────────────────────────────────────────────────

interface AxisScore {
  score: number;
  days: number;
  label: string;
  evidence: string;
}

interface AutonomyHorizon {
  days: number;
  weakestLink: string;
  axes: {
    stability: AxisScore;
    reserves: AxisScore;
    compliance: AxisScore;
    customerHealth: AxisScore;
    decisionVelocity: AxisScore;
  };
}

interface CommitRow {
  sha: string;
  shortSha: string;
  author: string;
  message: string;
  date: string;
  githubUrl: string;
}

interface PhaseInfo {
  name: string;
  label: string;
  daysIn: number;
  okr: string;
  okrTargetMrr: number;
  okrDeadline: string;
  progressPct: number;
}

interface PulseResponse {
  asOf: string;
  sha: string;
  health: number;
  commitsLast24h: number;
  recentCommits: CommitRow[];
  mrr: number;
  burnRate: number;
  runwayMonths: number | null;
  runwayLabel: string;
  founderDrawTarget: number;
  founderDrawMrrTrigger: number;
  autonomyHorizon: AutonomyHorizon;
  phase: PhaseInfo;
  decisionsWaiting: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtCommitDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// Color an axis bar based on score: red <35, amber <60, green ≥60
function axisBarColor(score: number): string {
  if (score < 35) return "bg-rose-500";
  if (score < 60) return "bg-amber-400";
  return "bg-emerald-500";
}

function axisTextColor(score: number): string {
  if (score < 35) return "text-rose-500";
  if (score < 60) return "text-amber-500";
  return "text-emerald-500";
}

const AXIS_ICONS: Record<string, React.ElementType> = {
  Stability: Activity,
  Reserves: DollarSign,
  Compliance: Shield,
  "Customer Health": Heart,
  "Decision Velocity": Zap,
};

// ─── Skeleton shapes ──────────────────────────────────────────────────────

function PulseSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <Skeleton className="h-12 w-3/4 rounded-xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

// 1. Daily one-line header
function OneLiner({ data }: { data: PulseResponse }) {
  const day = new Date(data.asOf).toLocaleDateString("en-US", { weekday: "long" });
  const date = new Date(data.asOf).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const mrr = `$${data.mrr.toFixed(0)} MRR`;
  return (
    <motion.div variants={staggerItem} className="rounded-2xl bg-[var(--acr-surface,hsl(var(--muted)))] px-5 py-4 border border-border/40">
      <p className="text-xs font-medium text-muted-foreground tracking-widest uppercase mb-1">Daily one-line</p>
      <p className="text-sm text-foreground font-mono leading-relaxed break-all">
        <span className="font-semibold">{day}</span>
        {" "}{date}
        {" · "}acreos@<span className="text-primary">{data.sha.slice(0, 7)}</span>
        {" · "}health {data.health}
        {" · "}{data.commitsLast24h} commit{data.commitsLast24h !== 1 ? "s" : ""} 24h
        {" · "}{data.phase.name}
        {" · "}{mrr}
      </p>
    </motion.div>
  );
}

// 2. Autonomy Horizon
function HorizonPanel({ data }: { data: PulseResponse }) {
  const h = data.autonomyHorizon;
  const axes = [
    h.axes.stability,
    h.axes.reserves,
    h.axes.compliance,
    h.axes.customerHealth,
    h.axes.decisionVelocity,
  ];

  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Autonomy Horizon
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Big number */}
          <div className="flex items-end gap-3">
            <span
              className="text-7xl font-bold tabular-nums leading-none tracking-tight text-foreground"
              style={{ fontFamily: "'Fraunces', 'Georgia', serif" }}
            >
              {h.days}
            </span>
            <div className="pb-2">
              <p className="text-lg font-medium text-muted-foreground">days</p>
              <p className="text-xs text-muted-foreground">Tom can step away</p>
            </div>
          </div>

          {/* Weakest link callout */}
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 px-4 py-2.5">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" aria-hidden="true" />
            <p className="text-sm text-rose-700 dark:text-rose-400">
              <span className="font-semibold">Weakest link:</span> {h.weakestLink}
            </p>
          </div>

          {/* 5-axis bars */}
          <div className="space-y-3">
            {axes.map((ax) => {
              const Icon = AXIS_ICONS[ax.label] ?? BarChart2;
              return (
                <div key={ax.label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-3.5 h-3.5 shrink-0", axisTextColor(ax.score))} aria-hidden="true" />
                      <span className="text-sm font-medium text-foreground">{ax.label}</span>
                    </div>
                    <span className={cn("text-sm font-semibold tabular-nums", axisTextColor(ax.score))}>
                      {ax.score}
                    </span>
                  </div>
                  {/* Bar track */}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-label={`${ax.label} score: ${ax.score} out of 100`}>
                    <motion.div
                      className={cn("h-full rounded-full", axisBarColor(ax.score))}
                      initial={{ width: 0 }}
                      animate={{ width: `${ax.score}%` }}
                      transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{ax.evidence}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// 3. Capital position
function CapitalPanel({ data }: { data: PulseResponse }) {
  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Capital Position
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Metric
              label="MRR"
              value={`$${data.mrr.toFixed(0)}`}
              sub="monthly recurring revenue"
              highlight={data.mrr === 0}
              highlightMsg="Pre-revenue — Phase Zero-Zero"
            />
            <Metric
              label="Burn rate"
              value={`$${data.burnRate.toFixed(0)}/mo`}
              sub="Fly.io infra + domain"
            />
            <Metric
              label="Runway"
              value={data.runwayLabel}
              sub="Tom is floating infra personally"
            />
            <div className="pt-1 border-t border-border/40">
              <p className="text-xs text-muted-foreground mb-1">Founder draw</p>
              <p className="text-sm font-semibold text-foreground">
                ${data.founderDrawTarget.toLocaleString()}/mo at ${data.founderDrawMrrTrigger.toLocaleString()} MRR
              </p>
              <p className="text-xs text-muted-foreground">Phase 2 gate — currently ${data.mrr.toFixed(0)} of ${data.founderDrawMrrTrigger} needed</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Metric({ label, value, sub, highlight = false, highlightMsg }: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  highlightMsg?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
      {highlight && highlightMsg
        ? <p className="text-xs text-amber-500">{highlightMsg}</p>
        : <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// 4. Phase + OKR strip
function PhasePanel({ data }: { data: PulseResponse }) {
  const p = data.phase;
  const deadlineDate = new Date(p.okrDeadline);
  const daysToDeadline = Math.max(0, Math.round(
    (deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  ));

  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Phase + OKR
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-xs font-medium">{p.name}</Badge>
              <span className="text-xs text-muted-foreground">— {p.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">Day {p.daysIn} of this phase</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Active OKR</p>
            <p className="text-sm font-medium text-foreground">{p.okr}</p>
            <p className="text-xs text-muted-foreground mt-1">{daysToDeadline} days to deadline</p>
          </div>

          {/* MRR progress bar toward OKR target */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>${(data.mrr).toFixed(0)} MRR</span>
              <span>${p.okrTargetMrr} target</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden" aria-label={`OKR progress: ${p.progressPct}%`}>
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(1, p.progressPct)}%` }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-right">{p.progressPct}% there</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// 5. Team activity
function TeamActivityPanel({ commits }: { commits: CommitRow[] }) {
  if (commits.length === 0) {
    return (
      <motion.div variants={staggerItem}>
        <EmptyState
          headline="No commits found"
          subtitle="Git log returned no results. This is unusual — check the server logs."
          icon={GitCommit}
          // TODO(cta): git log view — no user action creates commits; check server logs via the Fly dashboard
          cta={{ label: "", _noOp: true }}
        />
      </motion.div>
    );
  }

  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Team Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3" role="list" aria-label="Recent commits">
            {commits.map((c) => (
              <li key={c.sha} className="flex items-start gap-3 group">
                <GitCommit className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground line-clamp-2 leading-snug">{c.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.author} · <span className="font-mono">{c.shortSha}</span> · {fmtCommitDate(c.date)}
                  </p>
                </div>
                <a
                  href={c.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View commit ${c.shortSha} on GitHub`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 mt-0.5"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// 6. Decisions waiting
function DecisionsPanel({ count }: { count: number }) {
  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Decisions Waiting
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {count === 0 ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">0 decisions waiting</p>
                <p className="text-xs text-muted-foreground">Task-tracking wires in at Phase 1</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">{count} decision{count !== 1 ? "s" : ""} waiting</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// 7. Deep Tools
interface DeepToolLink {
  label: string;
  href: string;
  description: string;
  icon: React.ElementType;
}

const DEEP_TOOLS: DeepToolLink[] = [
  {
    label: "Customers",
    href: "/founder/customers",
    description: "Paid / trial / churned counts + UTM sources",
    icon: Users,
  },
  {
    label: "Pax traces",
    href: "/founder/pax-traces",
    description: "Every Pax LLM call — prompts, tool calls, guardrails",
    icon: Activity,
  },
  {
    label: "Pax calibration",
    href: "/founder/pax-calibration",
    description: "Predicted vs. realized accept-rate reliability diagram",
    icon: Target,
  },
  {
    label: "Life-Cockpit",
    href: "/founder/life-cockpit",
    description: "Your personal taxes, income, deadlines + encrypted document vault",
    icon: Heart,
  },
];

function DeepToolsPanel() {
  return (
    <motion.div variants={staggerItem}>
      <Card className="border-border/40 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">
            Deep Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" role="list">
            {DEEP_TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <li key={tool.href}>
                  <Link
                    href={tool.href}
                    className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-muted transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Icon className="w-4 h-4 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{tool.label}</p>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function FounderPulsePage() {
  useDocumentTitle("Pulse — Founder");

  const { data, isLoading, error, refetch } = useQuery<PulseResponse>({
    queryKey: ["/api/founder/pulse"],
    queryFn: async () => {
      const res = await fetch("/api/founder/pulse", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<PulseResponse>;
    },
    staleTime: 60 * 1000,       // 1 min — pulse data doesn't change second-to-second
    refetchInterval: 5 * 60 * 1000, // background refresh every 5 min
  });

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-2">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Pulse</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? fmtDate(data.asOf) : "Loading…"}
          </p>
        </div>

        {isLoading && <PulseSkeleton />}

        {error && (
          <QueryErrorState
            error={error as Error}
            onRetry={() => void refetch()}
          />
        )}

        {data && (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-4"
          >
            {/* 1. One-line header */}
            <OneLiner data={data} />

            {/* 2. Autonomy Horizon — the most important signal */}
            <HorizonPanel data={data} />

            {/* 3 + 4. Capital + Phase — two equal-weight cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CapitalPanel data={data} />
              <PhasePanel data={data} />
            </div>

            {/* 5. Team activity */}
            <TeamActivityPanel commits={data.recentCommits} />

            {/* 6. Decisions waiting */}
            <DecisionsPanel count={data.decisionsWaiting} />

            {/* 7. Deep tools */}
            <DeepToolsPanel />
          </motion.div>
        )}
      </div>
    </PageShell>
  );
}
