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
  KeyRound, Plug, Sunrise,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { FounderAuthError } from "@/components/founder/FounderAuthError";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { FounderPulseStrip } from "@/components/founder/PulseStrip";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatRelative } from "@/lib/format";
import { Verbs } from "@/lib/labels";

interface LedgerEntry { domain: string; level: string; cleanCycleCount: number; threshold: number; qualityLine?: string | null; shadowLine?: string | null; lastPromotedAt?: string | null; lastDemotedAt?: string | null; lastDemotionReason?: string | null }
interface ControlData {
  settings: { dispatchEnabled: boolean; publishEnabled: boolean; cognitionEnabled?: boolean; selfPatchEnabled?: boolean; growthBudgetOverrideUsd: number | null; source: { dispatch: "db" | "env"; publish: "db" | "env" } };
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

// ── Postures — F2 of the experience-legibility cluster ─────────────────────
// One tap sets the whole company to a coherent stance instead of asking the
// founder to reason about three switches × N trust dials. Hands-off
// deliberately targets "Acts — safety-checked" (execute_gated), NOT
// independent: full autonomy stays per-domain earned trust the founder
// grants individually, and hard-stops always ask regardless of posture.
interface Posture {
  id: string;
  label: string;
  line: string;
  switches: { dispatchEnabled: boolean; publishEnabled: boolean; selfPatchEnabled: boolean };
  level: string;
}
const POSTURES: Posture[] = [
  {
    id: "cautious", label: "Cautious",
    line: "Everything watches and drafts — nothing acts, nothing publishes.",
    switches: { dispatchEnabled: false, publishEnabled: false, selfPatchEnabled: false },
    level: "observe",
  },
  {
    id: "standard", label: "Standard",
    line: "The brain works inside the company; anything outward drafts and waits for your tap.",
    switches: { dispatchEnabled: true, publishEnabled: false, selfPatchEnabled: false },
    level: "draft",
  },
  {
    id: "handsoff", label: "Hands-off",
    line: "Acts end-to-end through every safety gate, publishes grounded content, patches itself. Hard-stops still always ask you.",
    switches: { dispatchEnabled: true, publishEnabled: true, selfPatchEnabled: true },
    level: "execute_gated",
  },
];

/** Which posture the current switches + trust dials add up to, if any. */
function detectPosture(data: ControlData): string | null {
  for (const p of POSTURES) {
    const s = data.settings;
    const switchesMatch =
      s.dispatchEnabled === p.switches.dispatchEnabled &&
      s.publishEnabled === p.switches.publishEnabled &&
      (s.selfPatchEnabled ?? false) === p.switches.selfPatchEnabled;
    const levelsMatch = data.ledger.every((l) => l.level === p.level);
    if (switchesMatch && levelsMatch) return p.id;
  }
  return null;
}

/** Plain sentences describing exactly what applying `p` would change. */
function postureDiff(data: ControlData, p: Posture): string[] {
  const out: string[] = [];
  const s = data.settings;
  const flag = (label: string, cur: boolean, next: boolean) => {
    if (cur !== next) out.push(`${label}: ${cur ? "on → off" : "off → on"}`);
  };
  flag("Autopilot hands", s.dispatchEnabled, p.switches.dispatchEnabled);
  flag("Auto-publish", s.publishEnabled, p.switches.publishEnabled);
  flag("Self-patching", s.selfPatchEnabled ?? false, p.switches.selfPatchEnabled);
  for (const l of data.ledger) {
    if (l.level !== p.level) {
      out.push(`${prettyDomain(l.domain)}: ${LEVEL_LABEL[l.level] ?? l.level} → ${LEVEL_LABEL[p.level] ?? p.level}`);
    }
  }
  return out;
}

export default function FounderAutopilotControlPage() {
  useDocumentTitle("Control Center · Founder");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [panicConfirming, setPanicConfirming] = useState(false);
  // Guided resume stays visible mid-flow: stage 1 turns cognition on, which
  // would otherwise un-render the card before stages 2–3 (and their
  // narrations) could run.
  const [resumePinned, setResumePinned] = useState(false);

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
    mutationFn: async (vars: { key: "dispatchEnabled" | "publishEnabled" | "selfPatchEnabled"; value: boolean }) => {
      const res = await fetch("/api/founder/autopilot/settings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error(`Couldn't update (${res.status})`);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: CONTROL_KEY });
      void qc.invalidateQueries({ queryKey: STEP_AWAY_KEY });
      toast({
        title: vars.value ? "Switched on" : "Switched off",
        description:
          vars.key === "dispatchEnabled" ? "The autopilot hands." :
          vars.key === "selfPatchEnabled" ? "Self-patching (security fixes become PRs for your review)." :
          "Auto-publish.",
      });
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

  // Posture apply — F2. Sequential on purpose: each step reuses the exact
  // per-control endpoints (same audit trail, same receipts), and a partial
  // failure surfaces honestly instead of pretending the posture landed.
  const [confirmingPosture, setConfirmingPosture] = useState<string | null>(null);
  const [applyingPosture, setApplyingPosture] = useState(false);
  const applyPosture = async (p: Posture) => {
    if (!data) return;
    setApplyingPosture(true);
    const failures: string[] = [];
    const s = data.settings;
    const switchSteps: Array<{ key: "dispatchEnabled" | "publishEnabled" | "selfPatchEnabled"; value: boolean; cur: boolean }> = [
      { key: "dispatchEnabled", value: p.switches.dispatchEnabled, cur: s.dispatchEnabled },
      { key: "publishEnabled", value: p.switches.publishEnabled, cur: s.publishEnabled },
      { key: "selfPatchEnabled", value: p.switches.selfPatchEnabled, cur: s.selfPatchEnabled ?? false },
    ];
    for (const step of switchSteps) {
      if (step.cur === step.value) continue;
      try {
        await setSetting.mutateAsync({ key: step.key, value: step.value });
      } catch {
        failures.push(step.key);
      }
    }
    for (const l of data.ledger) {
      if (l.level === p.level) continue;
      try {
        await setLevel.mutateAsync({ domain: l.domain, level: p.level });
      } catch {
        failures.push(l.domain);
      }
    }
    setApplyingPosture(false);
    setConfirmingPosture(null);
    void qc.invalidateQueries({ queryKey: CONTROL_KEY });
    if (failures.length === 0) {
      toast({ title: `Posture: ${p.label}`, description: p.line });
    } else {
      toast({
        title: `Posture partially applied`,
        description: `Couldn't change: ${failures.join(", ")}. Everything else is set — check the dials below.`,
        variant: "destructive",
      });
    }
  };

  return (
    <PageShell maxWidth="4xl" label="Autopilot Control Center">
      {/* F1 — ambient liveness on every door (experience-legibility.md) */}
      <div className="mb-4"><FounderPulseStrip /></div>
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
          <FounderAuthError error={error instanceof Error ? error : new Error("Failed")} title="Control Center unavailable" onRetry={() => void refetch()} />
        ) : (
          <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="visible">
            {/* The "can I leave?" answer — machine-verified, never vibes. */}
            <motion.section variants={staggerItem}>
              <StepAwaySection />
              {/* Founder-trust audit gap #3 — the pager path is only trustworthy
                  if it's been fired synthetically. */}
              <div className="mt-3">
                <TestPageButton />
              </div>
              {/* Founder decision 2026-07-28 #8 — the safety net that lives
                  OUTSIDE the app, shown with honest armed/dormant states. */}
              <div className="mt-3">
                <ExternalSafetyNetSection />
              </div>
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

            {/* Postures — one tap, one coherent stance (F2). */}
            <motion.section variants={staggerItem}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-foreground">Posture</h2>
                <span className="text-xs text-muted-foreground">— set the whole company's stance in one tap; every dial below follows</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {POSTURES.map((p) => {
                  const active = data ? detectPosture(data) === p.id : false;
                  const diff = data ? postureDiff(data, p) : [];
                  const confirming = confirmingPosture === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-card border p-4 flex flex-col gap-2 ${active ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "border-border bg-card"}`}
                      data-testid={`posture-${p.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{p.label}</p>
                        {active && <Badge variant="secondary" className="text-micro">current</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed flex-1">{p.line}</p>
                      {!active && !confirming && (
                        <Button
                          size="sm" variant="outline" className="w-full"
                          disabled={applyingPosture || !data}
                          onClick={() => setConfirmingPosture(p.id)}
                          data-testid={`posture-${p.id}-set`}
                        >
                          Set posture
                        </Button>
                      )}
                      {confirming && (
                        <div className="space-y-2" data-testid={`posture-${p.id}-confirm`}>
                          <div className="rounded-md bg-muted/50 border border-border px-2.5 py-2">
                            <p className="text-micro font-medium text-foreground mb-1">This will change:</p>
                            <ul className="space-y-0.5">
                              {diff.slice(0, 8).map((d) => (
                                <li key={d} className="text-micro text-muted-foreground">{d}</li>
                              ))}
                              {diff.length > 8 && (
                                <li className="text-micro text-muted-foreground">…and {diff.length - 8} more</li>
                              )}
                            </ul>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1" disabled={applyingPosture} onClick={() => void applyPosture(p)}>
                              {applyingPosture ? "Setting…" : `Confirm ${p.label}`}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={applyingPosture} onClick={() => setConfirmingPosture(null)}>
                              {Verbs.CANCEL}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {data && detectPosture(data) === null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Right now you're on a custom mix — the dials below don't add up to any single posture. That's fine; postures are shortcuts, not rules.
                </p>
              )}
            </motion.section>

            {/* Come back online — the guided, staged resume after a stop.
                Shown whenever all three master switches are off (the state the
                panic stop leaves behind — and the honest simpler condition the
                data supports, since flipping them off by hand lands in the
                same place). Pinned while a resume flow is in progress. */}
            {(resumePinned ||
              (!data.settings.dispatchEnabled && !data.settings.publishEnabled && !(data.settings.cognitionEnabled ?? false))) && (
              <motion.section variants={staggerItem}>
                <GuidedResumeSection onProgress={() => setResumePinned(true)} onDismiss={() => setResumePinned(false)} />
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
              <MasterToggle
                icon={ShieldCheck} title="Self-patching" description="Let the immune system open pull requests for safe (patch-only) security fixes. Never merges — CI and your review always stand."
                enabled={data.settings.selfPatchEnabled ?? false} source="db"
                pending={setSetting.isPending && setSetting.variables?.key === "selfPatchEnabled"}
                onToggle={(v) => setSetting.mutate({ key: "selfPatchEnabled", value: v })}
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
                      {/* Founder-trust audit gap #2 — say honestly what this button
                          does NOT stop. Verified: panic-stop halts the autopilot
                          brain/hands but not the scheduled-job fleet, customer-side
                          Pax, or founder-chat tools. */}
                      <p className="mt-1 text-xs text-muted-foreground">
                        This stops the autopilot's brain and hands. Scheduled billing/mail jobs and the customer-facing assistant have
                        their own switches — this button does not touch them.
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
              {/* The one worst-day number (founder-trust audit gap #1). */}
              <div className="mt-3">
                <WorstDaySection />
              </div>
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
                          {/* Horizon A2 — shadow agreement: how often the calls it would have
                              made matched how rulings actually resolved. Honest by construction:
                              only resolved pairs count; below the minimum it says it's still
                              accumulating. Promotions now arrive as one-tap Decisions cards
                              backed by exactly this evidence; the Grant button above stays the
                              founder's sovereign override (Principle 9). */}
                          {d.shadowLine && (
                            <p className="pl-20 text-micro text-muted-foreground" data-testid={`shadow-line-${d.domain}`}>{d.shadowLine}</p>
                          )}
                          {/* F3b — last-fired line: when this dial last actually moved,
                              and why if it was pulled back. Doubles as liveness proof. */}
                          {(d.lastDemotedAt || d.lastPromotedAt) && (
                            <p className="pl-20 text-micro text-muted-foreground">
                              {d.lastDemotedAt && (!d.lastPromotedAt || new Date(d.lastDemotedAt) > new Date(d.lastPromotedAt))
                                ? `Pulled back ${formatRelative(d.lastDemotedAt)}${d.lastDemotionReason ? ` — ${d.lastDemotionReason}` : ""}`
                                : `Trust granted ${formatRelative(d.lastPromotedAt!)}`}
                            </p>
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

            {/* Connections — connect the accounts the platform runs on, in-app */}
            <motion.section variants={staggerItem}>
              <ConnectionsSection />
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

// ── Come back online — guided resume (founder-trust audit: un-guided resume
// makes the red button psychologically unusable) ────────────────────────────
// The mirror of the panic stop: a plain-words preflight checklist, then three
// stage buttons that unlock strictly in order. Nothing here restores domain
// autonomy levels — post-resume everything stays watching-only and the founder
// re-grants from the trust ledger. Auto-publish is never guessed back on (the
// pre-stop state isn't recorded anywhere), and the server says so.

interface ResumeChecklistItem { label: string; ok: boolean; detail: string }
interface ResumePreflightData { ok: boolean; items: ResumeChecklistItem[] }

const RESUME_PREFLIGHT_KEY = ["/api/founder/autopilot/resume/preflight"];

const RESUME_STAGE_STEPS = [
  { id: "cognition", label: "1. Wake the brain", line: "Thinking, watching and drafting only — its hands stay off, nothing goes out." },
  { id: "observe", label: "2. Confirm watching-only", line: "Verifies every part sits at watching-only (the stop put them there). Changes nothing." },
  { id: "dispatch", label: "3. Hands back on", line: "Actions run through every safety gate again. Auto-publish stays off until you flip it yourself." },
] as const;
type ResumeStageId = (typeof RESUME_STAGE_STEPS)[number]["id"];

function GuidedResumeSection({ onProgress, onDismiss }: { onProgress: () => void; onDismiss: () => void }) {
  const qc = useQueryClient();
  const [doneStages, setDoneStages] = useState<ResumeStageId[]>([]);
  const [narrations, setNarrations] = useState<Partial<Record<ResumeStageId, string>>>({});
  const [stageError, setStageError] = useState<string | null>(null);

  const preflight = useQuery<ResumePreflightData>({
    queryKey: RESUME_PREFLIGHT_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/resume/preflight", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load the resume checklist (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const runStage = useMutation({
    mutationFn: async (stage: ResumeStageId) => {
      const res = await fetch("/api/founder/autopilot/resume/stage", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Couldn't run this step (${res.status})`);
      }
      return res.json() as Promise<{ done: boolean; narration: string }>;
    },
    onSuccess: (r, stage) => {
      setNarrations((n) => ({ ...n, [stage]: r.narration }));
      if (r.done) {
        setStageError(null);
        setDoneStages((s) => (s.includes(stage) ? s : [...s, stage]));
        onProgress();
        void qc.invalidateQueries({ queryKey: CONTROL_KEY });
        void qc.invalidateQueries({ queryKey: STEP_AWAY_KEY });
      } else {
        // The server refused honestly (e.g. the env-level stop is engaged) —
        // its narration is the whole truth; show it where the button lives.
        setStageError(r.narration);
      }
    },
    onError: (err) => setStageError(err instanceof Error ? err.message : String(err)),
  });

  const allDone = doneStages.length === RESUME_STAGE_STEPS.length;

  return (
    <Card className="border-primary/40 bg-primary/5" data-testid="guided-resume">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-card p-2 shrink-0 bg-primary/10">
            <Sunrise className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Come back online</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything is off. Coming back is staged and cautious: everything restarts in watching-only; you re-grant
              autonomy from the trust ledger below when you're ready.
            </p>
          </div>
        </div>

        {/* Preflight — the plain-words checklist before anything turns on. */}
        {preflight.isLoading ? (
          <Skeleton className="h-20 w-full rounded-card" />
        ) : preflight.isError || !preflight.data ? (
          <QueryErrorState
            error={preflight.error instanceof Error ? preflight.error : new Error("Failed")}
            title="Checklist unavailable"
            onRetry={() => void preflight.refetch()}
          />
        ) : (
          <ul className="divide-y divide-border/60 rounded-card border border-border/60 bg-card px-3" data-testid="resume-preflight">
            {preflight.data.items.map((item) => (
              <li key={item.label} className="py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${item.ok ? "bg-acr-success" : "bg-acr-neg"}`} aria-hidden="true" />
                  <span className="text-sm text-foreground">{item.label}</span>
                  <span className={`ml-auto text-micro ${item.ok ? "text-acr-success" : "text-acr-neg"}`}>
                    {item.ok ? "Clear" : "In the way"}
                  </span>
                </div>
                <p className="pl-3.5 text-xs text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        )}

        {/* The three stages — unlock strictly in order. */}
        <ol className="space-y-2">
          {RESUME_STAGE_STEPS.map((step, i) => {
            const done = doneStages.includes(step.id);
            const unlocked = i === 0 || doneStages.includes(RESUME_STAGE_STEPS[i - 1].id);
            const busy = runStage.isPending && runStage.variables === step.id;
            return (
              <li key={step.id} className="rounded-card border border-border/60 bg-card p-3 space-y-1.5" data-testid={`resume-stage-${step.id}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.line}</p>
                  </div>
                  {done ? (
                    <Badge variant="outline" className="shrink-0 border-acr-success/40 text-acr-success text-micro">Done</Badge>
                  ) : (
                    <Button
                      size="sm" variant={unlocked ? "default" : "outline"} className="min-h-[44px] shrink-0"
                      disabled={!unlocked || runStage.isPending}
                      onClick={() => { setStageError(null); runStage.mutate(step.id); }}
                      data-testid={`resume-stage-${step.id}-run`}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : unlocked ? "Run this step" : "Locked"}
                    </Button>
                  )}
                </div>
                {narrations[step.id] && (
                  <p className="text-xs text-foreground/80 rounded-md bg-muted/50 border border-border px-2.5 py-2" data-testid={`resume-narration-${step.id}`}>
                    {narrations[step.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {stageError && (
          <p className="text-xs text-acr-neg" role="alert" data-testid="resume-stage-error">
            {stageError}
          </p>
        )}

        {allDone && (
          <Button size="sm" variant="outline" className="min-h-[44px]" onClick={onDismiss} data-testid="resume-dismiss">
            Done — back online (still watching-only)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Worst-day number (founder-trust audit gap #1) ───────────────────────────
// The single figure a layperson founder can hold: "if everything went
// maximally wrong autonomously in one day, the most it could cost is $X".
// Composed server-side from the REAL enforced caps (worstDay.ts); any
// component the server couldn't read arrives null and we say so — nothing
// here is ever a guess.

interface WorstDayData {
  aiDailyCeilingCents: number | null;
  spendRemainingCents: number | null;
  hardCapCents: number | null;
  boundCents: number | null;
  caveats: string[];
}

function wholeDollars(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function WorstDaySection() {
  const [open, setOpen] = useState(false);
  const q = useQuery<WorstDayData>({
    queryKey: ["/api/founder/intelligence/autopilot/worst-day"],
    queryFn: async () => {
      const res = await fetch("/api/founder/intelligence/autopilot/worst-day", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load worst-day bound (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  if (q.isLoading) return <Skeleton className="h-12 w-full rounded-card" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="worst-day-unavailable">
        Couldn't compute the worst-day spend number right now — showing nothing rather than a guess.
      </p>
    );
  }
  const d = q.data;

  return (
    <div className="rounded-card border border-border bg-card p-4" data-testid="worst-day">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left min-h-[44px]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="worst-day-toggle"
      >
        <p className="min-w-0 flex-1 text-sm text-foreground">
          {d.boundCents !== null ? (
            <>
              If everything went wrong for a whole day, the most the autopilot could spend is about{" "}
              <span className="font-semibold">{wholeDollars(d.boundCents)}</span> — tap for how that's calculated.
            </>
          ) : (
            <>Couldn't compute the worst-day spend number — showing nothing rather than a guess. Tap for what's missing.</>
          )}
        </p>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
        ) : (
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-muted-foreground" data-testid="worst-day-detail">
          <ul className="space-y-1">
            <li>
              AI thinking, per day (platform-wide hard ceiling):{" "}
              {d.aiDailyCeilingCents !== null ? `${wholeDollars(d.aiDailyCeilingCents)}` : "couldn't read — not counted"}
            </li>
            <li>
              Money left in this month's agent budgets:{" "}
              {d.spendRemainingCents !== null ? wholeDollars(d.spendRemainingCents) : "couldn't read — not counted"}
            </li>
            <li>
              Absolute hard cap on any single request:{" "}
              {d.hardCapCents !== null ? wholeDollars(d.hardCapCents) : "couldn't read — not counted"}
            </li>
          </ul>
          {d.boundCents !== null && (
            <p>
              The number is the smaller of the hard cap and the remaining budgets, plus the AI ceiling. Any single
              transaction over $500 always waits for your tap.
            </p>
          )}
          {d.caveats.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-foreground">The honest fine print:</p>
              <ul className="list-disc space-y-1 pl-4">
                {d.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── "Send me a test page" (founder-trust audit gap #3) ──────────────────────
// Fires a clearly-labeled drill through the REAL paging path so the founder
// learns whether pages reach their phone BEFORE a real incident. The toast
// reports the honest outcome — including "not delivered" with the server's
// real reason when the pager topic is unconfigured.

function TestPageButton() {
  const { toast } = useToast();
  // allow-no-invalidation: a test page is a fire-and-forget drill — no cached
  // query reads its result; the toast is the entire outcome surface.
  const testPage = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/intelligence/autopilot/test-page", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(`Couldn't send (${res.status})`);
      return res.json() as Promise<{ sent: boolean; channel: string | null; reason: string | null }>;
    },
    onSuccess: (r) => {
      if (r.sent) {
        toast({
          title: "Test page sent",
          description:
            r.channel === "email"
              ? "The push channel didn't work, so it went to your email instead. If you expected a phone buzz, the push path needs attention."
              : "Sent as a push. If nothing arrived on your phone, the path is broken even though the server thinks it worked — that's exactly what this drill exists to catch.",
        });
      } else {
        toast({
          title: "Test page NOT delivered",
          description: r.reason ?? "No reason recorded.",
          variant: "destructive",
        });
      }
    },
    onError: (err) =>
      toast({ title: "Couldn't send test page", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Does the pager actually reach you?</p>
        <p className="text-xs text-muted-foreground">
          Send yourself a drill through the real paging path. The message says it's a drill; you don't need to do anything.
        </p>
      </div>
      <Button
        size="sm" variant="outline" className="min-h-[44px] shrink-0"
        onClick={() => testPage.mutate()}
        disabled={testPage.isPending}
        data-testid="send-test-page"
      >
        {testPage.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Send me a test page"}
      </Button>
    </div>
  );
}

// ── Safety net outside the app (founder decision 2026-07-28 #8) ─────────────
// Three watchdogs run on GitHub Actions — genuinely outside AcreOS, so they
// still work when the app is dark. HONESTY RULE: this app CANNOT read GitHub
// repo secrets, so nothing here is ever shown as armed ("no green check") —
// each entry says exactly what is knowable from here and how the founder can
// verify or arm it themselves. Arming steps live in the break-glass card
// (docs/runbooks/break-glass-card.md), which must ALSO exist outside the app:
// the email button below sends the founder their own copy to print or file.

interface ExternalWatchdogInfo {
  key: string;
  title: string;
  what: string;
  /** What is honestly knowable from inside the app — never an armed claim. */
  stateLine: string;
  /** The GitHub repo secrets that arm it (exact names). */
  secrets: string[];
  /** Copy-paste arming steps (mirrors the break-glass card). */
  how: string[];
}

const EXTERNAL_WATCHDOGS: ExternalWatchdogInfo[] = [
  {
    key: "daily-pulse",
    title: "Daily pulse",
    what: "Pushes a one-line health text to your phone every morning (~7:07am ET), from GitHub's computers.",
    stateLine:
      "Can't verify from here — the real check is your phone: did this morning's one-liner arrive? No line means it needs NTFY_TOPIC (or GitHub Actions is having trouble).",
    secrets: ["NTFY_TOPIC"],
    how: [
      'Terminal: gh secret set NTFY_TOPIC --body "<your-private-topic>"',
      "Web: github.com/Thmsnrtn/AcreOS → Settings → Secrets and variables → Actions → New repository secret → name it exactly NTFY_TOPIC.",
      "Prove it: Actions tab → Daily Pulse → Run workflow → the line should hit your phone within a minute.",
    ],
  },
  {
    key: "uptime-probe",
    title: "Uptime probe",
    what: "Pings the site from GitHub every ~5 minutes and records real outside-in uptime.",
    stateLine:
      "Can't verify from here — dormant until you set UPTIME_PROBE_URL and UPTIME_PROBE_TOKEN; here's how.",
    secrets: ["UPTIME_PROBE_URL", "UPTIME_PROBE_TOKEN"],
    how: [
      'Terminal: gh secret set UPTIME_PROBE_URL --body "https://acreos.io"',
      'Terminal: gh secret set UPTIME_PROBE_TOKEN --body "<long-random-string>"',
      'Server half: fly secrets set UPTIME_PROBE_TOKEN="<the same string>" — the site refuses the probe without it.',
      "Web: github.com/Thmsnrtn/AcreOS → Settings → Secrets and variables → Actions → New repository secret (exact names above).",
      'Prove it: Actions tab → uptime-probe → Run workflow → the log must say it recorded a sample, not "probe dormant".',
    ],
  },
  {
    key: "release-watchdog",
    title: "Release watchdog",
    what: "Hourly, checks the live site is running the latest code and pages your phone if not.",
    stateLine:
      "Can't verify from here — it can't alert until you set DEPLOY_ALERT_WEBHOOK (its runs deliberately fail red until then); here's how.",
    secrets: ["DEPLOY_ALERT_WEBHOOK"],
    how: [
      'Terminal: gh secret set DEPLOY_ALERT_WEBHOOK --body "https://ntfy.sh/<your-private-topic>"',
      "Web: github.com/Thmsnrtn/AcreOS → Settings → Secrets and variables → Actions → New repository secret → name it exactly DEPLOY_ALERT_WEBHOOK.",
      'Prove it: Actions tab → Release Watchdog → Run workflow → the run should end green with "Alert spine wired".',
    ],
  },
];

function ExternalSafetyNetSection() {
  const { toast } = useToast();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // allow-no-invalidation: emailing the card is fire-and-forget — no cached
  // query reads its result; the honest toast is the entire outcome surface.
  const emailCard = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/intelligence/break-glass/email", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(`Couldn't send (${res.status})`);
      return res.json() as Promise<{ sent: boolean; reason: string | null }>;
    },
    onSuccess: (r) => {
      if (r.sent) {
        toast({
          title: "Break-glass card sent",
          description: "Check your inbox — then print it or file it somewhere you can reach when the app is dark.",
        });
      } else {
        toast({
          title: "Card NOT sent",
          description: r.reason ?? "No reason recorded.",
          variant: "destructive",
        });
      }
    },
    onError: (err) =>
      toast({ title: "Couldn't send the card", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  return (
    <div className="rounded-card border border-border bg-card p-4 space-y-3" data-testid="external-safety-net">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Safety net outside the app</p>
          <p className="text-xs text-muted-foreground">
            Three watchdogs run on GitHub's computers, independent of AcreOS — they keep working when the app is dark.
            This app cannot read GitHub's secrets, so it never claims one is armed: each line below says what's honestly
            knowable and how to arm or verify it yourself.
          </p>
        </div>
        <Button
          size="sm" variant="outline" className="min-h-[44px] shrink-0"
          onClick={() => emailCard.mutate()}
          disabled={emailCard.isPending}
          data-testid="email-break-glass-card"
        >
          {emailCard.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Email me the break-glass card"}
        </Button>
      </div>
      <ul className="divide-y divide-border/60">
        {EXTERNAL_WATCHDOGS.map((w) => {
          const open = openKey === w.key;
          return (
            <li key={w.key} className="py-2" data-testid={`watchdog-${w.key}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 text-left min-h-[44px]"
                onClick={() => setOpenKey(open ? null : w.key)}
                aria-expanded={open}
                data-testid={`watchdog-${w.key}-toggle`}
              >
                {/* Amber, always — an unverifiable watchdog is never shown green. */}
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-acr-warn" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{w.title}</span>
                  <span className="block text-xs text-muted-foreground">{w.what}</span>
                  <span className="block text-xs text-acr-warn">{w.stateLine}</span>
                </span>
                {open ? (
                  <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
              {open && (
                <div className="mt-2 ml-3.5 rounded-md border border-border bg-muted/50 px-2.5 py-2" data-testid={`watchdog-${w.key}-how`}>
                  <p className="text-micro font-medium text-foreground mb-1">
                    Secret{w.secrets.length === 1 ? "" : "s"} to set: {w.secrets.join(" + ")}
                  </p>
                  <ol className="list-decimal space-y-1 pl-4">
                    {w.how.map((step) => (
                      <li key={step} className="text-micro text-muted-foreground break-words">{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-micro text-muted-foreground">
        The full "if AcreOS is dark" one-pager (who hosts what, first steps, vendor support) is the break-glass card —
        it must also live outside the app. Email yourself a copy above, then print it or file it.
      </p>
    </div>
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

// ── Connections — connect the platform's accounts from inside AcreOS ────────
// Values save encrypted (DB-first, env fallback — a pasted key works with no
// redeploy). Secrets render as …last4 only. OAuth providers (ad accounts) get
// a Connect button once their app credentials are saved.

interface ConnectionField {
  name: string;
  label: string;
  secret: boolean;
  source: "db" | "env" | "missing";
  fingerprint: string | null;
}

interface ConnectionProvider {
  key: string;
  label: string;
  category: string;
  powers: string;
  note?: string;
  oauth?: { note: string; connected: boolean };
  fields: ConnectionField[];
  connected: boolean;
  lastVerifiedAt: string | null;
  lastVerificationStatus: string | null;
}

const CONNECTIONS_KEY = ["/api/founder/connections"];

function ConnectionsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const connections = useQuery<{ providers: ConnectionProvider[] }>({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/connections", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: async (vars: { provider: string; values: Record<string, string> }) => {
      const res = await fetch(`/api/founder/connections/${vars.provider}/fields`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: vars.values }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Couldn't save (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      void qc.invalidateQueries({ queryKey: STEP_AWAY_KEY });
      setDrafts({});
      toast({ title: "Saved", description: "Stored encrypted. It's live now — no redeploy needed." });
    },
    onError: (err) => toast({ title: "Couldn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const verify = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/founder/connections/${provider}/verify`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(`Verify failed (${res.status})`);
      return res.json() as Promise<{ ok: boolean; detail: string }>;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      toast({ title: r.ok ? "Verified" : "Not working yet", description: r.detail, variant: r.ok ? undefined : "destructive" });
    },
    onError: (err) => toast({ title: "Couldn't verify", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/founder/connections/${provider}/disconnect`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      void qc.invalidateQueries({ queryKey: STEP_AWAY_KEY });
      toast({ title: "Disconnected", description: "Values entered here are revoked. Server-side secrets (if set) govern again." });
    },
    onError: (err) => toast({ title: "Couldn't disconnect", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const connectOAuth = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/founder/connections/${provider}/oauth/start`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Couldn't start connect (${res.status})`);
      }
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      window.location.assign(r.url);
    },
    onError: (err) => toast({ title: "Couldn't start connect", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const providers = connections.data?.providers ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Connections</h2>
        <span className="text-xs text-muted-foreground">— the accounts your company runs on, connected from right here</span>
      </div>
      <Card>
        <CardContent className="p-4">
          {connections.isLoading ? (
            <Skeleton className="h-24 w-full rounded-card" />
          ) : connections.isError ? (
            <QueryErrorState error={connections.error instanceof Error ? connections.error : new Error("Failed")} title="Connections unavailable" onRetry={() => void connections.refetch()} />
          ) : (
            <ul className="divide-y divide-border/60">
              {providers.map((p) => {
                const open = openProvider === p.key;
                const verified = p.lastVerificationStatus === "verified";
                return (
                  <li key={p.key} className="py-2">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 text-left min-h-[44px]"
                      onClick={() => setOpenProvider(open ? null : p.key)}
                      aria-expanded={open}
                      data-testid={`connection-${p.key}`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${p.connected ? (verified ? "bg-acr-pos" : "bg-acr-warn") : "bg-muted-foreground/40"}`}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-foreground">{p.label}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.powers}</span>
                      <span className="shrink-0 text-micro text-muted-foreground">
                        {p.connected ? (verified ? "Verified" : "Set — verify?") : "Not connected"}
                      </span>
                    </button>
                    {open && (
                      <div className="mt-2 space-y-3 rounded-card border border-border/60 bg-muted/20 p-3">
                        {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
                        <div className="grid gap-3 sm:grid-cols-2">
                          {p.fields.map((f) => {
                            const draftKey = `${p.key}.${f.name}`;
                            const placeholder =
                              f.source === "db"
                                ? f.secret
                                  ? `saved ${f.fingerprint ?? ""} — paste to replace`
                                  : "saved — type to replace"
                                : f.source === "env"
                                  ? "using server secret — paste to override"
                                  : "not set";
                            return (
                              <div key={f.name} className="space-y-1">
                                <Label htmlFor={draftKey} className="text-xs">{f.label}</Label>
                                <Input
                                  id={draftKey}
                                  type={f.secret ? "password" : "text"}
                                  autoComplete="off"
                                  placeholder={placeholder}
                                  value={drafts[draftKey] ?? ""}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm" className="min-h-[40px]"
                            disabled={save.isPending || !p.fields.some((f) => (drafts[`${p.key}.${f.name}`] ?? "").trim())}
                            onClick={() => {
                              const values: Record<string, string> = {};
                              for (const f of p.fields) {
                                const v = (drafts[`${p.key}.${f.name}`] ?? "").trim();
                                if (v) values[f.name] = v;
                              }
                              save.mutate({ provider: p.key, values });
                            }}
                          >
                            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Save"}
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-[40px]" disabled={verify.isPending} onClick={() => verify.mutate(p.key)}>
                            {verify.isPending && verify.variables === p.key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Verify"}
                          </Button>
                          {p.oauth && (
                            <Button size="sm" variant={p.oauth.connected ? "outline" : "default"} className="min-h-[40px]" disabled={connectOAuth.isPending} onClick={() => connectOAuth.mutate(p.key)}>
                              {p.oauth.connected ? "Reconnect account" : "Connect account"}
                            </Button>
                          )}
                          {p.fields.some((f) => f.source === "db") && (
                            <Button size="sm" variant="ghost" className="min-h-[40px] text-muted-foreground" disabled={disconnect.isPending} onClick={() => disconnect.mutate(p.key)}>
                              Disconnect
                            </Button>
                          )}
                        </div>
                        {p.oauth && !p.oauth.connected && (
                          <p className="text-micro text-muted-foreground">{p.oauth.note}</p>
                        )}
                        {p.lastVerificationStatus && !verified && (
                          <p className="text-micro text-acr-warn">{p.lastVerificationStatus}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
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
