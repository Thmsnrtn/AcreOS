/**
 * /settings/pax — Pax kill-switch surface (Workstream A, Honesty).
 *
 * The Fadell "panicked Nest grandma at 11pm" surface: a one-tap home for
 * pause / replay / reset, plus an explicit explanation of what the
 * autonomy slider on Today actually does today (and what it does not).
 *
 * Three controls:
 *   1. Pause all Pax automation for 24h — writes
 *      users.autonomyPreferences.pax.pausedUntil. ENFORCED server-side
 *      (server/services/paxPause.ts, org-level): the executeTool chokepoint
 *      refuses side-effecting tools, the Pax scheduler skips due tasks, and
 *      the autonomous decision executor defers org items while paused.
 *      Read-only lookups and drafts still run; the pause expires on its own.
 *   2. Replay last 10 Pax actions — read-only feed of recent
 *      paxObservations + status.
 *   3. Reset Pax to manual-only — sets the Today threshold to the 1.01
 *      sentinel ("never auto") and clears pausedUntil.
 */

import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PauseCircle, RotateCcw, History, AlertTriangle, ShieldOff, Clock, FileCode, Gauge, X } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AutopilotSetup } from "@/components/settings/autopilot-setup";

// Sentinel threshold — when the autonomy slider hits this value the
// "auto above" gate can never trip (confidences are 0..1, ours are .50–1.00).
const NEVER_AUTO_PCT = 101;
const AUTONOMY_THRESHOLD_KEY = "confidenceAutoPct";
const AUTONOMY_DEFAULT_PCT = 90;
const REPLAY_LIMIT = 10;

interface AgentAutonomyShape {
  level?: 0 | 1 | 2 | 3;
  perAction?: Record<string, 0 | 1 | 2 | 3>;
  thresholdsCents?: Record<string, number>;
  pausedUntil?: string;
}

interface AutonomyPrefs {
  pax?: AgentAutonomyShape;
}

interface PaxObservation {
  id: number;
  type: string;
  title: string;
  description: string;
  status: string;
  confidenceScore: number;
  severity: string;
  detectedAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isCurrentlyPaused(pausedUntil: string | undefined): boolean {
  if (!pausedUntil) return false;
  const t = Date.parse(pausedUntil);
  return Number.isFinite(t) && t > Date.now();
}

function fmtRemaining(pausedUntil: string): string {
  const t = Date.parse(pausedUntil);
  if (!Number.isFinite(t)) return "—";
  const minutes = Math.max(0, Math.round((t - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m remaining` : `${hours}h remaining`;
}

function statusTone(status: string): { label: string; cls: string } {
  if (status === "acknowledged") return { label: "acknowledged", cls: "bg-acr-brand-soft text-acr-brand" };
  if (status === "dismissed") return { label: "dismissed", cls: "bg-muted text-muted-foreground" };
  if (status === "escalated") return { label: "escalated", cls: "bg-acr-warn-soft text-acr-warn" };
  if (status === "auto_resolved") return { label: "auto-resolved", cls: "bg-acr-pos-soft text-acr-pos" };
  return { label: status || "detected", cls: "bg-muted text-muted-foreground" };
}

export default function PaxControlsPage() {
  useDocumentTitle("Pax controls — AcreOS");
  const { toast } = useToast();

  const { data: autonomy, isLoading: autonomyLoading } = useQuery<AutonomyPrefs>({
    queryKey: ["/api/me/autonomy"],
  });

  const paused = isCurrentlyPaused(autonomy?.pax?.pausedUntil);

  const {
    data: observationsResp,
    isLoading: observationsLoading,
    error: observationsError,
    refetch: refetchObservations,
  } = useQuery<{ observations: PaxObservation[] }>({
    queryKey: ["/api/pax/observations", { limit: REPLAY_LIMIT }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pax/observations?limit=${REPLAY_LIMIT}`);
      return res.json();
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await apiRequest("PATCH", "/api/me/autonomy", {
        pax: {
          ...(autonomy?.pax ?? {}),
          pausedUntil: until,
        },
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
      toast({
        title: "Pax paused for 24 hours",
        description: "Pax will only ask, never act, until the pause lifts.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't pause Pax",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const prevThresholds = autonomy?.pax?.thresholdsCents ?? {};
      const next: AgentAutonomyShape = {
        ...(autonomy?.pax ?? {}),
        thresholdsCents: { ...prevThresholds, [AUTONOMY_THRESHOLD_KEY]: NEVER_AUTO_PCT },
      };
      // Clear pausedUntil so the user isn't stuck waiting AND in manual mode.
      delete next.pausedUntil;
      const res = await apiRequest("PATCH", "/api/me/autonomy", { pax: next });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
      toast({
        title: "Pax reset to manual-only",
        description: "Pax will ask before every action.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't reset Pax",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const unpauseMutation = useMutation({
    mutationFn: async () => {
      const next: AgentAutonomyShape = { ...(autonomy?.pax ?? {}) };
      delete next.pausedUntil;
      const res = await apiRequest("PATCH", "/api/me/autonomy", { pax: next });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
      toast({ title: "Pax pause cleared" });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't clear pause",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const observations = observationsResp?.observations ?? [];

  // ── Pax autonomy slider ────────────────────────────────────────────────
  // Moved here from Today (Chesky / Wave 2). The slider edits the saved
  // "auto above" confidence threshold; persistence reuses the existing
  // pax.thresholdsCents[confidenceAutoPct] key so no schema change.
  // Honest preview disclosure copy travels with the control.
  const savedThresholdPct =
    autonomy?.pax?.thresholdsCents?.[AUTONOMY_THRESHOLD_KEY] ?? AUTONOMY_DEFAULT_PCT;

  const [thresholdPct, setThresholdPct] = React.useState<number>(AUTONOMY_DEFAULT_PCT);
  const thresholdHydrated = React.useRef(false);
  React.useEffect(() => {
    if (!thresholdHydrated.current && autonomy !== undefined) {
      setThresholdPct(savedThresholdPct);
      thresholdHydrated.current = true;
    }
  }, [autonomy, savedThresholdPct]);

  const thresholdMutation = useMutation({
    mutationFn: async (pct: number) => {
      const prevThresholds = autonomy?.pax?.thresholdsCents ?? {};
      const res = await apiRequest("PATCH", "/api/me/autonomy", {
        pax: {
          ...(autonomy?.pax ?? {}),
          thresholdsCents: { ...prevThresholds, [AUTONOMY_THRESHOLD_KEY]: pct },
        },
      });
      if (!res.ok) throw new Error("Failed to save autonomy preference");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const commitThreshold = React.useCallback(
    (pct: number) => {
      setThresholdPct(pct);
      thresholdMutation.mutate(pct);
    },
    [thresholdMutation],
  );

  return (
    <PageShell label="Pax controls">
      <div className="mb-6">
        <h1 className="text-hero flex items-center gap-2">
          <ShieldOff className="w-7 h-7 text-acr-brand" aria-hidden="true" />
          Pax controls
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Pause, replay, or reset Pax. The pause is enforced at the server's
          tool-execution layer the moment you tap it: while paused, Pax
          refuses any action with side effects (record changes, sends,
          external triggers), scheduled Pax tasks are skipped, and the
          autonomous executor defers your org's items. Read-only lookups and
          drafts still work. The replay below shows every observation Pax has
          surfaced.
        </p>
      </div>

      {/* ── Autopilot setup — the crystal-clear config (level + tools + what
          it means). The technical controls (pause/replay/thresholds) stay
          below for power users. ─────────────────────────────────────────── */}
      <div className="mb-6">
        <AutopilotSetup />
      </div>

      {/* ── Current status banner ────────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="pax-controls-status">
        <CardContent className="p-4 flex items-start gap-3 flex-wrap">
          {autonomyLoading ? (
            <Skeleton className="h-5 w-48" />
          ) : paused && autonomy?.pax?.pausedUntil ? (
            <>
              <PauseCircle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Pax is paused</div>
                <div className="text-xs text-muted-foreground">
                  {fmtRemaining(autonomy.pax.pausedUntil)} · resumes{" "}
                  {fmtTimestamp(autonomy.pax.pausedUntil)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => unpauseMutation.mutate()}
                disabled={unpauseMutation.isPending}
                data-testid="button-pax-unpause"
              >
                Clear pause
              </Button>
            </>
          ) : (
            <>
              <Clock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Pax is active</div>
                <div className="text-xs text-muted-foreground">
                  Pax always asks before taking an action on your behalf.
                  Your autonomy threshold is saved and will apply as Pax earns
                  more independence.
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Pax autonomy threshold (moved from Today) ────────────────── */}
      <Card className="rounded-card mb-4" data-testid="card-pax-autonomy">
        <CardHeader>
          <CardTitle className="text-section-h2 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-acr-brand" aria-hidden="true" />
            Pax autonomy
          </CardTitle>
          <CardDescription>
            Pax is still asking before every move. Your threshold is saved for
            the day we flip the switch — you'll get the email first. This is a
            monthly-tune control; it used to live on Today and now lives here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <span className="text-xs text-muted-foreground">
              Pax-sourced rows above the threshold are flagged "Pax would handle".
            </span>
            <Badge
              variant="secondary"
              className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums shrink-0"
              aria-live="polite"
            >
              Auto above {thresholdPct}%
            </Badge>
          </div>
          <div className="px-1">
            <Slider
              value={[thresholdPct]}
              min={50}
              max={100}
              step={5}
              onValueChange={(v) => setThresholdPct(v[0] ?? AUTONOMY_DEFAULT_PCT)}
              onValueCommit={(v) => commitThreshold(v[0] ?? AUTONOMY_DEFAULT_PCT)}
              aria-label={`Pax auto-handle confidence threshold: ${thresholdPct} percent`}
              data-testid="slider-pax-autonomy"
            />
            <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground tabular-nums">
              <span>Ask more (50%)</span>
              <span>Auto more (100%)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Control 1: Pause for 24h ─────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="card-pax-pause">
        <CardHeader>
          <CardTitle className="text-section-h2 flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            Pause all Pax automation for 24 hours
          </CardTitle>
          <CardDescription>
            Stops every auto-execution path for 24 hours, enforced server-side
            at the tool layer, the scheduler, and the autonomous executor. Pax
            will still draft and ask — it just won't act on its own. Actions
            you explicitly approve still go through. The pause lifts
            automatically when the timer expires. Use this if anything Pax did
            surprised you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending || paused}
            data-testid="button-pax-pause-24h"
            className="border-acr-warn text-acr-warn hover:bg-acr-warn-soft"
          >
            <PauseCircle className="w-4 h-4 mr-2" aria-hidden="true" />
            {paused ? "Already paused" : "Pause Pax for 24 hours"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Control 2: Replay last 10 ────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="card-pax-replay">
        <CardHeader>
          <CardTitle className="text-section-h2 flex items-center gap-2">
            <History className="w-5 h-5 text-acr-brand" aria-hidden="true" />
            Replay last {REPLAY_LIMIT} Pax actions
          </CardTitle>
          <CardDescription>
            The most recent observations Pax surfaced and how they were
            dispositioned. Need the full LLM prompt + tool calls?{" "}
            <Link href="/founder/pax-traces" className="underline underline-offset-2 inline-flex items-center gap-1">
              Pax trace viewer
              <FileCode className="w-3 h-3" aria-hidden="true" />
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {observationsError && (
            <QueryErrorState
              error={observationsError as Error}
              onRetry={() => refetchObservations()}
              compact
              title="Couldn't load Pax actions"
              description="We hit a snag loading the last few Pax observations. Try again."
              testId="pax-replay-error"
            />
          )}
          {observationsLoading && (
            <div className="space-y-2" data-testid="pax-replay-loading">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!observationsLoading && !observationsError && observations.length === 0 && (
            <EmptyState
              icon={History}
              headline="No recent Pax actions"
              subtitle="Pax hasn't surfaced any observations yet. As soon as it does, the last 10 will appear here."
              // TODO(cta): Pax observations are system-generated; no direct user action produces them
              cta={{ label: "", _noOp: true }}
              actionIcon={null}
              testId="pax-replay-empty"
            />
          )}
          {!observationsLoading && !observationsError && observations.length > 0 && (
            <ul className="space-y-2" data-testid="pax-replay-list">
              {observations.slice(0, REPLAY_LIMIT).map((obs) => {
                const tone = statusTone(obs.status);
                return (
                  <li
                    key={obs.id}
                    className="border rounded-card p-3 flex items-start gap-3"
                    data-testid={`pax-replay-row-${obs.id}`}
                  >
                    <div
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-acr-brand-soft text-acr-brand"
                      aria-hidden="true"
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-medium text-sm truncate">{obs.title}</span>
                        <Badge variant="secondary" className={`text-[10px] border-transparent ${tone.cls}`}>
                          {tone.label}
                        </Badge>
                        <DataProvenanceChip
                          source="Pax"
                          classification="modeled"
                          confidence={obs.confidenceScore}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{obs.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                        {fmtTimestamp(obs.detectedAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Control 3: Reset to manual-only ──────────────────────────── */}
      {/* Calm danger-zone: outline until confirm click, then destructive. */}
      <Card className="rounded-card" data-testid="card-pax-reset">
        <CardHeader>
          <CardTitle className="text-section-h2 flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-acr-neg" aria-hidden="true" />
            Reset Pax to manual-only
          </CardTitle>
          <CardDescription>
            Sets the autonomy threshold to the never-auto sentinel (101%) and
            clears any pause. Pax will ask before every action, forever — until
            you raise the slider again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaxResetConfirm onConfirm={() => resetMutation.mutate()} isPending={resetMutation.isPending} />
        </CardContent>
      </Card>
    </PageShell>
  );
}

// ── Calm danger-zone confirmation — no red alarm until the moment of confirm ──

function PaxResetConfirm({
  onConfirm,
  isPending,
}: {
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [confirming, setConfirming] = React.useState(false);

  if (!confirming) {
    return (
      <Button
        variant="outline"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        data-testid="button-pax-reset"
      >
        <RotateCcw className="w-4 h-4 mr-2" aria-hidden="true" />
        Reset Pax to manual-only
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-card border border-acr-neg/30 bg-acr-neg-soft/30">
      <p className="text-sm text-muted-foreground flex-1 min-w-0">
        Pax will ask before every action. You can raise the autonomy threshold again at any time.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => { onConfirm(); setConfirming(false); }}
          disabled={isPending}
          data-testid="button-pax-reset-confirm"
        >
          {isPending ? (
            <RotateCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          )}
          Confirm reset
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          aria-label="Cancel reset"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
