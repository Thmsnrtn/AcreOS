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
import { useId, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError, INLINE_ERROR_STATUSES_META } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatRelative } from "@/lib/format";
import { RefreshCw, Radio, ShieldAlert, Activity, HardDrive, ScanSearch, Scale, CheckCircle2 } from "lucide-react";

import { CostContent } from "@/pages/founder/cost";
import { AiCostsContent } from "@/pages/founder/ai-costs";
import { CostOptimizerContent } from "@/pages/founder/cost-optimizer";
import { UnitEconomicsContent } from "@/pages/founder/unit-economics";
import { ObservabilityCostContent } from "@/pages/founder/observability-cost";
import { ProvidersContent } from "@/pages/founder-providers";
import { PaidDataEvalContent } from "@/pages/founder/paid-data-eval";

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

/**
 * The Data plane tab: the six health checks, then the county licence review
 * (W10.3) — a deep panel inside this existing instrument, no route of its own.
 * The review renders whatever state the checks are in: it reads its own
 * endpoint and must not vanish because the health snapshot failed.
 */
export function DataPlaneContent() {
  return (
    <>
      <DataPlaneChecks />
      <CountyLicenceReviewSection />
    </>
  );
}

function DataPlaneChecks() {
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

// ─── County licence review (W10.3 audit fix 3) ───────────────────────────────
// Every county_gis_endpoints row defaults to redistributable='review-required',
// which makes its county VIEW-ONLY in the customer list builder: counted and
// previewed, never saved into an org's leads. Saving is a founder licensing
// decision (Beatrice rule, shared/schema/parcel-data.ts) — this is where it is
// made, one source at a time, with the reason on the record. Nothing here
// decides a posture; it records the founder's.
//
// THE WHOLE EFFECT of 'yes' / 'attribution' on an ACTIVE per-county row is two
// things, and the copy says both: the list builder lets customers save that
// county's records into their own CRMs, AND public parcel report pages persist
// and publish the county's assessor attributes (server/services/
// publicParcelReport.ts countyRedistribution). Both read only active rows, and
// neither reads a statewide ('*') row — so a decision there changes nothing
// until a matching per-county source is active.

export const COUNTY_ENDPOINTS_REVIEW_URL = "/api/founder/county-endpoints?status=review-required";
const COUNTY_ENDPOINTS_REVIEW_KEY = [COUNTY_ENDPOINTS_REVIEW_URL];
const LICENCE_NOTE_MIN = 10;
const LICENCE_NOTE_MAX = 1000;

type LicencePosture = "yes" | "attribution" | "no" | "review-required";

const LICENCE_ATTRIBUTION_MAX = 500;

const LICENCE_POSTURES: ReadonlyArray<{ value: LicencePosture; label: string; effect: string }> = [
  {
    value: "yes",
    label: "Redistributable",
    effect: "customers can save this county's records into their own CRMs, and public parcel report pages publish its assessor attributes",
  },
  {
    value: "attribution",
    label: "Redistributable with attribution",
    effect: "the same — saved into customers' CRMs and published in public parcel reports — with the credit line below shown",
  },
  { value: "no", label: "No redistribution", effect: "count and preview only; never saved into a CRM or published in a public parcel report" },
  { value: "review-required", label: "Still under review", effect: "count and preview only, note recorded" },
];

interface CountyEndpointForReview {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  redistributable: string;
  /** The credit line on record for this source, if any. */
  attribution?: string | null;
  isActive: boolean;
}

interface CountyEndpointsReviewResponse {
  endpoints: CountyEndpointForReview[];
  total: number;
}

function CountyLicenceRow({ endpoint }: { endpoint: CountyEndpointForReview }) {
  const qc = useQueryClient();
  const baseId = useId();
  const noteId = `${baseId}-note`;
  const attributionId = `${baseId}-attribution`;
  const [posture, setPosture] = useState<LicencePosture | "">("");
  const [note, setNote] = useState("");
  const [attribution, setAttribution] = useState(endpoint.attribution ?? "");
  const trimmed = note.trim();
  const noteOk = trimmed.length >= LICENCE_NOTE_MIN && trimmed.length <= LICENCE_NOTE_MAX;
  const attributionLine = attribution.trim();
  // 'attribution' is reuse ONLY with a credit line — the server refuses it without one.
  const attributionOk = posture !== "attribution" || attributionLine.length > 0;

  const record = useMutation<
    { id: number; redistributable: string },
    unknown,
    { redistributable: LicencePosture; note: string; attribution?: string }
  >({
    // Refusals are shown on this row in the server's words, not as a toast.
    meta: { [INLINE_ERROR_STATUSES_META]: [400, 422] },
    mutationFn: async (body) => {
      const res = await apiRequest("PATCH", `/api/founder/county-endpoints/${endpoint.id}/licence`, body);
      return (await res.json()) as { id: number; redistributable: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: COUNTY_ENDPOINTS_REVIEW_KEY });
    },
  });

  const errorMessage =
    record.error instanceof ApiError
      ? (record.error.body?.message ?? record.error.message)
      : record.error instanceof Error
        ? record.error.message
        : null;

  return (
    <li className="space-y-3 rounded-card border p-3" data-testid={`licence-row-${endpoint.id}`}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {endpoint.county}, {endpoint.state}
          </span>
          <Badge variant="secondary">{LICENSE_CLASSIFICATION_LABEL[endpoint.redistributable] ?? endpoint.redistributable}</Badge>
          <Badge variant="outline">{endpoint.isActive ? "Active" : "Inactive"}</Badge>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{endpoint.baseUrl}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Licence decision</legend>
        <RadioGroup value={posture} onValueChange={(v) => setPosture(v as LicencePosture)} className="gap-1.5">
          {LICENCE_POSTURES.map((p) => {
            const id = `${baseId}-${p.value}`;
            return (
              <div key={p.value} className="flex min-h-11 items-center gap-2 pointer-fine:sm:min-h-8">
                <RadioGroupItem id={id} value={p.value} data-testid={`licence-${endpoint.id}-option-${p.value}`} />
                <Label htmlFor={id} className="text-sm font-normal">
                  {p.label} <span className="text-muted-foreground">— {p.effect}</span>
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </fieldset>

      {posture === "attribution" && (
        <div className="space-y-1.5">
          <Label htmlFor={attributionId} className="text-xs font-medium">
            Attribution line (the credit customers and public reports must show)
          </Label>
          <Input
            id={attributionId}
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            maxLength={LICENCE_ATTRIBUTION_MAX}
            placeholder="e.g. Parcel data: Coconino County Assessor"
            data-testid={`licence-${endpoint.id}-attribution`}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={noteId} className="text-xs font-medium">
          Review note (why — at least {LICENCE_NOTE_MIN} characters)
        </Label>
        <Textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LICENCE_NOTE_MAX}
          rows={2}
          placeholder="e.g. Terms of use §4 permit commercial reuse with a credit line."
          data-testid={`licence-${endpoint.id}-note`}
        />
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!posture || !noteOk || !attributionOk || record.isPending}
        onClick={() =>
          posture &&
          record.mutate({
            redistributable: posture,
            note: trimmed,
            ...(posture === "attribution" && attributionLine ? { attribution: attributionLine } : {}),
          })
        }
        className="min-h-11 pointer-fine:sm:min-h-9"
        data-testid={`licence-${endpoint.id}-save`}
      >
        {record.isPending ? "Recording…" : "Record decision"}
      </Button>

      {record.isError && (
        <Alert variant="destructive" data-testid={`licence-${endpoint.id}-error`}>
          <AlertDescription>{errorMessage ?? "The decision wasn't recorded."}</AlertDescription>
        </Alert>
      )}
      {record.isSuccess && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status" data-testid={`licence-${endpoint.id}-recorded`}>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Recorded as {LICENSE_CLASSIFICATION_LABEL[record.data.redistributable] ?? record.data.redistributable}.
        </p>
      )}
    </li>
  );
}

export function CountyLicenceReviewSection() {
  const query = useQuery<CountyEndpointsReviewResponse>({
    queryKey: COUNTY_ENDPOINTS_REVIEW_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", COUNTY_ENDPOINTS_REVIEW_URL);
      return (await res.json()) as CountyEndpointsReviewResponse;
    },
    staleTime: 30_000,
  });

  return (
    <Card className="mt-4" data-testid="county-licence-review">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          County licence review
        </CardTitle>
        <CardDescription data-testid="licence-review-effect">
          County sources awaiting your licence decision. Until one is marked redistributable, customers can count and
          preview that county's parcels in the list builder but can't save them. Marking a source redistributable does
          two things: customers can save its records into their own CRMs, and public parcel report pages persist and
          publish its assessor attributes. Both read only active per-county sources — a decision on an inactive source
          takes effect only once it is active, and a statewide (*) source is used by neither.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2" data-testid="licence-review-loading" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <QueryErrorState
            compact
            error={query.error instanceof Error ? query.error : null}
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            title="Couldn't load sources awaiting review"
            description="Nothing is assumed about their licences — the review list just couldn't be read."
            testId="licence-review-error"
          />
        ) : query.data.endpoints.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            headline="Nothing awaiting review"
            subtitle="Every county source has a licence decision on record."
            cta={{ label: "Check again", onClick: () => void query.refetch(), "data-testid": "button-licence-review-refresh" }}
            testId="licence-review-empty"
          />
        ) : (
          <div className="space-y-2">
            <ul className="space-y-3">
              {query.data.endpoints.map((e) => (
                <CountyLicenceRow key={e.id} endpoint={e} />
              ))}
            </ul>
            {query.data.total > query.data.endpoints.length && (
              <p className="text-xs text-muted-foreground" data-testid="licence-review-bounded">
                Showing the newest {query.data.endpoints.length} of {query.data.total} awaiting review.
              </p>
            )}
          </div>
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
        <TabsContent value="unit-economics"><UnitEconomicsContent /></TabsContent>
        <TabsContent value="sentry"><ObservabilityCostContent /></TabsContent>
        <TabsContent value="providers"><ProvidersContent /></TabsContent>
        <TabsContent value="data-plane"><DataPlaneContent /></TabsContent>
        <TabsContent value="paid-data"><PaidDataEvalContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
