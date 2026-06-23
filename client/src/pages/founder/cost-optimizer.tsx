/**
 * /founder/cost-optimizer — Self-Tuning Cost Optimiser dashboard.
 *
 * Wave 8.
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at the
 * API layer (GET /api/founder/cost-optimizer/runs returns 403 to non-founder
 * users).
 *
 * Surfaces the last 30 nightly runs of server/jobs/costOptimizer. Each run
 * shows:
 *   - The hard numbers (AI cost, Fly cost, customers, MRR, profit margin)
 *   - The optimiser's plain-English summary paragraph
 *   - The list of recommendations (severity-tagged) with an
 *     "Apply this recommendation" button next to manual-review items
 *   - The list of auto-applied actions (audit trail)
 *
 * "Run now" button at the top fires POST /api/founder/cost-optimizer/run-now
 * for an out-of-band snapshot rather than waiting for the nightly cycle.
 */

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDateTime } from "@/lib/format";

// ─── Types (mirror server/jobs/costOptimizer.ts) ────────────────────────────

interface Recommendation {
  id: string;
  category:
    | "ai_tier"
    | "ai_quota"
    | "abuse_review"
    | "sentry_sampling"
    | "margin_alert"
    | "general";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  estimatedSavingsUsd?: number;
  autoApplied: boolean;
  appliedAt?: string;
  appliedBy?: string;
  metadata?: Record<string, any>;
}

interface AutoAppliedAction {
  id: string;
  kind: "prompt_cache_toggle" | "log_volume_tune" | "sampling_drop" | "other";
  description: string;
  appliedAt: string;
  metadata?: Record<string, any>;
}

interface OptimizerRun {
  id: number;
  runAt: string;
  totalAiCostUsd: number;
  totalFlyCostUsd: number;
  customerCount: number;
  mrrUsd: number;
  profitMarginPct: number;
  recommendations: Recommendation[];
  autoAppliedActions: AutoAppliedAction[];
  summary: string;
}

interface RunsResponse {
  runs: OptimizerRun[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(n: number, digits = 2): string {
  return `$${(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function severityBadge(severity: Recommendation["severity"]) {
  if (severity === "critical") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
        Critical
      </Badge>
    );
  }
  if (severity === "warning") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Warning
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      Info
    </Badge>
  );
}

function marginColor(pct: number): string {
  if (pct < 20) return "text-destructive";
  if (pct < 40) return "text-amber-600";
  return "text-emerald-600";
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function CostOptimizerContent() {
  useDocumentTitle("Cost optimizer");
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<RunsResponse>({
    queryKey: ["/api/founder/cost-optimizer/runs"],
    refetchInterval: 5 * 60_000, // refresh every 5 minutes
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/cost-optimizer/run-now", {});
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Optimiser run complete",
        description: `${result.recommendationsCount} recommendations · ${result.autoAppliedCount} auto-applied · margin ${Number(result.profitMarginPct ?? 0).toFixed(1)}%`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/cost-optimizer/runs"] });
    },
    onError: (err: any) => {
      toast({
        title: "Optimiser run failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const applyRec = useMutation({
    mutationFn: async (vars: { runId: number; recommendationId: string }) => {
      const res = await apiRequest("POST", "/api/founder/cost-optimizer/apply", vars);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Recommendation applied" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/cost-optimizer/runs"] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not apply recommendation",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const runs = data?.runs ?? [];
  const latest = runs[0];

  const totals = useMemo(() => {
    if (!latest) return null;
    const open = latest.recommendations.filter((r) => !r.autoApplied);
    const savings = open.reduce((s, r) => s + (r.estimatedSavingsUsd ?? 0), 0);
    return {
      openCount: open.length,
      appliedCount: latest.recommendations.length - open.length,
      autoCount: latest.autoAppliedActions.length,
      savings,
    };
  }, [latest]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Self-tuning cost optimiser</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Nightly meta-job that analyses platform spend, auto-applies safe
            optimisations, and surfaces the rest for founder review. Last 30
            runs shown below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Activity className="h-3 w-3" aria-hidden="true" /> Wave 8
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            aria-label="Run optimiser now"
          >
            <RefreshCw className={`mr-2 h-3 w-3 ${runNow.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {runNow.isPending ? "Running…" : "Run now"}
          </Button>
        </div>
      </div>

      {isError ? (
        <Card className="mb-4">
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load optimiser runs: {(error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {/* Latest summary tiles */}
      {isLoading ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : latest ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              label="MRR"
              value={fmtUsd(latest.mrrUsd)}
              hint={`${latest.customerCount} customers`}
            />
            <SummaryTile
              label="AI cost (30d)"
              value={fmtUsd(latest.totalAiCostUsd)}
              hint={`Fly est ${fmtUsd(latest.totalFlyCostUsd)}`}
            />
            <SummaryTile
              label="Profit margin"
              value={`${latest.profitMarginPct.toFixed(1)}%`}
              valueClassName={marginColor(latest.profitMarginPct)}
              hint={latest.profitMarginPct < 20 ? "Below 20% floor" : "Healthy"}
            />
            <SummaryTile
              label="Recommendations"
              value={`${totals?.openCount ?? 0} open`}
              hint={
                totals
                  ? `${totals.appliedCount} applied · ${totals.autoCount} auto-actions`
                  : ""
              }
            />
          </div>

          {totals && totals.savings > 0 ? (
            <Card className="mb-6 border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30">
              <CardContent className="flex items-center gap-3 p-4 text-sm">
                <TrendingUp className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                <div>
                  <strong>Estimated savings if all open recommendations are applied: {fmtUsd(totals.savings)}/mo.</strong>
                  <span className="ml-2 text-muted-foreground">
                    Click "Apply this recommendation" on each item to ship it.
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card className="mb-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No optimiser runs yet — the first nightly run will land within 24
            hours, or click "Run now" above to trigger one immediately.
          </CardContent>
        </Card>
      )}

      {/* Run history */}
      <h2 className="mb-3 text-lg font-medium">Recent runs</h2>
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No runs to display.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      Run #{run.id} <span className="text-sm font-normal text-muted-foreground">· {formatDateTime(run.runAt)}</span>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {fmtUsd(run.mrrUsd)} MRR · {fmtUsd(run.totalAiCostUsd)} AI · {fmtUsd(run.totalFlyCostUsd)} Fly est ·
                      <span className={`ml-1 font-medium ${marginColor(run.profitMarginPct)}`}>
                        {run.profitMarginPct.toFixed(1)}% margin
                      </span>
                    </CardDescription>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {run.recommendations.length} rec{run.recommendations.length === 1 ? "" : "s"} ·{" "}
                    {run.autoAppliedActions.length} auto-action{run.autoAppliedActions.length === 1 ? "" : "s"}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {run.summary ? (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">{run.summary}</p>
                ) : null}

                {run.recommendations.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Recommendations</h3>
                    <ul className="space-y-2">
                      {run.recommendations.map((rec) => (
                        <li
                          key={rec.id}
                          className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-start"
                        >
                          <div className="flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              {severityBadge(rec.severity)}
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                {rec.category.replace(/_/g, " ")}
                              </span>
                              {rec.estimatedSavingsUsd ? (
                                <span className="text-xs text-emerald-600">
                                  est savings {fmtUsd(rec.estimatedSavingsUsd)}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-sm font-medium">{rec.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{rec.detail}</div>
                            {rec.autoApplied ? (
                              <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                Applied
                                {rec.appliedAt ? ` ${formatDateTime(rec.appliedAt)}` : ""}
                                {rec.appliedBy ? ` by ${rec.appliedBy}` : ""}
                              </div>
                            ) : null}
                          </div>
                          {!rec.autoApplied ? (
                            <div className="shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={applyRec.isPending}
                                onClick={() =>
                                  applyRec.mutate({
                                    runId: run.id,
                                    recommendationId: rec.id,
                                  })
                                }
                                aria-label={`Apply recommendation: ${rec.title}`}
                              >
                                Apply this recommendation
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recommendations this run.</p>
                )}

                {run.autoAppliedActions.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Auto-applied actions</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {run.autoAppliedActions.map((a) => (
                        <li key={a.id}>
                          <span className="font-mono text-xs">{a.kind}</span> · {a.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function FounderCostOptimizerPage() {
  return (
    <PageShell label="Cost optimiser">
      <CostOptimizerContent />
    </PageShell>
  );
}

// ─── Tiny tile ──────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
