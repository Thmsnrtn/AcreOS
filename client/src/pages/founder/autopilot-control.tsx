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
  ScrollText, MessageSquareQuote, Sparkles, ArrowRight, TrendingUp,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  settings: { dispatchEnabled: boolean; publishEnabled: boolean; source: { dispatch: "db" | "env"; publish: "db" | "env" } };
  ledger: LedgerEntry[];
  openAsks: number;
  calibration: { grade: string; n: number } | null;
  conversions?: { totalSignups: number; byPlay: Array<{ playId: string; signups: number }> };
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

function ControlLink({ href, icon: Icon, title }: { href: string; icon: typeof Power; title: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-muted/50 min-h-[44px]" data-testid={`control-link-${title}`}>
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-foreground">{title}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
    </Link>
  );
}
