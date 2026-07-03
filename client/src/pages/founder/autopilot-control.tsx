/**
 * /founder/autopilot/control — the Autopilot Control Center.
 *
 * One calm surface to run the whole autopilot: the master switches (hands +
 * auto-publish), per-domain trust (pause / grant), pending decisions, the
 * system's calibration, and quick ways into Your Voice / The Story / the daily
 * letter. Flipping the autopilot on is a tap here, not a Fly secret — and it's
 * safe by construction (every domain starts at OBSERVE).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Power, Send, ShieldCheck, PauseCircle, ChevronUp, Loader2, AlertCircle,
  ScrollText, MessageSquareQuote, Sparkles, ArrowRight, TrendingUp, OctagonX,
  KeyRound,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatRelative } from "@/lib/format";
import { Verbs } from "@/lib/labels";

interface LedgerEntry { domain: string; level: string; cleanCycleCount: number; threshold: number; qualityLine?: string | null }
interface ControlData {
  settings: { dispatchEnabled: boolean; publishEnabled: boolean; growthBudgetOverrideUsd: number | null; source: { dispatch: "db" | "env"; publish: "db" | "env" } };
  ledger: LedgerEntry[];
  openAsks: number;
  calibration: { grade: string; n: number } | null;
  conversions?: { totalSignups: number; byPlay: Array<{ playId: string; signups: number }> };
  budget?: { baseCapUsd: number; overrideUsd: number | null; effectiveCapUsd: number; ceilingUsd: number } | null;
}

interface LiveData {
  lastTickAt: string | null;
  oneLine: string | null;
  envelopeStatus: string | null;
  decisionsWaitingCount: number;
  dispatchesCompletedLast24h: number;
  dispatchesFlaggedLast24h: number;
  supportThresholdLine: string | null;
  supportThresholdPct: number | null;
  pendingCount: number;
}

const CONTROL_KEY = ["/api/founder/autopilot/control"];
// CEO-plain trust labels. "gated" is engineer-speak for "still passes every
// safety check" — say that in words instead. Each level reads as a sentence the
// founder can act on without a glossary.
const LEVEL_LABEL: Record<string, string> = {
  observe: "Watching only", draft: "Drafts — you approve", execute_gated: "Acts — safety-checked", autonomous_gated: "Independent — safety-checked",
};
const LEVEL_RANK: Record<string, number> = { observe: 0, draft: 1, execute_gated: 2, autonomous_gated: 3 };
// Plain-language budget status — never render the raw "amber"/"red" token at a CEO.
const BUDGET_WORD: Record<string, string> = { green: "on track", amber: "getting tight", red: "needs attention" };
function levelTone(l: string) {
  return l === "autonomous_gated" ? "text-acr-success" : l === "execute_gated" ? "text-primary" : l === "draft" ? "text-acr-warn" : "text-muted-foreground";
}
function prettyDomain(d: string) { return d.charAt(0).toUpperCase() + d.slice(1); }

export default function FounderAutopilotControlPage() {
  useDocumentTitle("Control Center · Founder");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [panicConfirming, setPanicConfirming] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<ControlData>({
    queryKey: CONTROL_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/control", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load control center (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  // Live heartbeat — the last tick + the effective support cut + pending count,
  // so the just-wired autonomous behavior is watchable (auto-refreshes).
  const live = useQuery<LiveData>({
    queryKey: ["/api/founder/autopilot/live"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/live", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load live state (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const setSetting = useMutation({
    mutationFn: async (vars: { key: "dispatchEnabled" | "publishEnabled"; value: boolean }) => {
      const res = await fetch("/api/founder/autopilot/settings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error(`Couldn't update (${res.status})`);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: CONTROL_KEY });
      toast({ title: vars.value ? "Switched on" : "Switched off", description: vars.key === "dispatchEnabled" ? "The autopilot hands." : "Auto-publish." });
    },
    onError: (err) => toast({ title: "Couldn't update", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const resetBudget = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/autopilot/budget/reset", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(`Couldn't reset (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONTROL_KEY });
      toast({ title: "Budget reset", description: "Growth cap rolled back to the default. The next ramp must be re-earned and approved." });
    },
    onError: (err) => toast({ title: "Couldn't reset", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  // The atomic STOP (T0.3) — one tap halts everything: all switches off + every
  // domain quarantined to "watching only" + a receipt + a page. Reversible by
  // re-enabling afterward. (Confirm-gated so it can't trip by accident.)
  const panicStop = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/autopilot/panic-stop", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "founder STOP from Control Center" }),
      });
      if (!res.ok) throw new Error(`Couldn't stop (${res.status})`);
      return res.json();
    },
    onSuccess: (d: { domainsQuarantined?: string[] }) => {
      void qc.invalidateQueries({ queryKey: CONTROL_KEY });
      void qc.invalidateQueries({ queryKey: ["/api/founder/autopilot/live"] });
      setPanicConfirming(false);
      toast({ title: "Autopilot stopped", description: `Everything is off and ${d.domainsQuarantined?.length ?? "all"} domains are back to watching-only. Re-enable when you're ready.` });
    },
    onError: (err) => toast({ title: "Couldn't stop", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const setLevel = useMutation({
    mutationFn: async (vars: { domain: string; level: string }) => {
      const res = await fetch(`/api/founder/autopilot/domains/${vars.domain}/level`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: vars.level, reason: "set from Control Center" }),
      });
      if (!res.ok) throw new Error(`Couldn't update (${res.status})`);
      return res.json();
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: CONTROL_KEY }); },
    onError: (err) => toast({ title: "Couldn't update", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  return (
    <PageShell maxWidth="4xl" label="Autopilot Control Center">
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Power className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-foreground">Control Center</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Run the whole autopilot from here. Turning it on is safe — every part starts in "observe" and earns the right
            to act; nothing reaches a customer without your tap.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-28 w-full rounded-card" />
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        ) : isError || !data ? (
          <QueryErrorState error={error instanceof Error ? error : new Error("Failed")} title="Control Center unavailable" onRetry={() => void refetch()} />
        ) : (
          <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="visible">
            {/* The "can I leave?" answer — machine-verified, never vibes. */}
            <motion.section variants={staggerItem}>
              <StepAwaySection />
            </motion.section>

            {/* Live heartbeat — what it last did + whether it's healthy. */}
            {live.data && (
              <motion.section variants={staggerItem}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${live.data.lastTickAt ? "bg-acr-success" : "bg-muted-foreground"}`} aria-hidden="true" />
                        <span className="text-sm font-semibold text-foreground">Live</span>
                      </div>
                      <span className="text-xs text-muted-foreground" data-testid="live-last-tick">
                        {live.data.lastTickAt ? `Last tick ${formatRelative(live.data.lastTickAt)}` : "No tick yet"}
                      </span>
                    </div>
                    {live.data.oneLine && (
                      <p className="text-xs text-muted-foreground">{live.data.oneLine}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{live.data.dispatchesCompletedLast24h} actions taken (24h)</span>
                      {live.data.dispatchesFlaggedLast24h > 0 && (
                        <span className="text-acr-warn">{live.data.dispatchesFlaggedLast24h} need review</span>
                      )}
                      <span>{live.data.pendingCount} awaiting your tap</span>
                      {live.data.envelopeStatus && <span>budget: {BUDGET_WORD[live.data.envelopeStatus] ?? live.data.envelopeStatus}</span>}
                    </div>
                    {live.data.supportThresholdLine && (
                      <p className="text-micro text-muted-foreground" data-testid="live-support-threshold">
                        {live.data.supportThresholdLine}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.section>
            )}

            {/* Master switches */}
            <motion.section variants={staggerItem} className="grid gap-4 sm:grid-cols-2">
              <MasterToggle
                icon={Power} title="Autopilot hands" description="Let the brain act on its plan (through every gate). Off = it only thinks + drafts."
                enabled={data.settings.dispatchEnabled} source={data.settings.source.dispatch}
                pending={setSetting.isPending && setSetting.variables?.key === "dispatchEnabled"}
                onToggle={(v) => setSetting.mutate({ key: "dispatchEnabled", value: v })}
              />
              <MasterToggle
                icon={Send} title="Auto-publish" description="Allow publishing grounded land content to public surfaces (still gated + witnessed)."
                enabled={data.settings.publishEnabled} source={data.settings.source.publish}
                pending={setSetting.isPending && setSetting.variables?.key === "publishEnabled"}
                onToggle={(v) => setSetting.mutate({ key: "publishEnabled", value: v })}
              />
            </motion.section>

            {/* The atomic STOP — the most prominent control (T0.3). */}
            <motion.section variants={staggerItem}>
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <OctagonX className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">Emergency stop</p>
                      <p className="text-xs text-muted-foreground">
                        Halt everything at once — all switches off, every part back to watching-only. Reversible: re-enable above when you're ready.
                      </p>
                    </div>
                  </div>
                  {panicConfirming ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm" variant="destructive" className="min-h-[44px]"
                        disabled={panicStop.isPending}
                        onClick={() => panicStop.mutate()}
                        data-testid="panic-stop-confirm"
                      >
                        {panicStop.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Yes, stop everything"}
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setPanicConfirming(false)} disabled={panicStop.isPending}>{Verbs.CANCEL}</Button>
                    </div>
                  ) : (
                    <Button
                      size="sm" variant="outline"
                      className="min-h-[44px] shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setPanicConfirming(true)}
                      data-testid="panic-stop"
                    >
                      Stop everything
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.section>

            {/* Pending decisions + calibration */}
            <motion.section variants={staggerItem} className="grid gap-4 sm:grid-cols-2">
              <Link href="/founder/decisions" className="group flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-muted/50 min-h-[44px]" data-testid="control-pending">
                <AlertCircle className={`h-5 w-5 shrink-0 ${data.openAsks > 0 ? "text-acr-warn" : "text-muted-foreground"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{data.openAsks > 0 ? `${data.openAsks} waiting on you` : "Nothing waiting"}</p>
                  <p className="text-xs text-muted-foreground">Open decisions — review in Decisions.</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
              </Link>
              <div className="flex items-center gap-3 rounded-card border border-border bg-card p-4">
                <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground capitalize">{data.calibration && data.calibration.n > 0 ? data.calibration.grade.replace(/-/g, " ") : "Calibration: learning"}</p>
                  <p className="text-xs text-muted-foreground">{data.calibration && data.calibration.n > 0 ? `${data.calibration.n} predictions checked` : "No predictions checked yet"}</p>
                </div>
              </div>
            </motion.section>

            {/* Real outcomes — attributed signups from published content */}
            <motion.section variants={staggerItem}>
              <div className="flex items-center gap-3 rounded-card border border-border bg-card p-4" data-testid="control-conversions">
                <TrendingUp className={`h-5 w-5 shrink-0 ${(data.conversions?.totalSignups ?? 0) > 0 ? "text-acr-success" : "text-muted-foreground"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {(data.conversions?.totalSignups ?? 0) > 0 ? `${data.conversions!.totalSignups} signup${data.conversions!.totalSignups === 1 ? "" : "s"} from published content` : "No attributed signups yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(data.conversions?.byPlay?.length ?? 0) > 0
                      ? data.conversions!.byPlay.slice(0, 3).map((p) => `${prettyDomain(p.playId.replace(/[-_]/g, " "))}: ${p.signups}`).join(" · ")
                      : "Real signups attributed to what the autopilot publishes will show here (a lower bound)."}
                  </p>
                </div>
              </div>
            </motion.section>

            {/* Growth budget — the cap the company earns its way up */}
            {data.budget && (
              <motion.section variants={staggerItem}>
                <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="control-budget">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      ${Math.round(data.budget.effectiveCapUsd)}/mo growth budget
                      {data.budget.effectiveCapUsd > data.budget.baseCapUsd && (
                        <span className="ml-2 text-xs font-normal text-acr-success">ramped from ${Math.round(data.budget.baseCapUsd)}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {data.budget.effectiveCapUsd > data.budget.baseCapUsd
                        ? `You approved lifting the cap as acquisition proved out. Hard ceiling $${Math.round(data.budget.ceilingUsd)}/mo — it can never exceed this.`
                        : `The lean starting cap. When owned-channel acquisition proves healthy, I'll ask once to raise it — never on my own.`}
                    </p>
                  </div>
                  {data.budget.effectiveCapUsd > data.budget.baseCapUsd && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => resetBudget.mutate()}
                      disabled={resetBudget.isPending}
                    >
                      {resetBudget.isPending ? "Resetting…" : "Reset to default"}
                    </Button>
                  )}
                </div>
              </motion.section>
            )}

            {/* Per-domain trust */}
            <motion.section variants={staggerItem}>
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">Trust</h2>
                <span className="text-xs text-muted-foreground">— pause or grant each part of the company</span>
              </div>
              <Card>
                <CardContent className="p-2 sm:p-3">
                  <ul className="divide-y divide-border/60">
                    {[...data.ledger].sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0)).map((d) => {
                      const busy = setLevel.isPending && setLevel.variables?.domain === d.domain;
                      const next = d.level === "observe" ? "draft" : d.level === "draft" ? "execute_gated" : d.level === "execute_gated" ? "autonomous_gated" : null;
                      return (
                        <li key={d.domain} className="flex flex-col gap-1 px-2 py-3">
                          <div className="flex items-center gap-3">
                            <span className="w-20 shrink-0 text-sm font-medium text-foreground">{prettyDomain(d.domain)}</span>
                            <span className={`flex-1 text-xs font-medium ${levelTone(d.level)}`}>{LEVEL_LABEL[d.level] ?? d.level}</span>
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                            ) : (
                              <div className="flex shrink-0 items-center gap-1">
                                {next && (
                                  <Button variant="ghost" size="sm" className="min-h-[40px] text-muted-foreground hover:text-primary" onClick={() => setLevel.mutate({ domain: d.domain, level: next })} aria-label={`Grant ${prettyDomain(d.domain)} more autonomy`} data-testid={`grant-${d.domain}`}>
                                    <ChevronUp className="h-4 w-4" aria-hidden="true" /><span className="ml-1 text-xs">Grant</span>
                                  </Button>
                                )}
                                {d.level !== "observe" && (
                                  <Button variant="ghost" size="sm" className="min-h-[40px] text-muted-foreground hover:text-foreground" onClick={() => setLevel.mutate({ domain: d.domain, level: "observe" })} aria-label={`Pause ${prettyDomain(d.domain)}`} data-testid={`pause-${d.domain}`}>
                                    <PauseCircle className="h-4 w-4" aria-hidden="true" /><span className="ml-1 text-xs">Pause</span>
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Decision quality — the real basis on which autonomy is earned/held. */}
                          {d.qualityLine && (
                            <p className="pl-20 text-micro text-muted-foreground">{d.qualityLine}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </motion.section>

            {/* Delegation — bounded, expiring, revocable witness grants */}
            <motion.section variants={staggerItem}>
              <WitnessGrantsSection />
            </motion.section>

            {/* Quick links */}
            <motion.section variants={staggerItem} className="grid gap-3 sm:grid-cols-3">
              <ControlLink href="/founder/autopilot" icon={Sparkles} title="The daily letter" />
              <ControlLink href="/founder/autopilot/voice" icon={MessageSquareQuote} title="Your Voice" />
              <ControlLink href="/founder/autopilot/story" icon={ScrollText} title="The Story" />
            </motion.section>
          </motion.div>
        )}
      </div>
    </PageShell>
  );
}

function MasterToggle({ icon: Icon, title, description, enabled, source, pending, onToggle }: {
  icon: typeof Power; title: string; description: string; enabled: boolean; source: "db" | "env"; pending: boolean; onToggle: (v: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className={enabled ? "border-acr-success/40 bg-acr-success/5" : ""}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`rounded-card p-2 shrink-0 ${enabled ? "bg-acr-success/10" : "bg-muted"}`}>
            <Icon className={`h-5 w-5 ${enabled ? "text-acr-success" : "text-muted-foreground"}`} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <Badge variant="outline" className={`text-xs ${enabled ? "border-acr-success/40 text-acr-success" : "text-muted-foreground"}`}>{enabled ? "On" : "Off"}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {confirming && !enabled ? (
          <div className="flex items-center gap-2">
            <Button size="sm" className="min-h-[44px]" disabled={pending} onClick={() => { onToggle(true); setConfirming(false); }} data-testid={`confirm-on-${title}`}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Yes, turn on"}
            </Button>
            <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setConfirming(false)}>{Verbs.CANCEL}</Button>
          </div>
        ) : (
          <Button
            size="sm" variant={enabled ? "outline" : "default"} className="min-h-[44px] w-full"
            disabled={pending}
            onClick={() => (enabled ? onToggle(false) : setConfirming(true))}
            data-testid={`toggle-${title}`}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : enabled ? "Turn off" : "Turn on"}
          </Button>
        )}
        {source === "env" && <p className="text-[11px] text-muted-foreground">Currently following the server default. Flipping it here takes over.</p>}
      </CardContent>
    </Card>
  );
}

// ── Step-Away Readiness — the "can I leave?" card ───────────────────────────
// Every line is read from the same switches/gates/ledgers the runtime obeys.
// Critical items gate the verdict; the rest are "worth doing". A check the
// server can't verify shows as attention, never green.

interface ReadinessCheck {
  key: string;
  title: string;
  status: "ready" | "action_needed" | "attention";
  detail: string;
  fix?: string;
  href?: string;
  critical: boolean;
}

interface StepAwayData {
  verdict: "ready" | "not_ready";
  headline: string;
  horizonDays: number;
  readyCount: number;
  totalCount: number;
  checks: ReadinessCheck[];
}

const STEP_AWAY_KEY = ["/api/founder/autopilot/step-away"];

function readinessTone(status: ReadinessCheck["status"]) {
  return status === "ready" ? "text-acr-success" : status === "attention" ? "text-acr-neg" : "text-acr-warn";
}

function StepAwaySection() {
  const [open, setOpen] = useState(false);
  const readiness = useQuery<StepAwayData>({
    queryKey: STEP_AWAY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/step-away", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load readiness (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (readiness.isLoading) return <Skeleton className="h-24 w-full rounded-card" />;
  if (readiness.isError || !readiness.data) {
    return (
      <QueryErrorState
        error={readiness.error instanceof Error ? readiness.error : new Error("Failed")}
        title="Readiness unavailable"
        onRetry={() => void readiness.refetch()}
      />
    );
  }

  const d = readiness.data;
  const ready = d.verdict === "ready";

  return (
    <Card className={ready ? "border-acr-success/40 bg-acr-success/5" : "border-acr-warn/40 bg-acr-warn/5"}>
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left min-h-[44px]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="step-away-toggle"
        >
          <div className={`rounded-card p-2 shrink-0 ${ready ? "bg-acr-success/10" : "bg-acr-warn/10"}`}>
            {ready ? (
              <ShieldCheck className="h-5 w-5 text-acr-success" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-5 w-5 text-acr-warn" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {ready ? "Ready for you to step away" : "Not ready yet"}
              </p>
              <Badge variant="outline" className="text-micro">
                {d.readyCount}/{d.totalCount} armed
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{d.headline}</p>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground mt-1" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground mt-1" aria-hidden="true" />
          )}
        </button>

        {open && (
          <ul className="divide-y divide-border/60">
            {d.checks.map((c) => (
              <li key={c.key} className="py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${c.status === "ready" ? "bg-acr-success" : c.status === "attention" ? "bg-acr-neg" : "bg-acr-warn"}`} aria-hidden="true" />
                  <span className="text-sm text-foreground">{c.title}</span>
                  {c.critical && c.status !== "ready" && (
                    <Badge variant="destructive" className="text-micro">blocks step-away</Badge>
                  )}
                  <span className={`ml-auto text-micro ${readinessTone(c.status)}`}>
                    {c.status === "ready" ? "Ready" : c.status === "attention" ? "Attention" : "Worth doing"}
                  </span>
                </div>
                <p className="pl-3.5 text-xs text-muted-foreground">{c.detail}</p>
                {c.fix && (
                  <p className="pl-3.5 text-xs text-foreground/80">
                    → {c.fix}
                    {c.href && (
                      <Link href={c.href} className="ml-1 text-primary underline-offset-2 hover:underline">
                        Open
                      </Link>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Delegation — WitnessGrants (step-away gap #5) ───────────────────────────
// Every outward action still freezes for a tap; a grant lets the machine tap
// FOR the founder inside explicit bounds. Money + broadcasts stay founder-only
// unless a grant explicitly opts in. Revocation is instant.

interface GrantRow {
  id: number;
  grantorId: string;
  granteeId: string;
  domains: string[];
  maxCostUsd: string;
  maxActions: number;
  usedCount: number;
  expiresAt: string;
  denyMoney: boolean;
  denyBroadcast: boolean;
  revoked: boolean;
  issuedAt: string;
  note: string | null;
}

const GRANTS_KEY = ["/api/founder/autopilot/witness-grants"];
const GRANT_DOMAINS = ["growth", "support", "deploy", "ops", "finance"] as const;

function WitnessGrantsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [domains, setDomains] = useState<string[]>(["support"]);
  const [maxCostUsd, setMaxCostUsd] = useState("5");
  const [maxActions, setMaxActions] = useState("20");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [allowMoney, setAllowMoney] = useState(false);
  const [allowBroadcast, setAllowBroadcast] = useState(false);

  const grants = useQuery<{ grants: GrantRow[] }>({
    queryKey: GRANTS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/witness-grants", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load grants (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const issue = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/autopilot/witness-grants", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          granteeId: "solene",
          domains,
          maxCostUsd: Number(maxCostUsd),
          maxActions: Number(maxActions),
          expiresInDays: Number(expiresInDays),
          allowMoney,
          allowBroadcast,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Couldn't issue (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GRANTS_KEY });
      setFormOpen(false);
      toast({ title: "Delegation issued", description: "The autopilot may now tap covered actions itself. Revoke any time." });
    },
    onError: (err) => toast({ title: "Couldn't issue", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/founder/autopilot/witness-grants/${id}/revoke`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "revoked from Control Center" }),
      });
      if (!res.ok) throw new Error(`Couldn't revoke (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GRANTS_KEY });
      toast({ title: "Delegation revoked", description: "That grant is dead — those actions wait for your tap again." });
    },
    onError: (err) => toast({ title: "Couldn't revoke", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const rows = grants.data?.grants ?? [];
  const live = rows.filter((g) => !g.revoked && new Date(g.expiresAt).getTime() > Date.now() && g.usedCount < g.maxActions);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Delegation</h2>
        <span className="text-xs text-muted-foreground">— let the autopilot tap for you, inside bounds you set</span>
      </div>
      <Card>
        <CardContent className="p-4 space-y-4">
          {grants.isLoading ? (
            <Skeleton className="h-16 w-full rounded-card" />
          ) : grants.isError ? (
            <QueryErrorState error={grants.error instanceof Error ? grants.error : new Error("Failed")} title="Delegations unavailable" onRetry={() => void grants.refetch()} />
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No delegations. Every outward action waits for your tap — that's the default, and it never changes unless
                  you issue a grant here. A grant is bounded (domains, per-action cost, total actions, expiry) and revocable instantly.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {rows.slice(0, 8).map((g) => {
                    const dead = g.revoked || new Date(g.expiresAt).getTime() <= Date.now() || g.usedCount >= g.maxActions;
                    return (
                      <li key={g.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            {g.domains.map(prettyDomain).join(" · ")} — up to ${Number(g.maxCostUsd).toFixed(0)}/action
                            <span className="text-muted-foreground"> · {g.usedCount}/{g.maxActions} used</span>
                          </p>
                          <p className="text-micro text-muted-foreground">
                            {g.revoked ? "Revoked" : `Expires ${formatRelative(g.expiresAt)}`}
                            {!g.denyMoney && <span className="text-acr-warn"> · may move money</span>}
                            {!g.denyBroadcast && <span className="text-acr-warn"> · may broadcast</span>}
                          </p>
                        </div>
                        {!dead && (
                          <Button
                            size="sm" variant="outline" className="shrink-0 min-h-[40px]"
                            onClick={() => revoke.mutate(g.id)} disabled={revoke.isPending}
                            data-testid={`revoke-grant-${g.id}`}
                          >
                            Revoke
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {formOpen ? (
                <div className="space-y-3 rounded-card border border-border/60 bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-2">
                    {GRANT_DOMAINS.map((d) => {
                      const on = domains.includes(d);
                      return (
                        <Button
                          key={d} type="button" size="sm" variant={on ? "default" : "outline"} className="min-h-[36px]"
                          onClick={() => setDomains((cur) => (on ? cur.filter((x) => x !== d) : [...cur, d]))}
                          aria-pressed={on}
                          data-testid={`grant-domain-${d}`}
                        >
                          {prettyDomain(d)}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="grant-cost" className="text-xs">Per-action ceiling ($)</Label>
                      <Input id="grant-cost" type="number" min="0.01" step="1" value={maxCostUsd} onChange={(e) => setMaxCostUsd(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="grant-actions" className="text-xs">Total actions</Label>
                      <Input id="grant-actions" type="number" min="1" step="1" value={maxActions} onChange={(e) => setMaxActions(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="grant-days" className="text-xs">Expires in (days)</Label>
                      <Input id="grant-days" type="number" min="1" max="30" step="1" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-foreground">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowMoney} onChange={(e) => setAllowMoney(e.target.checked)} className="h-4 w-4" />
                      Allow money-moving actions (refunds, retries)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowBroadcast} onChange={(e) => setAllowBroadcast(e.target.checked)} className="h-4 w-4" />
                      Allow public broadcasts
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="min-h-[44px]" onClick={() => issue.mutate()} disabled={issue.isPending || domains.length === 0}>
                      {issue.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Issue delegation"}
                    </Button>
                    <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setFormOpen(false)} disabled={issue.isPending}>{Verbs.CANCEL}</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setFormOpen(true)} data-testid="new-grant">
                  {live.length > 0 ? "Issue another delegation" : "Issue a delegation"}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ControlLink({ href, icon: Icon, title }: { href: string; icon: typeof Power; title: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-muted/50 min-h-[44px]" data-testid={`control-link-${title}`}>
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-foreground">{title}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
    </Link>
  );
}
