/**
 * /founder/admin/costs — the unified Costs & economics instrument.
 *
 * Founder-nav consolidation (Phase 2): seven separate cost/economics routes
 * (/founder/cost, /ai-costs, /cost-optimizer, /unit-economics,
 * /observability-cost, /providers, /paid-data-eval) collapsed into one tabbed
 * hub under the /founder/admin/* deliberate-instrument namespace. Each tab
 * renders the original page's shell-less *Content component verbatim — zero
 * behavior change, one PageShell, one nav entry instead of seven.
 *
 * Deep-link a tab with ?tab=<value> (e.g. ?tab=ai-spend) so the command palette
 * and bookmarks can land directly on a sub-view.
 */
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatRelative } from "@/lib/format";
import { RefreshCw, Radio, ShieldAlert, Activity, HardDrive, ScanSearch, Scale } from "lucide-react";

import { CostContent } from "@/pages/founder/cost";
import { AiCostsContent } from "@/pages/founder/ai-costs";
import { CostOptimizerContent } from "@/pages/founder/cost-optimizer";
import { UnitEconomicsContent } from "@/pages/founder/unit-economics";
import { ObservabilityCostContent } from "@/pages/founder/observability-cost";
import { ProvidersContent } from "@/pages/founder-providers";
import { PaidDataEvalContent } from "@/pages/founder/paid-data-eval";
import { InfraCurvePanel } from "@/components/founder/InfraCurvePanel";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "ai-spend", label: "AI spend" },
  { value: "optimizer", label: "Optimizer" },
  { value: "unit-economics", label: "Unit economics" },
  { value: "sentry", label: "Observability" },
  { value: "providers", label: "Providers" },
  { value: "data-plane", label: "Data plane" },
  { value: "paid-data", label: "Paid-data trial" },
] as const;

// ─── Data plane (ruling #9 wave 4) ───────────────────────────────────────────
// One honest pane: is the free-data machine healthy? Every section mirrors the
// GET /api/founder/intelligence/data-plane response, where each section is
// best-effort — { available: false, reason } renders as an explicit "couldn't
// check" tile (never omitted, never guessed). All numbers are real records.

type DataPlaneSection<T> = ({ available: true } & T) | { available: false; reason: string };

interface DataPlaneResponse {
  generatedAt: string;
  probeHealth: DataPlaneSection<{
    windowHours: number;
    instruments: Array<{
      probe: string;
      source: string;
      category: string;
      healthy: boolean;
      latencyMs: number | null;
      detail: string | null;
      lastCheckedAt: string;
    }>;
    healthyCount: number;
    darkCount: number;
  }>;
  circuits: DataPlaneSection<{
    circuits: Array<{ source: string; state: string; failures: number; updatedAt: string }>;
    openCount: number;
  }>;
  recentChanges: DataPlaneSection<{
    windowDays: number;
    count: number;
    countIsLowerBound: boolean;
    latest: Array<{
      category: string;
      severity: string;
      source: string;
      narrative: string;
      detectedAt: string;
    }>;
  }>;
  corpora: DataPlaneSection<{
    corpora: Array<{ key: string; ingestStatus: string; reason: string }>;
  }>;
  discoveryQueue: DataPlaneSection<{ pendingReviewCount: number }>;
  licenses: DataPlaneSection<{ totalSources: number; byClassification: Record<string, number> }>;
}

const DATA_PLANE_KEY = ["/api/founder/intelligence/data-plane"];

/** Honest per-section failure tile: the check itself failed — say so, verbatim. */
function SectionUnavailable({ reason }: { reason: string }) {
  return (
    <div className="text-sm text-muted-foreground" data-testid="data-plane-unavailable">
      <span className="font-medium text-acr-warn">Couldn't check.</span>{" "}
      <span className="break-words">{reason}</span>
    </div>
  );
}

const CORPUS_STATUS_LABEL: Record<string, string> = {
  not_provisioned: "not provisioned",
  storage_configured_pipeline_pending: "storage configured — pipeline pending",
};

const LICENSE_CLASSIFICATION_LABEL: Record<string, string> = {
  yes: "Redistributable",
  attribution: "Redistributable with attribution",
  "review-required": "Review required",
  no: "No redistribution",
};

function DataPlaneTileSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

export function DataPlaneContent() {
  const query = useQuery<DataPlaneResponse>({
    queryKey: DATA_PLANE_KEY,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="data-plane-loading">
        {/* Six placeholder tiles — one per section of the pane (layout, not data). */}
        {["canary", "circuits", "changes", "corpora", "discovery", "licenses"].map((k) => (
          <DataPlaneTileSkeleton key={k} />
        ))}
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <QueryErrorState
        error={query.error instanceof Error ? query.error : new Error(String(query.error ?? "No data returned"))}
        onRetry={() => query.refetch()}
        isRetrying={query.isRefetching}
        title="Could not load the data-plane pane"
      />
    );
  }

  const d = query.data;

  return (
    <div className="space-y-4" data-testid="data-plane-pane">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Is the free-data machine healthy? Six checks, each honest about what it could and
          couldn't read. Snapshot from {formatRelative(d.generatedAt)}.
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh data plane"
          onClick={() => query.refetch()}
          disabled={query.isRefetching}
        >
          <RefreshCw className={query.isRefetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <motion.div
        className="grid gap-4 md:grid-cols-2"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* ── Canary ─────────────────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-canary">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Canary
              </CardTitle>
              <CardDescription>
                Golden-parcel probes through the real provider stack, every ~30 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.probeHealth.available ? (
                <SectionUnavailable reason={d.probeHealth.reason} />
              ) : d.probeHealth.instruments.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  headline="The canary hasn't reported"
                  subtitle={`No probe results written in the last ${d.probeHealth.windowHours} hours — the dataSourceProbe job may not be running.`}
                  tone="warning"
                  // TODO(cta): founder-only read panel — the probe job runs on the worker; no in-app action exists
                  cta={{ label: "", _noOp: true }}
                  testId="data-plane-canary-empty"
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {d.probeHealth.darkCount === 0
                      ? `All ${d.probeHealth.healthyCount} instruments answering.`
                      : `${d.probeHealth.darkCount} of ${d.probeHealth.instruments.length} instruments dark — a system alert was raised.`}
                  </p>
                  <ul className="space-y-1.5">
                    {d.probeHealth.instruments.map((i) => (
                      <li key={i.probe} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.healthy ? "bg-acr-pos" : "bg-acr-neg"}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="font-medium">{i.probe}</span>{" "}
                          <span className="text-muted-foreground">
                            · {i.source} · {formatRelative(i.lastCheckedAt)}
                            {!i.healthy && i.detail ? ` — ${i.detail}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Circuit breakers ───────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-circuits">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Circuit breakers
              </CardTitle>
              <CardDescription>
                An open circuit means the registry is skipping that source until it cools off.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.circuits.available ? (
                <SectionUnavailable reason={d.circuits.reason} />
              ) : d.circuits.circuits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No breaker state recorded — no provider has tripped since the store began
                  persisting.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {d.circuits.openCount === 0
                      ? `All ${d.circuits.circuits.length} tracked circuits closed — nothing is being skipped.`
                      : `${d.circuits.openCount} circuit${d.circuits.openCount === 1 ? "" : "s"} not closed — those sources are being skipped.`}
                  </p>
                  <ul className="space-y-1.5">
                    {d.circuits.circuits.map((c) => (
                      <li key={c.source} className="flex items-center gap-2 text-sm">
                        <Badge variant={c.state === "closed" ? "secondary" : "destructive"}>
                          {c.state}
                        </Badge>
                        <span className="font-medium">{c.source}</span>
                        <span className="text-muted-foreground">
                          {c.failures} failure{c.failures === 1 ? "" : "s"} ·{" "}
                          {formatRelative(c.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Change events ──────────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-changes">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Change events
              </CardTitle>
              <CardDescription>
                The world changing under known places — flood zones redrawn, wetlands remapped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.recentChanges.available ? (
                <SectionUnavailable reason={d.recentChanges.reason} />
              ) : d.recentChanges.count === 0 ? (
                <EmptyState
                  icon={Activity}
                  headline="No material changes detected"
                  subtitle={`Nothing the diff rules consider material has changed in the last ${d.recentChanges.windowDays} days.`}
                  // TODO(cta): founder-only read panel — change events are written by lookups, no user action exists
                  cta={{ label: "", _noOp: true }}
                  testId="data-plane-changes-empty"
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {d.recentChanges.count}
                    {d.recentChanges.countIsLowerBound ? "+" : ""} material change
                    {d.recentChanges.count === 1 && !d.recentChanges.countIsLowerBound ? "" : "s"} in
                    the last {d.recentChanges.windowDays} days.
                  </p>
                  <ul className="space-y-2">
                    {d.recentChanges.latest.map((e, idx) => (
                      <li key={`${e.detectedAt}-${idx}`} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant={e.severity === "notable" ? "default" : "secondary"}>
                            {e.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {e.source} · {formatRelative(e.detectedAt)}
                          </span>
                        </div>
                        <p className="mt-0.5">{e.narrative}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Corpora ────────────────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-corpora">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Owned corpora
              </CardTitle>
              <CardDescription>
                Tier-2 bulk corpora (ruling #10). Status never overstates — each line carries the
                real reason.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.corpora.available ? (
                <SectionUnavailable reason={d.corpora.reason} />
              ) : (
                <ul className="space-y-1.5">
                  {d.corpora.corpora.map((c) => (
                    <li key={c.key} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.key}</span>
                        <Badge variant="outline">
                          {CORPUS_STATUS_LABEL[c.ingestStatus] ?? c.ingestStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Discovery queue ────────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-discovery">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanSearch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Discovery queue
              </CardTitle>
              <CardDescription>
                County GIS endpoints found by the discovery scan, awaiting a human decision.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.discoveryQueue.available ? (
                <SectionUnavailable reason={d.discoveryQueue.reason} />
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-semibold tabular-nums">
                    {d.discoveryQueue.pendingReviewCount}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    endpoint{d.discoveryQueue.pendingReviewCount === 1 ? "" : "s"} pending review.
                    There's no review screen yet — approve or reject through the admin API
                    (/api/discovery/pending).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── License register ───────────────────────────────────────── */}
        <motion.div variants={staggerItem}>
          <Card className="h-full" data-testid="data-plane-licenses">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                License register
              </CardTitle>
              <CardDescription>
                Every cached-and-re-served row traces to a reviewed license posture.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!d.licenses.available ? (
                <SectionUnavailable reason={d.licenses.reason} />
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {d.licenses.totalSources} sources on the register.
                  </p>
                  <ul className="space-y-1">
                    {Object.entries(d.licenses.byClassification).map(([k, n]) => (
                      <li key={k} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {LICENSE_CLASSIFICATION_LABEL[k] ?? k}
                        </span>
                        <span className="font-medium tabular-nums">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Outreach stop-loss (founder rulings #4/#5, 2026-07-28) ──────────────────
// The monthly mail+data spend line that pauses outreach until the founder
// looks. Status from GET /api/founder/autopilot/stop-loss; the resume button
// is the founder's "I've looked — resume this month" tap. Honest states
// throughout: an unreadable ledger says so (and blocks resume) — never a
// fabricated zero.

interface StopLossStatus {
  lineCents: number;
  mtdSpendCents: number | null;
  mailCents: number | null;
  dataCents: number | null;
  paused: boolean;
  reason: string;
  monthKey: string;
  acknowledgedAtCents: number | null;
  effectiveThresholdCents: number | null;
}

const STOP_LOSS_KEY = ["/api/founder/autopilot/stop-loss"];

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function OutreachStopLossCard() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery<StopLossStatus>({
    queryKey: STOP_LOSS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/stop-loss", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load stop-loss status (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const resume = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/autopilot/stop-loss/resume", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.message ?? `Couldn't resume (${res.status})`);
      }
      return body as { ok: boolean; message: string };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: STOP_LOSS_KEY });
      toast({ title: "Outreach resumed", description: data.message });
    },
    onError: (err) =>
      toast({
        title: "Couldn't resume",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });

  if (query.isLoading) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (query.error) {
    return (
      <QueryErrorState
        error={query.error instanceof Error ? query.error : new Error(String(query.error))}
        onRetry={() => query.refetch()}
        title="Could not load the outreach stop-loss status"
        compact
        className="mb-4"
      />
    );
  }

  const s = query.data;
  if (!s) return null;

  const ledgerUnreadable = s.mtdSpendCents == null;

  return (
    <Card className="mb-4" data-testid="outreach-stop-loss-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Outreach stop-loss</CardTitle>
          <Badge variant={s.paused ? "destructive" : "secondary"}>
            {s.paused ? "Paused" : "Running"}
          </Badge>
        </div>
        <CardDescription>
          Monthly mail + data spend line ({s.monthKey}) — crossing it pauses outreach until you look.
          The line is yours to raise from Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Your line</div>
            <div className="text-lg font-semibold tabular-nums">{usd(s.lineCents)}/mo</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Spent this month (mail + data)</div>
            <div className="text-lg font-semibold tabular-nums">
              {ledgerUnreadable ? "Unreadable" : usd(s.mtdSpendCents!)}
            </div>
            {!ledgerUnreadable && s.mailCents != null && s.dataCents != null && (
              <div className="text-xs text-muted-foreground tabular-nums">
                mail {usd(s.mailCents)} · data {usd(s.dataCents)}
              </div>
            )}
          </div>
          {s.effectiveThresholdCents != null && (
            <div>
              <div className="text-xs text-muted-foreground">Pauses at</div>
              <div className="text-lg font-semibold tabular-nums">{usd(s.effectiveThresholdCents)}</div>
            </div>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{s.reason}</p>

        {s.paused && !ledgerUnreadable && (
          <Button
            size="sm"
            onClick={() => resume.mutate()}
            disabled={resume.isPending}
          >
            {resume.isPending ? "Resuming…" : "I've looked — resume this month"}
          </Button>
        )}
        {s.paused && ledgerUnreadable && (
          <p className="text-sm text-muted-foreground">
            Resume is unavailable while the spend ledger is unreadable — resuming would mean spending
            blind. Outreach stays paused until the ledger read recovers.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FounderAdminCostsPage() {
  useDocumentTitle("Costs & economics — AcreOS");
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const initial = TABS.some((t) => t.value === requested) ? requested! : "overview";

  return (
    <PageShell label="Costs & economics">
      <OutreachStopLossCard />
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><CostContent /></TabsContent>
        <TabsContent value="ai-spend"><AiCostsContent /></TabsContent>
        <TabsContent value="optimizer"><CostOptimizerContent /></TabsContent>
        {/* O6 (P5 §5.3) — the infra curve sits ABOVE the per-customer table
            in the same tab: "what is a unit of work costing me over time"
            frames "which customers cost what". A section of an existing hub,
            deliberately not a new founder route. */}
        <TabsContent value="unit-economics">
          <div className="space-y-4">
            <InfraCurvePanel />
            <UnitEconomicsContent />
          </div>
        </TabsContent>
        <TabsContent value="sentry"><ObservabilityCostContent /></TabsContent>
        <TabsContent value="providers"><ProvidersContent /></TabsContent>
        <TabsContent value="data-plane"><DataPlaneContent /></TabsContent>
        <TabsContent value="paid-data"><PaidDataEvalContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
