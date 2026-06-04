/**
 * /founder/onboarding-funnel — Phase D2 signup-to-first-value visibility.
 *
 * Reads from /api/founder/onboarding-funnel/* (server/routes-onboarding-funnel.ts).
 *
 *   - Headline TTFV card with green/amber/red vs the 90s Elevate target
 *   - 4 status summary cards (signups / FV rate / p50 / p90)
 *   - Abandonment funnel viz (step 1 → 5 → first value bars)
 *   - Per-org sortable table
 *   - Refresh + 60s auto-refresh
 *
 * Mirrors the founder/dispatches.tsx PageShell + summary-cards + table
 * pattern. Sidebar registration is a Solene follow-up.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Gauge,
  RefreshCw,
  AlertCircle,
  TrendingDown,
  Target,
  Activity,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface FunnelSummary {
  windowDays: number;
  totalSignups: number;
  totalFirstValue: number;
  firstValueRate: number;
  medianTimeToFirstValueSeconds: number | null;
  p50TimeToFirstValueSeconds: number | null;
  p90TimeToFirstValueSeconds: number | null;
  belowNinetySecondThreshold: number;
  abandonmentByStep: Record<string, number>;
}

interface OrgFunnelRow {
  id: number;
  orgId: string;
  measuredDate: string;
  signupAt: string;
  firstValueAt: string | null;
  timeToFirstValueSeconds: number | null;
  firstValueAction: string | null;
  step1CompletedAt: string | null;
  step2CompletedAt: string | null;
  step3CompletedAt: string | null;
  step4CompletedAt: string | null;
  step5CompletedAt: string | null;
  abandonedAtStep: number | null;
  abandonedReason: string | null;
  vertical: string | null;
  updatedAt: string;
}

interface OrgsResponse {
  orgs: OrgFunnelRow[];
  count: number;
}

type SortKey = "time_to_first_value_seconds" | "signup_at";

const TTFV_TARGET_SECONDS = 90;
const REFRESH_INTERVAL_MS = 60_000;

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

function ttfvTone(
  s: number | null | undefined,
): "pos" | "warn" | "neg" | "muted" {
  if (s == null) return "muted";
  if (s <= TTFV_TARGET_SECONDS) return "pos";
  if (s <= TTFV_TARGET_SECONDS * 3) return "warn";
  return "neg";
}

function truncateOrgId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function FounderOnboardingFunnelPage() {
  useDocumentTitle("Onboarding Funnel — AcreOS");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>(
    "time_to_first_value_seconds",
  );

  const summaryQuery = useQuery<FunnelSummary>({
    queryKey: ["/api/founder/onboarding-funnel/summary?windowDays=30"],
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const orgsQuery = useQuery<OrgsResponse>({
    queryKey: [
      `/api/founder/onboarding-funnel/orgs?limit=50&sortBy=${sortKey}&sortDir=asc`,
    ],
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/founder/onboarding-funnel/recompute",
        {},
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Recompute failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: {
      orgsProcessed: number;
      metricsWritten: number;
      errors: number;
    }) => {
      toast({
        title: "Funnel metrics recomputed",
        description: `${data.metricsWritten}/${data.orgsProcessed} orgs · ${data.errors} errors`,
      });
      qc.invalidateQueries({
        queryKey: ["/api/founder/onboarding-funnel/summary?windowDays=30"],
      });
      qc.invalidateQueries({
        queryKey: [
          `/api/founder/onboarding-funnel/orgs?limit=50&sortBy=${sortKey}&sortDir=asc`,
        ],
      });
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const summary = summaryQuery.data;
  const orgs = orgsQuery.data?.orgs ?? [];
  const loading = summaryQuery.isLoading || orgsQuery.isLoading;
  const fetching = summaryQuery.isFetching || orgsQuery.isFetching;
  const errored = summaryQuery.isError || orgsQuery.isError;

  // Abandonment-by-step viz: total signups, then for each step show how many
  // orgs got past it (= completed step ≥ N), down to first-value.
  const funnelBars = useMemo(() => {
    if (!summary) return [];
    const totalSignups = summary.totalSignups;
    // Step completion counts derived from the per-org rows.
    const stepCounts = [1, 2, 3, 4, 5].map((step) => {
      const completed = orgs.filter((o) => {
        const ts = (o as any)[`step${step}CompletedAt`];
        return ts != null;
      }).length;
      return { step, completed };
    });
    const fvCount = orgs.filter(
      (o) => o.timeToFirstValueSeconds != null,
    ).length;
    return [
      { label: "Signups", count: totalSignups, isTotal: true },
      ...stepCounts.map((s) => ({
        label: `Step ${s.step}`,
        count: s.completed,
        isTotal: false,
      })),
      { label: "First Value", count: fvCount, isTotal: false, isGoal: true },
    ];
  }, [summary, orgs]);

  const maxBar = useMemo(
    () => Math.max(1, ...funnelBars.map((b) => b.count)),
    [funnelBars],
  );

  return (
    <PageShell label="Onboarding Funnel">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Gauge className="w-6 h-6 text-primary" aria-hidden="true" />
            Onboarding Funnel
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Signup → first-value instrumentation. The Phase 0-1 Elevate
            target is median TTFV under 90 seconds. Derived from
            lifecycle_events; auto-refreshes every 60 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending}
            data-testid="button-recompute-funnel"
            aria-label="Recompute funnel metrics now"
          >
            <Activity
              className={`w-4 h-4 mr-1 ${
                recomputeMutation.isPending ? "animate-pulse" : ""
              }`}
              aria-hidden="true"
            />
            Recompute
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              summaryQuery.refetch();
              orgsQuery.refetch();
            }}
            disabled={fetching}
            aria-label="Refresh funnel data"
            data-testid="button-refresh-funnel"
          >
            <RefreshCw
              className={`w-4 h-4 mr-1 ${fetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-28" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : errored ? (
        <Card>
          <CardContent className="pt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            Couldn't load onboarding funnel.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                summaryQuery.refetch();
                orgsQuery.refetch();
              }}
              aria-label="Retry loading onboarding funnel"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline TTFV card */}
          <HeadlineTtfvCard summary={summary} />

          {/* 4 summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 mb-6">
            <Card className="p-3" data-testid="card-total-signups">
              <div className="text-xs text-muted-foreground">
                Signups (last {summary?.windowDays ?? 30}d)
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {summary?.totalSignups ?? 0}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-fv-rate">
              <div className="text-xs text-muted-foreground">
                First-value rate
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {summary
                  ? `${(summary.firstValueRate * 100).toFixed(0)}%`
                  : "—"}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-p50-ttfv">
              <div className="text-xs text-muted-foreground">p50 TTFV</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  toneClass(
                    ttfvTone(summary?.p50TimeToFirstValueSeconds ?? null),
                  )
                }`}
              >
                {fmtSeconds(summary?.p50TimeToFirstValueSeconds)}
              </div>
            </Card>
            <Card className="p-3" data-testid="card-p90-ttfv">
              <div className="text-xs text-muted-foreground">p90 TTFV</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  toneClass(
                    ttfvTone(summary?.p90TimeToFirstValueSeconds ?? null),
                  )
                }`}
              >
                {fmtSeconds(summary?.p90TimeToFirstValueSeconds)}
              </div>
            </Card>
          </div>

          {/* Funnel viz */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown
                  className="w-4 h-4 text-muted-foreground"
                  aria-hidden="true"
                />
                Funnel
              </CardTitle>
              <CardDescription>
                Cohort flow from signup through each onboarding step to first
                value.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {funnelBars.map((bar) => {
                  const pct = (bar.count / maxBar) * 100;
                  const rate =
                    summary && summary.totalSignups > 0
                      ? (bar.count / summary.totalSignups) * 100
                      : 0;
                  return (
                    <div
                      key={bar.label}
                      className="flex items-center gap-3"
                      data-testid={`funnel-bar-${bar.label
                        .toLowerCase()
                        .replace(/\s+/g, "-")}`}
                    >
                      <div className="w-24 text-xs text-muted-foreground shrink-0">
                        {bar.label}
                      </div>
                      <div className="flex-1 h-6 bg-muted/40 rounded relative overflow-hidden">
                        <div
                          className={`h-full rounded transition-all ${
                            bar.isGoal
                              ? "bg-acr-pos/70"
                              : bar.isTotal
                                ? "bg-primary/60"
                                : "bg-primary/30"
                          }`}
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={bar.count}
                          aria-valuemin={0}
                          aria-valuemax={maxBar}
                          aria-label={`${bar.label}: ${bar.count} orgs`}
                        />
                      </div>
                      <div className="w-32 text-xs text-right tabular-nums">
                        <span className="font-medium">{bar.count}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          ({rate.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Abandonment summary */}
              {summary &&
                Object.keys(summary.abandonmentByStep).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <div className="text-xs text-muted-foreground mb-2">
                      Abandonment by step
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(summary.abandonmentByStep)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([step, count]) => (
                          <Badge
                            key={step}
                            variant="outline"
                            className="text-micro"
                          >
                            Step {step}: {count} orgs
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Per-org table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-org metrics</CardTitle>
              <CardDescription>
                One row per org (latest snapshot). Sortable by TTFV or
                signup time.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {orgs.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No funnel metrics yet. Click "Recompute" to derive them
                  from lifecycle events.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border bg-muted/30">
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          Org
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          Vertical
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          <button
                            type="button"
                            className="hover:text-foreground transition-colors"
                            onClick={() => setSortKey("signup_at")}
                            aria-label="Sort by signup time"
                            data-testid="sort-signup"
                          >
                            Signup{sortKey === "signup_at" ? " ↑" : ""}
                          </button>
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-medium"
                        >
                          <button
                            type="button"
                            className="hover:text-foreground transition-colors"
                            onClick={() =>
                              setSortKey("time_to_first_value_seconds")
                            }
                            aria-label="Sort by time to first value"
                            data-testid="sort-ttfv"
                          >
                            TTFV
                            {sortKey === "time_to_first_value_seconds"
                              ? " ↑"
                              : ""}
                          </button>
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          First-value action
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgs.map((o) => {
                        const hitFv = o.timeToFirstValueSeconds != null;
                        const abandoned = o.abandonedAtStep != null;
                        return (
                          <tr
                            key={o.id}
                            className="border-b border-border/40"
                            data-testid={`row-org-${o.orgId}`}
                          >
                            <td
                              className="px-3 py-2 font-mono"
                              title={o.orgId}
                            >
                              {truncateOrgId(o.orgId)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {o.vertical ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {fmtRelative(o.signupAt)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums font-medium ${toneClass(
                                ttfvTone(o.timeToFirstValueSeconds),
                              )}`}
                            >
                              {abandoned && !hitFv
                                ? `abandoned @ step ${o.abandonedAtStep}`
                                : fmtSeconds(o.timeToFirstValueSeconds)}
                            </td>
                            <td className="px-3 py-2 font-mono text-caption">
                              {o.firstValueAction ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              {hitFv ? (
                                <Badge
                                  variant="secondary"
                                  className="text-micro inline-flex items-center gap-1"
                                >
                                  <CheckCircle2
                                    className="w-3 h-3"
                                    aria-hidden="true"
                                  />
                                  first value
                                </Badge>
                              ) : abandoned ? (
                                <Badge
                                  variant="destructive"
                                  className="text-micro inline-flex items-center gap-1"
                                >
                                  <XCircle
                                    className="w-3 h-3"
                                    aria-hidden="true"
                                  />
                                  abandoned
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-micro"
                                >
                                  in progress
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground mt-4">
            Showing {orgs.length} orgs (max 50). Auto-refresh every 60
            seconds.
          </p>
        </>
      )}
    </PageShell>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function HeadlineTtfvCard({ summary }: { summary: FunnelSummary | undefined }) {
  const ttfv = summary?.medianTimeToFirstValueSeconds ?? null;
  const tone = ttfvTone(ttfv);
  return (
    <Card data-testid="card-headline-ttfv">
      <CardContent className="pt-6 pb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" aria-hidden="true" />
              Median time-to-first-value
            </div>
            <div
              className={`text-4xl font-semibold tabular-nums ${toneClass(tone)}`}
            >
              {fmtSeconds(ttfv)}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Target: under {TTFV_TARGET_SECONDS}s ·{" "}
              {summary?.belowNinetySecondThreshold ?? 0} of{" "}
              {summary?.totalFirstValue ?? 0} orgs hit it
            </div>
          </div>
          <Badge
            variant={
              tone === "pos"
                ? "secondary"
                : tone === "warn"
                  ? "outline"
                  : tone === "neg"
                    ? "destructive"
                    : "outline"
            }
            className="text-sm"
          >
            {tone === "pos"
              ? "on target"
              : tone === "warn"
                ? "watch"
                : tone === "neg"
                  ? "off target"
                  : "no data"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function toneClass(tone: "pos" | "warn" | "neg" | "muted"): string {
  if (tone === "pos") return "text-acr-pos";
  if (tone === "neg") return "text-acr-neg";
  if (tone === "warn") return "text-amber-500 dark:text-amber-400";
  return "";
}
