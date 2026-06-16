/**
 * /founder/autopilot — the daily "letter from your company."
 *
 * The North-Star founder surface (founder-autopilot-northstar-2026-06-16.md):
 * not a dashboard, a calm editorial correspondence. Opening it should feel like
 * a beautifully typeset briefing from a brilliant chief of staff — and most
 * days, learning you have nothing to do. The emotional target is calm,
 * confidence, and a little awe.
 *
 * Sections, top to bottom:
 *   1. The Word — Fraunces greeting + the one-paragraph morning narrative, with
 *      the load-bearing needed-line. (the hero — not KPIs)
 *   2. The Decision — only when one exists; the single hero card.
 *   3. The Vital Sign — one calm row of the few real numbers that matter.
 *   4. The Trust Ledger — each domain climbing its autonomy ladder.
 *   5. The Story / Your Voice — quiet links into the timeline + into shaping
 *      the company by talking to Solene.
 *
 * All copy + numbers come from GET /api/founder/solene/brief (the Narration
 * Engine), which composes ONLY real state — it never claims work that didn't
 * happen. Honesty is upstream; this surface just renders it beautifully.
 *
 * Krieger-bar discipline: design tokens only (light/dark), Fraunces display +
 * Inter body, staggerContainer/staggerItem motion, ≥44px touch targets,
 * aria-live on the async letter, full mobile + desktop parity.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  ShieldCheck,
  ScrollText,
  MessageSquareQuote,
  CheckCircle2,
  PauseCircle,
  Loader2,
  TrendingUp,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { staggerContainer, staggerItem } from "@/lib/animations";

// ─── API contract: GET /api/founder/solene/brief ─────────────────────────────
// Mirror of FounderBrief in server/services/autopilot/narrate.ts.

interface FounderDecisionCard {
  askId: number;
  summary: string;
  urgency: "urgent" | "normal" | "low";
  answerFormat: string;
}

interface TrustLedgerEntry {
  domain: string;
  level: string;
  cleanCycleCount: number;
  threshold: number;
}

interface FounderBrief {
  greeting: string;
  theWord: string;
  neededLine: string;
  isFounderNeeded: boolean;
  decision: FounderDecisionCard | null;
  vitalSign: {
    mrr: number;
    trials: number;
    weeklySpendUsd: number;
    envelopeStatus: "green" | "amber" | "red";
    uptimePct: number;
  };
  focusLine: string | null;
  trustLedger: TrustLedgerEntry[];
  learning?: Array<{ playId: string; rate: number; n: number }>;
}

// ─── Trust-ledger presentation ───────────────────────────────────────────────

const LEVEL_LABEL: Record<string, string> = {
  observe: "Observing",
  draft: "Drafting — you approve",
  execute_gated: "Acting — gated",
  autonomous_gated: "Trusted to act",
};

const LEVEL_RANK: Record<string, number> = {
  observe: 0,
  draft: 1,
  execute_gated: 2,
  autonomous_gated: 3,
};

function levelTone(level: string): string {
  switch (level) {
    case "autonomous_gated":
      return "text-acr-success";
    case "execute_gated":
      return "text-primary";
    case "draft":
      return "text-acr-warn";
    default:
      return "text-muted-foreground";
  }
}

function prettyDomain(domain: string): string {
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

const envelopeTone: Record<FounderBrief["vitalSign"]["envelopeStatus"], string> = {
  green: "text-acr-success",
  amber: "text-acr-warn",
  red: "text-destructive",
};

// ─── Section: The Word (the hero) ────────────────────────────────────────────

function TheWord({ brief }: { brief: FounderBrief }) {
  return (
    <motion.section variants={staggerItem}>
      <h1 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight text-foreground">
        {brief.greeting}
      </h1>
      <p
        className="mt-5 md:mt-6 text-lg md:text-xl leading-relaxed text-foreground/90 max-w-2xl"
        data-testid="the-word"
      >
        {brief.theWord}
      </p>
      <p
        className={`mt-4 text-base font-medium ${
          brief.isFounderNeeded ? "text-acr-warn" : "text-acr-success"
        }`}
        data-testid="needed-line"
      >
        {brief.neededLine}
      </p>
    </motion.section>
  );
}

// ─── Section: The Decision (only when one exists) ────────────────────────────

function TheDecision({ decision }: { decision: FounderDecisionCard }) {
  return (
    <motion.section variants={staggerItem}>
      <Card
        className="border-acr-warn/40 bg-acr-warn/5 overflow-hidden"
        data-testid="the-decision"
      >
        <CardContent className="p-5 md:p-7">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-acr-warn" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide text-acr-warn">
              Needs your call
            </span>
            {decision.urgency === "urgent" && (
              <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">
                Urgent
              </Badge>
            )}
          </div>
          <p className="mt-3 font-serif text-xl md:text-2xl leading-snug text-foreground">
            {decision.summary}
          </p>
          <div className="mt-5">
            <Button asChild size="lg" className="min-h-[44px]">
              <Link
                href={`/founder/asks?id=${decision.askId}`}
                aria-label={`Review and decide: ${decision.summary}`}
                data-testid="link-decide"
              >
                Review &amp; decide
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ─── Section: The Vital Sign ─────────────────────────────────────────────────

function VitalStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-xl md:text-2xl font-semibold tabular-nums ${tone ?? "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function TheVitalSign({ vital, focusLine }: { vital: FounderBrief["vitalSign"]; focusLine: string | null }) {
  return (
    <motion.section variants={staggerItem}>
      <Card data-testid="the-vital-sign">
        <CardContent className="p-5 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <VitalStat label="MRR" value={vital.mrr > 0 ? `$${vital.mrr.toLocaleString()}` : "—"} />
            <VitalStat label="Trials" value={String(vital.trials)} />
            <VitalStat label="7-day spend" value={`$${vital.weeklySpendUsd.toFixed(2)}`} />
            <VitalStat
              label="Runway"
              value={vital.envelopeStatus}
              tone={`capitalize ${envelopeTone[vital.envelopeStatus]}`}
            />
            <VitalStat label="Uptime" value={`${vital.uptimePct.toFixed(1)}%`} />
          </div>
          {focusLine && (
            <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground" data-testid="focus-line">
              {focusLine}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ─── Section: What's working (the learning reflection) ───────────────────────

function prettyPlay(playId: string): string {
  return playId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function WhatsWorking({ learning }: { learning: NonNullable<FounderBrief["learning"]> }) {
  if (!learning || learning.length === 0) return null;
  return (
    <motion.section variants={staggerItem}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">What's working</h2>
        <span className="text-xs text-muted-foreground">— learned from real outcomes</span>
      </div>
      <Card data-testid="whats-working">
        <CardContent className="p-2 sm:p-3">
          <ul className="divide-y divide-border/60">
            {learning.map((l) => (
              <li key={l.playId} className="flex items-center justify-between gap-3 px-2 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{prettyPlay(l.playId)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {Math.round(l.rate * 100)}% good · {l.n} tried
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ─── Section: The Trust Ledger ───────────────────────────────────────────────

function TheTrustLedger({ ledger }: { ledger: TrustLedgerEntry[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const setLevel = useMutation({
    mutationFn: async (vars: { domain: string; level: string; reason: string }) => {
      const res = await fetch(`/api/founder/autopilot/domains/${vars.domain}/level`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: vars.level, reason: vars.reason }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["/api/founder/solene/brief"] });
      toast({ title: `${prettyDomain(vars.domain)} paused`, description: "It's back to observing — it won't act until you trust it again." });
    },
    onError: (err) => {
      toast({ title: "Couldn't update", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  if (ledger.length === 0) return null;
  const sorted = [...ledger].sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0));
  const pendingDomain = setLevel.isPending ? setLevel.variables?.domain : null;
  return (
    <motion.section variants={staggerItem}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Trust ledger</h2>
        <span className="text-xs text-muted-foreground">— what each part of the company has earned</span>
      </div>
      <Card data-testid="the-trust-ledger">
        <CardContent className="p-2 sm:p-3">
          <ul className="divide-y divide-border/60">
            {sorted.map((d) => {
              const atTop = d.level === "autonomous_gated";
              const atObserve = d.level === "observe";
              const pct = atTop ? 100 : Math.min(100, Math.round((d.cleanCycleCount / Math.max(1, d.threshold)) * 100));
              return (
                <li key={d.domain} className="flex items-center gap-4 px-2 py-3">
                  <span className="w-20 shrink-0 text-sm font-medium text-foreground">{prettyDomain(d.domain)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-xs font-medium ${levelTone(d.level)}`}>
                        {LEVEL_LABEL[d.level] ?? d.level}
                      </span>
                      {!atTop && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {d.cleanCycleCount}/{d.threshold} clean
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${atTop ? "bg-acr-success" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${prettyDomain(d.domain)} autonomy progress`}
                      />
                    </div>
                  </div>
                  {/* Reversibility: pause any domain back to observing. Hidden
                      when already observing (nothing to pause). */}
                  {!atObserve && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 min-h-[44px] text-muted-foreground hover:text-foreground"
                      disabled={setLevel.isPending}
                      onClick={() => setLevel.mutate({ domain: d.domain, level: "observe", reason: "paused from the daily letter" })}
                      aria-label={`Pause ${prettyDomain(d.domain)} — return it to observing`}
                      data-testid={`pause-${d.domain}`}
                    >
                      {pendingDomain === d.domain ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <PauseCircle className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span className="ml-1.5 text-xs">Pause</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ─── Section: The Story + Your Voice ─────────────────────────────────────────

function StoryAndVoice() {
  return (
    <motion.section variants={staggerItem} className="grid gap-4 sm:grid-cols-2">
      <Link
        href="/founder/dispatches"
        className="group flex items-center gap-4 rounded-card border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]"
        data-testid="link-the-story"
      >
        <div className="rounded-card bg-primary/10 p-2.5 shrink-0">
          <ScrollText className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">The story</p>
          <p className="text-xs text-muted-foreground">Everything the system did — and why — while you were away.</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      <Link
        href="/founder/autopilot/voice"
        className="group flex items-center gap-4 rounded-card border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]"
        data-testid="link-your-voice"
      >
        <div className="rounded-card bg-primary/10 p-2.5 shrink-0">
          <MessageSquareQuote className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Your voice</p>
          <p className="text-xs text-muted-foreground">Set an intent or a standing order — shape the company by talking to it.</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </motion.section>
  );
}

// ─── The serene "nothing needed" flourish ────────────────────────────────────

function NothingNeededFlourish() {
  return (
    <motion.div
      variants={staggerItem}
      className="flex items-center gap-2 text-sm text-acr-success"
      data-testid="nothing-needed"
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      <span>Everything's handled. Go build your life.</span>
    </motion.div>
  );
}

// ─── Loading skeleton (shapes the content, not a spinner) ─────────────────────

function BriefSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading your brief">
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-6 w-full max-w-2xl" />
        <Skeleton className="h-6 w-full max-w-xl" />
        <Skeleton className="h-5 w-56" />
      </div>
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-40 w-full rounded-card" />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderAutopilotPage() {
  useDocumentTitle("Your company · Founder");

  const { data, isLoading, isError, error, refetch } = useQuery<{ brief: FounderBrief }>({
    queryKey: ["/api/founder/solene/brief"],
    queryFn: async () => {
      const res = await fetch("/api/founder/solene/brief", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load your brief: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const brief = data?.brief ?? null;

  return (
    <PageShell maxWidth="4xl" label="Your company">
      {isLoading ? (
        <BriefSkeleton />
      ) : isError || !brief ? (
        <QueryErrorState
          error={error instanceof Error ? error : new Error("Failed to load brief")}
          title="Your brief isn't available right now"
          description="It refreshes automatically through the day. You can try again."
          onRetry={() => void refetch()}
        />
      ) : (
        <motion.div
          className="space-y-8 md:space-y-10"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          aria-live="polite"
        >
          <TheWord brief={brief} />
          {brief.decision ? (
            <TheDecision decision={brief.decision} />
          ) : (
            <NothingNeededFlourish />
          )}
          <TheVitalSign vital={brief.vitalSign} focusLine={brief.focusLine} />
          <WhatsWorking learning={brief.learning ?? []} />
          <TheTrustLedger ledger={brief.trustLedger} />
          <StoryAndVoice />
        </motion.div>
      )}
    </PageShell>
  );
}
