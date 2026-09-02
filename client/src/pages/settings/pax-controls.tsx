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
 *      (server/services/paxPause.ts, org-level) at every unattended
 *      execution point — the enumeration lives in that module's header and
 *      is pinned by tests/unit/paxPauseCoverage.test.ts. Read-only lookups
 *      and drafts still run; the pause expires on its own.
 *
 *      The pause is ORG-WIDE (any owner's or active member's pause pauses
 *      the org), but /api/me/autonomy only ever returns the caller's own
 *      row — so this page ALSO reads /api/me/autonomy/org-pause and says
 *      honestly when a teammate's pause is what holds the org. "Clear
 *      pause" clears the caller's row only; it cannot clear a teammate's.
 *   2. Replay last 10 Pax actions — read-only feed of recent
 *      paxObservations + status.
 *   3. Reset Pax to manual-only — sets the Today threshold to the 1.01
 *      sentinel ("never auto"). It deliberately does NOT touch pausedUntil
 *      (pause coverage, 2026-09-02): a pause is a separate safety
 *      instrument, and "reset to manual" silently un-pausing the machine
 *      was the wrong direction for a kill switch to fail.
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

/** GET /api/me/autonomy/org-pause — the org-wide state, as enforcement reads it. */
interface OrgPauseState {
  paused: boolean;
  pausedUntil: string | null;
  /** The server could not read the pause and is failing CLOSED (treating the org as paused). */
  checkFailed: boolean;
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

  // The caller's OWN pause row vs the ORG-WIDE state the server enforces.
  // They differ exactly when a teammate holds the pause: then the caller's
  // row is clear, "Clear pause" would clear nothing, and the honest banner
  // is "paused by a teammate".
  const { data: orgPause, isLoading: orgPauseLoading } = useQuery<OrgPauseState>({
    queryKey: ["/api/me/autonomy/org-pause"],
    refetchInterval: 60_000,
  });

  const pausedByMe = isCurrentlyPaused(autonomy?.pax?.pausedUntil);
  const pauseCheckFailed = orgPause?.checkFailed === true;
  const pausedByTeammate = orgPause?.paused === true && !pausedByMe && !pauseCheckFailed;

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
      queryClient.invalidateQueries({ queryKey: ["/api/me/autonomy/org-pause"] });
      toast({
        title: "Pax paused for 24 hours",
        description: "Pax will only ask, never act, for your whole team until the pause lifts.",
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
      // pausedUntil is carried through UNCHANGED (spread). This mutation used
      // to `delete next.pausedUntil` "so the user isn't stuck waiting AND in
      // manual mode" — which made "reset to manual" a hidden un-pause, and a
      // kill switch must never be cleared as a side effect of another
      // control. Clearing a pause is its own explicit button.
      const next: AgentAutonomyShape = {
        ...(autonomy?.pax ?? {}),
        thresholdsCents: { ...prevThresholds, [AUTONOMY_THRESHOLD_KEY]: NEVER_AUTO_PCT },
      };
      const res = await apiRequest("PATCH", "/api/me/autonomy", { pax: next });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
      toast({
        title: "Pax reset to manual-only",
        description: "Pax will ask before every action. Any active pause stays in place.",
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
      const prefs: AutonomyPrefs = await res.json();
      // Re-read the ORG-WIDE state after clearing our own row: if a teammate
      // also paused Pax, the org is still paused and the toast must say so
      // rather than announce a resume that did not happen.
      const orgRes = await apiRequest("GET", "/api/me/autonomy/org-pause");
      const org: OrgPauseState = await orgRes.json();
      return { prefs, org };
    },
    onSuccess: ({ prefs, org }) => {
      queryClient.setQueryData(["/api/me/autonomy"], prefs);
      queryClient.setQueryData(["/api/me/autonomy/org-pause"], org);
      if (org.checkFailed) {
        toast({
          title: "Your pause is cleared, but Pax is still holding",
          description:
            "The server couldn't verify the org-wide pause state and is treating Pax as paused (failing closed). Try again shortly.",
        });
      } else if (org.paused) {
        toast({
          title: "Your pause is cleared — Pax is still paused",
          description: `A teammate's pause keeps Pax paused for the whole org until ${fmtTimestamp(org.pausedUntil)}.`,
        });
      } else {
        toast({ title: "Pax pause cleared" });
      }
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
          Pause, replay, or reset Pax. The pause is enforced server-side the
          moment you tap it, at every path that acts without you: Pax refuses
          any tool call with side effects (record changes, sends, external
          triggers), scheduled Pax tasks and scheduled jobs are skipped, the
          autonomous executor and agent task processor defer your org's
          items, workflow steps that act are blocked, sequence sends are
          deferred, and lead nurturing sits out. Read-only lookups and drafts
          still work. The pause is org-wide — it holds while any teammate's
          pause is active. The replay below shows every observation Pax has
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
          {autonomyLoading || orgPauseLoading ? (
            <Skeleton className="h-5 w-48" />
          ) : pausedByMe && autonomy?.pax?.pausedUntil ? (
            <>
              <PauseCircle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Pax is paused</div>
                <div className="text-xs text-muted-foreground">
                  {fmtRemaining(autonomy.pax.pausedUntil)} · resumes{" "}
                  {fmtTimestamp(autonomy.pax.pausedUntil)}
                  {orgPause?.paused &&
                  orgPause.pausedUntil &&
                  Date.parse(orgPause.pausedUntil) > Date.parse(autonomy.pax.pausedUntil) + 60_000
                    ? ` · a teammate's pause keeps the org paused until ${fmtTimestamp(orgPause.pausedUntil)}`
                    : null}
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
          ) : pausedByTeammate && orgPause?.pausedUntil ? (
            <>
              <PauseCircle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm" data-testid="pax-paused-by-teammate">
                  Paused by a teammate until {fmtTimestamp(orgPause.pausedUntil)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtRemaining(orgPause.pausedUntil)}. The pause is org-wide; only
                  the teammate who set it can clear it early, and it lifts on its
                  own when the timer expires.
                </div>
              </div>
            </>
          ) : pauseCheckFailed ? (
            <>
              <AlertTriangle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm" data-testid="pax-pause-check-failed">
                  Pax is holding — pause state couldn't be verified
                </div>
                <div className="text-xs text-muted-foreground">
                  The server couldn't read your org's pause setting, so it is
                  treating Pax as paused (failing closed). Nothing auto-executes
                  until the read succeeds again.
                </div>
              </div>
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
            at the tool layer, the Pax scheduler, the autonomous executor,
            workflows, sequences, lead nurturing, the agent task processor,
            agent skills, and scheduled tasks. Pax will still draft and ask —
            it just won't act on its own. Actions you explicitly approve still
            go through. Paused work is skipped or deferred, never cancelled,
            and resumes when the timer expires. The pause is org-wide: it
            holds for your whole team while anyone's pause is active. Use this
            if anything Pax did surprised you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending || pausedByMe}
            data-testid="button-pax-pause-24h"
            className="border-acr-warn text-acr-warn hover:bg-acr-warn-soft"
          >
            <PauseCircle className="w-4 h-4 mr-2" aria-hidden="true" />
            {pausedByMe ? "Already paused" : "Pause Pax for 24 hours"}
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
            Sets the autonomy threshold to the never-auto sentinel (101%). Pax
            will ask before every action, forever — until you raise the slider
            again. An active pause is left in place; clear it separately above.
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
