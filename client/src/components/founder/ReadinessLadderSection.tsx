/**
 * ReadinessLadderSection — the founder's OWN onboarding, as a SECTION of the
 * Controls door (founder ask, 2026-07-30).
 *
 * Deliberately not a route. The four-door doctrine says the founder surface
 * should SHRINK as the autopilot takes over, so a setup experience that owned
 * its own door would contradict the whole design. It lives here beside the
 * connectors / trust / delegation / break-glass sections it points into, and it
 * CONSUMES ITSELF: done rungs collapse into a one-line history, and once every
 * rung is verified the ladder becomes a short "here is what I now run
 * unattended, and here is the next thing I could take over" card.
 *
 * Honesty is structural, not stylistic: the server never returns `done` for a
 * rung it couldn't read, and this component has no state that could render one
 * green anyway — `unverifiable` gets its own amber treatment and says why.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sunrise, ChevronUp, ChevronDown, CheckCircle2, AlertCircle, HelpCircle,
  Lock, ArrowRight, Sparkles, CircleDot,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";

// ── Wire types (mirror server/services/founder/readinessLadder.ts) ───────────

type RungState = "done" | "not_done" | "blocked" | "unverifiable";
type RungStage = "foundation" | "rails" | "safety" | "handover";

interface LadderRung {
  key: string;
  stage: RungStage;
  title: string;
  state: RungState;
  evidence: string;
  unlocks: string;
  costs: string | null;
  ifItLapses: string;
  action?: string;
  href: string;
  dependsOn: string[];
  waitingOn: string[];
  critical: boolean;
}

interface ReadinessLadder {
  rungs: LadderRung[];
  completed: Array<{ key: string; title: string; evidence: string }>;
  doneCount: number;
  totalCount: number;
  unverifiableCount: number;
  criticalOpenCount: number;
  nextStep: { key: string; title: string; action: string; href: string } | null;
  letterLine: string;
  operating: string[];
  nextHandover: { domain: string; from: string; to: string; evidence: string } | null;
  complete: boolean;
}

export const READINESS_LADDER_KEY = ["/api/founder/autopilot/readiness-ladder"];

const STAGE_LABEL: Record<RungStage, string> = {
  foundation: "Foundation",
  rails: "Rails",
  safety: "Safety net",
  handover: "Handover",
};

const STAGE_LINE: Record<RungStage, string> = {
  foundation: "It can think, and it can reach you.",
  rails: "It can charge, write, mail and look things up.",
  safety: "It's watched from outside, and bounded.",
  handover: "What you let it do without you.",
};

/** Never green unless the server measured it green. */
const STATE_META: Record<RungState, { label: string; tone: string; dot: string; icon: typeof CheckCircle2 }> = {
  done: { label: "Done", tone: "text-acr-pos", dot: "bg-acr-pos", icon: CheckCircle2 },
  not_done: { label: "Not done", tone: "text-acr-warn", dot: "bg-acr-warn", icon: AlertCircle },
  blocked: { label: "Needs an earlier rung", tone: "text-muted-foreground", dot: "bg-muted-foreground/50", icon: Lock },
  unverifiable: { label: "Can't verify", tone: "text-acr-warn", dot: "bg-acr-warn", icon: HelpCircle },
};

function titleOf(rungs: LadderRung[], completed: ReadinessLadder["completed"], key: string): string {
  return rungs.find((r) => r.key === key)?.title ?? completed.find((c) => c.key === key)?.title ?? key;
}

/** Skeleton matching the ladder's real shape: header row + three rung rows. */
function LadderSkeleton() {
  return (
    <Card data-testid="skeleton-readiness-ladder">
      <CardContent className="p-4 space-y-3" aria-busy="true">
        <span className="sr-only">Loading your setup ladder</span>
        <div className="flex items-center gap-3">
          <Skeleton announce={false} className="h-9 w-9 shrink-0 rounded-card" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton announce={false} className="h-4 w-52" />
            <Skeleton announce={false} className="h-3 w-72" />
          </div>
          <Skeleton announce={false} className="h-5 w-16 shrink-0 rounded-full" />
        </div>
        <div className="space-y-2 pt-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-2">
              <Skeleton announce={false} className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton announce={false} className="h-4 w-40" />
                <Skeleton announce={false} className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReadinessLadderSection() {
  const [openRung, setOpenRung] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const ladder = useQuery<ReadinessLadder>({
    queryKey: READINESS_LADDER_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/readiness-ladder", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load your setup ladder (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  if (ladder.isLoading) return <LadderSkeleton />;
  if (ladder.isError || !ladder.data) {
    return (
      <QueryErrorState
        error={ladder.error instanceof Error ? ladder.error : new Error("Failed")}
        title="Setup ladder unavailable"
        onRetry={() => void ladder.refetch()}
      />
    );
  }

  const d = ladder.data;
  const stages = (["foundation", "rails", "safety", "handover"] as const).filter((s) =>
    d.rungs.some((r) => r.stage === s),
  );

  return (
    <div className="space-y-3" data-testid="readiness-ladder">
      <div className="flex items-center gap-2">
        <Sunrise className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Setting this up</h2>
        <span className="text-xs text-muted-foreground">
          — your own onboarding. Every rung is measured, and it disappears as you finish it.
        </span>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Header: real counts + the honest unverifiable note. */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-micro" data-testid="ladder-progress">
              {d.doneCount}/{d.totalCount} verified
            </Badge>
            {d.criticalOpenCount > 0 && (
              <Badge variant="destructive" className="text-micro" data-testid="ladder-critical-open">
                {d.criticalOpenCount} essential {d.criticalOpenCount === 1 ? "rung" : "rungs"} left
              </Badge>
            )}
            {d.unverifiableCount > 0 && (
              <span className="text-micro text-acr-warn" data-testid="ladder-unverifiable-count">
                {d.unverifiableCount} can't be verified — so {d.unverifiableCount === 1 ? "it isn't" : "they aren't"} counted as done
              </span>
            )}
          </div>

          {/* The one next step, verbatim from the server. */}
          {d.nextStep ? (
            <div
              className="rounded-card border border-primary/40 bg-primary/5 p-3"
              data-testid="ladder-next-step"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-primary">Do this next</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{d.nextStep.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{d.nextStep.action}</p>
            </div>
          ) : d.complete ? (
            <div className="flex items-start gap-2 rounded-card border border-acr-pos/40 bg-acr-pos/5 p-3" data-testid="ladder-complete">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-acr-pos" aria-hidden="true" />
              <p className="text-sm text-foreground">
                Setup is finished — all {d.totalCount} rungs verified. This section has nothing left to ask you for.
              </p>
            </div>
          ) : null}

          {/* The open rungs, grouped by stage, in dependency order. */}
          {d.rungs.length > 0 && (
            <motion.div className="space-y-4" variants={staggerContainer} initial="hidden" animate="visible">
              {stages.map((stage) => (
                <motion.div key={stage} variants={staggerItem} data-testid={`ladder-stage-${stage}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{STAGE_LABEL[stage]}</h3>
                    <span className="text-micro text-muted-foreground">{STAGE_LINE[stage]}</span>
                  </div>
                  <ul className="mt-1 divide-y divide-border/60">
                    {d.rungs
                      .filter((r) => r.stage === stage)
                      .map((r) => {
                        const meta = STATE_META[r.state];
                        const open = openRung === r.key;
                        return (
                          <li key={r.key} className="py-2" data-testid={`ladder-rung-${r.key}`}>
                            <button
                              type="button"
                              className="flex w-full items-start gap-2 rounded-sm text-left min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => setOpenRung(open ? null : r.key)}
                              aria-expanded={open}
                              data-testid={`ladder-rung-${r.key}-toggle`}
                            >
                              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">{r.title}</span>
                                  {r.critical && (
                                    <Badge variant="outline" className="text-micro">essential</Badge>
                                  )}
                                  <span className={`text-micro ${meta.tone}`} data-testid={`ladder-rung-${r.key}-state`}>
                                    {meta.label}
                                  </span>
                                </span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{r.evidence}</span>
                                {r.state === "blocked" && r.waitingOn.length > 0 && (
                                  <span className="mt-0.5 block text-micro text-muted-foreground">
                                    Waiting on: {r.waitingOn.map((k) => titleOf(d.rungs, d.completed, k)).join(", ")}
                                  </span>
                                )}
                              </span>
                              {open ? (
                                <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              )}
                            </button>

                            {/* The teaching half — why this rung exists at all. */}
                            {open && (
                              <div
                                className="mt-2 ml-3.5 space-y-2 rounded-card border border-border/60 bg-muted/30 px-3 py-2.5"
                                data-testid={`ladder-rung-${r.key}-detail`}
                              >
                                <div>
                                  <p className="text-micro font-semibold uppercase tracking-wide text-foreground">What it unlocks</p>
                                  <p className="text-xs text-muted-foreground">{r.unlocks}</p>
                                </div>
                                <div>
                                  <p className="text-micro font-semibold uppercase tracking-wide text-foreground">What it costs</p>
                                  <p className="text-xs text-muted-foreground">{r.costs ?? "Nothing — no metered cost and no vendor bill."}</p>
                                </div>
                                <div>
                                  <p className="text-micro font-semibold uppercase tracking-wide text-foreground">If it lapses</p>
                                  <p className="text-xs text-muted-foreground">{r.ifItLapses}</p>
                                </div>
                                {r.action && (
                                  <p className="text-xs text-foreground/90">→ {r.action}</p>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* What it now runs unattended — from the real trust ledger. */}
          {d.operating.length > 0 && (
            <div className="rounded-card border border-border bg-muted/20 p-3" data-testid="ladder-operating">
              <p className="text-xs font-semibold text-foreground">What I now do without you</p>
              <ul className="mt-1 space-y-0.5">
                {d.operating.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-acr-pos" aria-hidden="true" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The next thing it could take over, with its real evidence. */}
          {d.nextHandover && (
            <div className="rounded-card border border-border bg-card p-3" data-testid="ladder-next-handover">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    Next I could take over: {d.nextHandover.domain} — from {d.nextHandover.from} to {d.nextHandover.to}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.nextHandover.evidence}</p>
                  <p className="mt-0.5 text-micro text-muted-foreground">
                    Grant or pause it in Trust below. Reversible in one tap, always.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Finished rungs — kept, but out of the way. */}
          {d.completed.length > 0 && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[40px] px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
                data-testid="ladder-history-toggle"
              >
                {showHistory ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="ml-1 text-xs">
                  {d.completed.length} already set up
                </span>
              </Button>
              {showHistory && (
                <ul className="mt-1 space-y-1" data-testid="ladder-history">
                  {d.completed.map((c) => (
                    <li key={c.key} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-pos" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-foreground">{c.title}</span>
                        <span className="block text-micro text-muted-foreground">{c.evidence}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-micro text-muted-foreground">
            Nothing here is a checkbox you tick — every rung is read from the same secrets, ledgers and switches the
            runtime obeys. A rung that can't be read says so rather than going green.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The Letter's ONE line. The Letter stays a letter — this adds at most a single
 * sentence naming the highest-value next action and linking into Controls, and
 * renders NOTHING when setup is finished or the ladder can't be read (the
 * Letter never blocks or apologises for an auxiliary signal).
 */
export function ReadinessLadderLetterLine() {
  const { data, isError } = useQuery<ReadinessLadder>({
    queryKey: READINESS_LADDER_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/readiness-ladder", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  if (isError || !data || data.complete) return null;
  return (
    <Link
      href="/founder/autopilot/control"
      className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm hover-elevate"
      data-testid="letter-setup-line"
    >
      <Sunrise className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">{data.letterLine}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
