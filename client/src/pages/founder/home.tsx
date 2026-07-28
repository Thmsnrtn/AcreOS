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
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, CheckCircle2, MessageSquare, ArrowUpRight, ListChecks, BookOpen, Mic, SlidersHorizontal, LayoutGrid, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageShell } from "@/components/page-shell";
import { PrefetchLink } from "@/components/prefetch-link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { FounderPulseStrip } from "@/components/founder/PulseStrip";
import { LetterTrackRecord } from "@/components/founder/LetterTrackRecord";
import { LetterConfession } from "@/components/founder/LetterConfession";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd, formatRelative } from "@/lib/format";

interface FounderBrief {
  greeting: string;
  theWord: string;
  neededLine: string;
  isFounderNeeded: boolean;
  /** Total items awaiting the founder — open asks + queued decisions (the same union the neededLine reads). */
  needsYouCount: number;
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
  /** Per-domain Trust Ledger standing — rendered in the track-record card. */
  trustLedger: Array<{ domain: string; level: string; cleanCycleCount: number; threshold: number }>;
  /** Per-domain recorded outcomes, pre-worded server-side. Empty = nothing recorded yet. */
  trackRecord: Array<{ domain: string; n: number; good: number; bad: number; line: string }>;
  /** Calibration in plain words with the server-side small-n guard applied. null = unreadable → render nothing. */
  calibrationLine: string | null;
  /** "What's been working" sentences from raw counts (small samples say so). */
  learningLines: string[];
  /** The confession — self-reported misses since last week. Empty = the section is silent. */
  misses: Array<{ atIso: string | null; line: string; changed: string | null }>;
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

// The hub is the DOORS — not a resurrection of the retired overview pile.
// The old 9-item grid re-surfaced Command / Bridge / Feed / Steering right on
// the daily home, which is exactly the ~10-overlapping-overviews problem the
// four-door doctrine exists to end. Those instruments stay one tap away via
// "All instruments" (and the sidebar's deep-tools overflow); the daily home
// teaches only the canonical map: read here → act in Decisions → configure in
// Controls → verify in Story.
const HUB = [
  { href: "/founder/decisions", icon: ListChecks, label: "Decisions", desc: "Everything awaiting your tap — approvals, questions, appeals" },
  { href: "/founder/autopilot/control", icon: SlidersHorizontal, label: "Controls", desc: "Switches, trust levels, budgets, emergency stop" },
  { href: "/founder/autopilot/story", icon: BookOpen, label: "Story", desc: "The glass-box audit trail — every action + why" },
  { href: "/founder/autopilot/voice", icon: Mic, label: "Your voice", desc: "Standing orders + objectives the brain steers by" },
  { href: "/founder/all-tools", icon: LayoutGrid, label: "All instruments", desc: "Costs, telemetry, health, feed, steering — every deep panel" },
];

export default function FounderHomePage() {
  useDocumentTitle("Your company · Founder");
  // F3 receipts — which wedge tile's rows are open (null = none).
  const [receiptMetric, setReceiptMetric] = useState<"outreach" | "replies" | "offers" | null>(null);
  const { data, isLoading, error, refetch } = useQuery<{ brief: FounderBrief }>({
    queryKey: ["/api/founder/solene/brief"],
    queryFn: async () => (await apiRequest("GET", "/api/founder/solene/brief")).json(),
    staleTime: 5 * 60 * 1000,
  });

  const brief = data?.brief;

  return (
    <PageShell maxWidth="4xl" label="Your company">
      {/* F1 — ambient liveness on every door (experience-legibility.md) */}
      <div className="mb-4"><FounderPulseStrip /></div>
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

          {/* What needs you — keyed on needsYouCount (the SAME union the
              headline reads: open asks + queued decisions), so this card can
              never say all-clear while the neededLine says work is waiting. */}
          <motion.div variants={staggerItem}>
            {brief.needsYouCount === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4">
                <CheckCircle2 className="h-5 w-5 text-[hsl(var(--acr-pos))]" aria-hidden="true" />
                <p className="text-sm font-medium">Nothing needs you right now — the company is running itself.</p>
              </div>
            ) : brief.decision ? (
              <div className="space-y-2">
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
                      href={`/founder/decisions?id=${brief.decision.askId}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    >
                      Review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </PrefetchLink>
                  </CardContent>
                </Card>
                {brief.needsYouCount > 1 && (
                  <PrefetchLink
                    href="/founder/decisions"
                    className="block px-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
                  >
                    and {brief.needsYouCount - 1} more waiting in Decisions →
                  </PrefetchLink>
                )}
              </div>
            ) : (
              <Card className="border-l-4 border-l-primary">
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="text-sm font-semibold">
                      {brief.needsYouCount === 1
                        ? "A decision is waiting for you"
                        : `${brief.needsYouCount} decisions are waiting for you`}
                    </span>
                  </div>
                  <PrefetchLink
                    href="/founder/decisions"
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    Review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </PrefetchLink>
                </CardContent>
              </Card>
            )}
          </motion.div>

          {/* The Word — the board narrative, now supporting context (not the headline) */}
          <motion.div variants={staggerItem}>
            <p className="text-sm leading-relaxed text-muted-foreground">{brief.theWord}</p>
            {brief.focusLine ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground">{brief.focusLine}</p>
            ) : null}
          </motion.div>

          {/* The confession — "since last week, what went wrong". NEVER hidden
              when non-empty; silent (no padding) when empty. */}
          {(brief.misses?.length ?? 0) > 0 && (
            <motion.div variants={staggerItem}>
              <LetterConfession misses={brief.misses} />
            </motion.div>
          )}

          {/* Armed intent — what runs next, with a one-tap hold on any item */}
          <motion.div variants={staggerItem}>
            <UpNextSection />
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
            <VitalStat label="AI + data spend (7d)" value={usd(brief.vitalSign.weeklySpendUsd, { noCents: true })} />
            <VitalStat
              label="Budget"
              value={BUDGET_STATUS[brief.vitalSign.envelopeStatus].label}
              tone={BUDGET_STATUS[brief.vitalSign.envelopeStatus].tone}
              sub={brief.vitalSign.runwayWeeks != null ? `~${brief.vitalSign.runwayWeeks} wks runway` : undefined}
            />
            <VitalStat
              label="Uptime"
              value={brief.vitalSign.uptimePct != null ? `${brief.vitalSign.uptimePct.toFixed(1)}%` : "—"}
              sub={brief.vitalSign.uptimePct == null ? "no data yet" : "last 7 days"}
            />
          </motion.div>

          {/* The wedge + platform health — the launch-week funnel at a glance.
              The three wedge tiles are receipts (F3): tap a number to open
              the exact rows it counts. */}
          <motion.div variants={staggerItem} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <VitalStat
              label="Outreach (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.outreachSent7d) : "—"}
              sub={brief.vitalSign.wedge ? "tap for the rows" : "no data yet"}
              onClick={brief.vitalSign.wedge ? () => setReceiptMetric((m) => (m === "outreach" ? null : "outreach")) : undefined}
              active={receiptMetric === "outreach"}
              testId="tile-outreach-7d"
            />
            <VitalStat
              label="Replies (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.replies7d) : "—"}
              sub={brief.vitalSign.wedge ? "tap for the rows" : "no data yet"}
              onClick={brief.vitalSign.wedge ? () => setReceiptMetric((m) => (m === "replies" ? null : "replies")) : undefined}
              active={receiptMetric === "replies"}
              testId="tile-replies-7d"
            />
            <VitalStat
              label="Offers (7d)"
              value={brief.vitalSign.wedge ? String(brief.vitalSign.wedge.offers7d) : "—"}
              sub={brief.vitalSign.wedge ? "tap for the rows" : "no data yet"}
              onClick={brief.vitalSign.wedge ? () => setReceiptMetric((m) => (m === "offers" ? null : "offers")) : undefined}
              active={receiptMetric === "offers"}
              testId="tile-offers-7d"
            />
            <VitalStat
              label="Errors (24h)"
              value={brief.vitalSign.errorRatePct != null ? `${brief.vitalSign.errorRatePct.toFixed(1)}%` : "—"}
              tone={brief.vitalSign.errorRatePct != null && brief.vitalSign.errorRatePct >= 1 ? "red" : undefined}
              sub={brief.vitalSign.errorRatePct == null ? "no traffic yet" : "errors visitors hit"}
            />
          </motion.div>

          {/* F3 — the open receipt (rows behind the tapped tile) */}
          {receiptMetric && (
            <motion.div variants={staggerItem}>
              <WedgeReceipts metric={receiptMetric} />
            </motion.div>
          )}

          {/* Track record — the trust evidence, collapsed by default (a
              weekly-cadence read, never a daily indictment). */}
          <motion.div variants={staggerItem}>
            <LetterTrackRecord
              trackRecord={brief.trackRecord ?? []}
              trustLedger={brief.trustLedger ?? []}
              calibrationLine={brief.calibrationLine ?? null}
              learningLines={brief.learningLines ?? []}
            />
          </motion.div>

          {/* Talk to your company */}
          <motion.div variants={staggerItem}>
            <PrefetchLink
              href="/founder/chat"
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
 * readiness endpoint. Renders nothing while LOADING (the Letter never blocks
 * on an auxiliary signal) — but a FAILED check says so in a muted line. A
 * broken check must never be pixel-identical to a calm one.
 */
function StepAwayLine() {
  const { data, isError } = useQuery<{ verdict: "ready" | "not_ready"; headline: string; horizonDays: number }>({
    queryKey: ["/api/founder/autopilot/step-away"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/step-away", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  if (isError) {
    return (
      <p className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted-foreground" data-testid="letter-step-away-error">
        Couldn't run the step-away check just now — that's about this page, not the company.
      </p>
    );
  }
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

/**
 * Up next — armed intent (trust audit, 2026-07-28). One line when queued work
 * exists ("Up next: 3 items queued — tap to see and hold any") opening the
 * plain server-worded list with a one-tap Hold per item. Holding is
 * TIGHTENING, so a single tap is fine; there is deliberately no un-hold here.
 * States: error says so (never silent-broken); empty renders nothing;
 * loading renders nothing (the Letter never blocks on an auxiliary signal).
 */
function UpNextSection() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isError } = useQuery<{ total: number; items: Array<{ id: number; line: string }> }>({
    queryKey: ["/api/founder/autopilot/up-next"],
    queryFn: async () => (await apiRequest("GET", "/api/founder/autopilot/up-next")).json(),
    staleTime: 60 * 1000,
  });
  const hold = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("POST", `/api/founder/autopilot/up-next/${id}/hold`)).json(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/autopilot/up-next"] }),
  });
  if (isError) {
    return (
      <p
        className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted-foreground"
        data-testid="letter-up-next-error"
      >
        Couldn't check what's queued right now — that's about this page, not the queue itself.
      </p>
    );
  }
  if (!data || data.total === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card" data-testid="letter-up-next">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg p-3 text-left text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="letter-up-next-toggle"
      >
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Up next: {data.total === 1 ? "1 item queued" : `${data.total} items queued`} — tap to see and hold any
        </span>
      </button>
      {open && (
        <ul role="list" className="space-y-2 border-t border-border p-3">
          {data.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">{item.line}</span>
              <button
                type="button"
                onClick={() => hold.mutate(item.id)}
                disabled={hold.isPending}
                aria-label={`Hold this queued item: ${item.line}`}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Hold
              </button>
            </li>
          ))}
          {data.total > data.items.length ? (
            <li className="text-xs text-muted-foreground">
              and {data.total - data.items.length} more behind these
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function VitalStat({ label, value, tone, sub, subTone, onClick, active, testId }: { label: string; value: string; tone?: "amber" | "red"; sub?: string; subTone?: "amber"; onClick?: () => void; active?: boolean; testId?: string }) {
  const toneClass = tone === "red" ? "text-destructive" : tone === "amber" ? "text-[hsl(var(--acr-warn))]" : "";
  const subClass = subTone === "amber" ? "text-[hsl(var(--acr-warn))]" : "text-muted-foreground";
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub ? <p className={`mt-0.5 text-[11px] tabular-nums ${subClass}`}>{sub}</p> : null}
    </>
  );
  // Tappable variant — F3 receipts: the tile IS the claim; tapping opens
  // the rows the number is made of.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={active}
        data-testid={testId}
        className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "border-border bg-card"}`}
      >
        {body}
      </button>
    );
  }
  return <div className="rounded-lg border border-border bg-card p-3">{body}</div>;
}

// ── F3 receipts — the rows behind a wedge tile's number ─────────────────────
const RECEIPT_TITLE: Record<string, string> = {
  outreach: "Every send in the last 7 days",
  replies: "Every reply in the last 7 days",
  offers: "Every offer in the last 7 days",
};

function WedgeReceipts({ metric }: { metric: "outreach" | "replies" | "offers" }) {
  const { data, isLoading, isError } = useQuery<{ rows: Array<{ at: string | null; line: string }> }>({
    queryKey: ["/api/founder/autopilot/receipts/wedge", metric],
    queryFn: async () => {
      const res = await fetch(`/api/founder/autopilot/receipts/wedge?metric=${metric}`, { credentials: "include" });
      if (!res.ok) throw new Error(`receipts ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid={`wedge-receipts-${metric}`}>
      <p className="text-xs font-medium text-foreground mb-2">{RECEIPT_TITLE[metric]}</p>
      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Couldn't load the rows right now — the count above still comes from the same table.</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing in the last 7 days — that number is a true zero.</p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {data.rows.map((r, i) => (
            <li key={i} className="flex items-baseline gap-2 text-xs">
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.at ? formatRelative(r.at) : "—"}</span>
              <span className="min-w-0 text-foreground">{r.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
