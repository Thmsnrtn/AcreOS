/**
 * Founder home (D6) — the single fused home. Composes the best of the three
 * overlapping overview surfaces into one canonical board-report home:
 *   • The Letter's board report (the narrative + the one decision that needs you)
 *     — from /api/founder/solene/brief
 *   • A Pulse vital-sign strip (MRR · trials · spend · runway-health · uptime)
 *   • A chat entry ("Talk to your company")
 *   • A hub grid linking to the deeper, specialized surfaces (Decisions, live
 *     telemetry/Bridge, Story, Voice, Control) so nothing is lost.
 *
 * Replaces the old /founder (Pulse) + /founder/autopilot (Letter) overviews,
 * which now redirect here. Built from the verified founder/autopilot.tsx patterns.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, CheckCircle2, MessageSquare, ArrowUpRight, ListChecks, Activity, BookOpen, Mic, SlidersHorizontal, Gauge, Newspaper, TrendingUp, LayoutGrid } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageShell } from "@/components/page-shell";
import { PrefetchLink } from "@/components/prefetch-link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

interface FounderBrief {
  greeting: string;
  theWord: string;
  neededLine: string;
  isFounderNeeded: boolean;
  decision: { askId: number; urgency: "urgent" | "normal" | "low"; summary: string } | null;
  vitalSign: {
    mrr: number;
    trials: number;
    weeklySpendUsd: number;
    /** "unknown" when the pulse couldn't be read — rendered as "no data yet", never a guessed green. */
    envelopeStatus: "green" | "amber" | "red" | "unknown";
    /** Measured uptime; null until enough real heartbeat data exists. */
    uptimePct: number | null;
    /** Weeks of runway at current burn; null when not burning / unknown. */
    runwayWeeks: number | null;
    /** Week-over-week MRR change (signed %); null when no real prior datapoint. */
    mrrWowPct: number | null;
    /** Wedge throughput (7d): outreach sent, replies in, offers made. null when unreadable. */
    wedge: { outreachSent7d: number; replies7d: number; offers7d: number } | null;
    /** 5xx rate over the last 24h (percent). null when no traffic recorded. */
    errorRatePct: number | null;
    /** Deployed version (short SHA). null when unknown. */
    prodVersion: string | null;
  };
  /** The brain's current focus, in plain language (observational). Real, already computed server-side. */
  focusLine: string | null;
}

/** Signed WoW percent → a short, signed label ("↑3%" / "↓2%" / "flat"). */
function wowLabel(pct: number): string {
  if (pct === 0) return "flat wk/wk";
  return `${pct > 0 ? "↑" : "↓"}${Math.abs(pct)}% wk/wk`;
}

// Plain-language budget status — never render the raw "amber" token at a CEO.
// Interprets the real envelopeStatus into words + keeps the color tone.
// "unknown" (pulse unreadable) says so — it is never dressed up as green.
const BUDGET_STATUS: Record<"green" | "amber" | "red" | "unknown", { label: string; tone?: "amber" | "red" }> = {
  green: { label: "On track" },
  amber: { label: "Getting tight", tone: "amber" },
  red: { label: "Needs attention", tone: "red" },
  unknown: { label: "No data yet" },
};

const HUB = [
  { href: "/founder/decisions", icon: ListChecks, label: "Decisions", desc: "Everything awaiting your tap" },
  { href: "/founder/command", icon: Gauge, label: "System health", desc: "Is the company green? Per-domain status" },
  { href: "/founder/bridge", icon: Activity, label: "Live telemetry", desc: "Real-time metrics + chat bridge" },
  { href: "/founder/feed", icon: Newspaper, label: "Activity feed", desc: "Feedback, agent events, proposals" },
  { href: "/founder/steering", icon: TrendingUp, label: "Monthly review", desc: "Trends + the strategic check-in" },
  { href: "/founder/autopilot/story", icon: BookOpen, label: "The story", desc: "Glass-box: every action + why" },
  { href: "/founder/autopilot/voice", icon: Mic, label: "Your voice", desc: "Standing orders + objectives" },
  { href: "/founder/autopilot/control", icon: SlidersHorizontal, label: "Controls", desc: "Switches, trust levels, budgets" },
  { href: "/founder/all-tools", icon: LayoutGrid, label: "All instruments", desc: "Costs, telemetry, agents, prompts — the deep panels" },
];

export default function FounderHomePage() {
  useDocumentTitle("Your company · Founder");
  const { data, isLoading, error, refetch } = useQuery<{ brief: FounderBrief }>({
    queryKey: ["/api/founder/solene/brief"],
    queryFn: async () => (await apiRequest("GET", "/api/founder/solene/brief")).json(),
    staleTime: 5 * 60 * 1000,
  });

  const brief = data?.brief;

  return (
    <PageShell maxWidth="4xl" label="Your company">
      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error ? (
        <QueryErrorState error={error as Error} onRetry={() => refetch()} title="Couldn't load your company's brief" />
      ) : !brief ? (
        <QueryErrorState error={new Error("No brief available")} onRetry={() => refetch()} title="No brief yet" />
      ) : (
        <motion.div className="space-y-5" variants={staggerContainer} initial="hidden" animate="visible">
          {/* Lead with the one thing that matters: does the founder need to act? */}
          <motion.div variants={staggerItem}>
            <p className="text-sm text-muted-foreground">{brief.greeting}</p>
            <h1 className="mt-1 font-serif text-2xl leading-snug md:text-3xl">{brief.neededLine}</h1>
          </motion.div>

          {/* What needs you — the one decision, or the all-clear */}
          <motion.div variants={staggerItem}>
            {brief.decision ? (
              <Card className="border-l-4 border-l-primary">
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span className="text-sm font-semibold">A decision needs you</span>
                      <Badge variant={brief.decision.urgency === "urgent" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                        {brief.decision.urgency}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{brief.decision.summary}</p>
                  </div>
                  <PrefetchLink
                    href={`/founder/asks?id=${brief.decision.askId}`}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    Review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </PrefetchLink>
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4">
                <CheckCircle2 className="h-5 w-5 text-[hsl(var(--acr-pos))]" aria-hidden="true" />
                <p className="text-sm font-medium">Nothing needs you right now — the company is running itself.</p>
              </div>
            )}
          </motion.div>

          {/* The Word — the board narrative, now supporting context (not the headline) */}
          <motion.div variants={staggerItem}>
            <p className="text-sm leading-relaxed text-muted-foreground">{brief.theWord}</p>
            {brief.focusLine ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground">{brief.focusLine}</p>
            ) : null}
          </motion.div>

          {/* The standing answer to "can I leave?" — one line, links to Controls */}
          <motion.div variants={staggerItem}>
            <StepAwayLine />
          </motion.div>

          {/* The vital sign — Pulse strip */}
          <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <VitalStat
              label="MRR"
              value={usd(brief.vitalSign.mrr, { noCents: true })}
              sub={brief.vitalSign.mrrWowPct != null ? wowLabel(brief.vitalSign.mrrWowPct) : undefined}
              subTone={brief.vitalSign.mrrWowPct != null && brief.vitalSign.mrrWowPct < 0 ? "amber" : undefined}
            />
            <VitalStat label="Trials" value={String(brief.vitalSign.trials)} />
            <VitalStat label="7-day spend" value={usd(brief.vitalSign.weeklySpendUsd, { noCents: true })} />
            <VitalStat
              label="Budget"
              value={BUDGET_STATUS[brief.vitalSign.envelopeStatus].label}
              tone={BUDGET_STATUS[brief.vitalSign.envelopeStatus].tone}
              sub={brief.vitalSign.runwayWeeks != null ? `~${brief.vitalSign.runwayWeeks} wks runway` : undefined}
            />
            <VitalStat
              label="Uptime"
              value={brief.vitalSign.uptimePct != null ? `${brief.vitalSign.uptimePct.toFixed(1)}%` : "—"}
              sub={
                brief.vitalSign.uptimePct == null
                  ? "no data yet"
                  : brief.vitalSign.prodVersion
                    ? `on ${brief.vitalSign.prodVersion.slice(0, 7)}`
                    : undefined
              }
            />
          </motion.div>

          {/* The wedge + platform health — the launch-week funnel at a glance */}
          <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <VitalStat
              label="Outreach (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.outreachSent7d) : "—"}
              sub={brief.vitalSign.wedge ? undefined : "no data yet"}
            />
            <VitalStat
              label="Replies (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.replies7d) : "—"}
              sub={brief.vitalSign.wedge ? undefined : "no data yet"}
            />
            <VitalStat
              label="Offers (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.offers7d) : "—"}
              sub={brief.vitalSign.wedge ? undefined : "no data yet"}
            />
            <VitalStat
              label="Errors (24h)"
              value={brief.vitalSign.errorRatePct != null ? `${brief.vitalSign.errorRatePct.toFixed(1)}%` : "—"}
              tone={brief.vitalSign.errorRatePct != null && brief.vitalSign.errorRatePct >= 1 ? "red" : undefined}
              sub={brief.vitalSign.errorRatePct == null ? "no traffic yet" : "5xx share of requests"}
            />
          </motion.div>

          {/* Talk to your company */}
          <motion.div variants={staggerItem}>
            <PrefetchLink
              href="/founder/solene-chat"
              className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-medium hover-elevate"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Talk to your company
            </PrefetchLink>
          </motion.div>

          {/* Hub — the deeper surfaces */}
          <motion.ul variants={staggerItem} role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {HUB.map((h) => {
              const Icon = h.icon;
              return (
                <li key={h.href}>
                  <PrefetchLink href={h.href} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover-elevate">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{h.label}</p>
                      <p className="text-xs text-muted-foreground">{h.desc}</p>
                    </div>
                  </PrefetchLink>
                </li>
              );
            })}
          </motion.ul>
        </motion.div>
      )}
    </PageShell>
  );
}

/**
 * One-line step-away verdict on the daily read, backed by the machine-verified
 * readiness endpoint. Renders nothing while loading or on error — the Letter
 * must never block on an auxiliary signal.
 */
function StepAwayLine() {
  const { data } = useQuery<{ verdict: "ready" | "not_ready"; headline: string; horizonDays: number }>({
    queryKey: ["/api/founder/autopilot/step-away"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/step-away", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;
  const ready = data.verdict === "ready";
  return (
    <PrefetchLink
      href="/founder/autopilot/control"
      className={`flex items-center gap-2 rounded-lg border p-3 text-sm hover-elevate ${
        ready ? "border-acr-pos/30 bg-acr-pos/5" : "border-acr-warn/30 bg-acr-warn/5"
      }`}
      data-testid="letter-step-away-line"
    >
      {ready ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--acr-pos))]" aria-hidden="true" />
      ) : (
        <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--acr-warn))]" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{data.headline}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </PrefetchLink>
  );
}

function VitalStat({ label, value, tone, sub, subTone }: { label: string; value: string; tone?: "amber" | "red"; sub?: string; subTone?: "amber" }) {
  const toneClass = tone === "red" ? "text-destructive" : tone === "amber" ? "text-[hsl(var(--acr-warn))]" : "";
  const subClass = subTone === "amber" ? "text-[hsl(var(--acr-warn))]" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub ? <p className={`mt-0.5 text-[11px] tabular-nums ${subClass}`}>{sub}</p> : null}
    </div>
  );
}
