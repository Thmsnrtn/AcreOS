/**
 * /founder/telemetry — in-process API telemetry readout (FW-9).
 *
 * Per-route 2xx/4xx/5xx counts + p50/p95 latency. Backstop for early
 * warning; persistent telemetry belongs in an APM.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, RefreshCw, RotateCcw, AlertTriangle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { formatDateTime } from "@/lib/format";

interface RouteSummary {
  route: string;
  totalCount: number;
  count2xx: number;
  count4xx: number;
  count5xx: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface TelemetryResponse {
  routes: RouteSummary[];
  totals: { totalCount: number; total2xx: number; total4xx: number; total5xx: number; errorRate: number };
  generatedAt: string;
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export function TelemetryContent() {
  useDocumentTitle("API telemetry — AcreOS");
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<TelemetryResponse>({
    queryKey: ["/api/admin/telemetry"],
    refetchInterval: 30_000,
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/telemetry/reset", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Telemetry reset" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/telemetry"] });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" aria-hidden="true" />
            API telemetry
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            In-process per-route counts since last process restart. Auto-refreshes
            every 30 seconds. Resets on deploy by design — persistent telemetry
            belongs in an APM (Datadog / Honeycomb).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}>
            <RotateCcw className="w-4 h-4 mr-1" aria-hidden="true" /> Reset counters
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="space-y-6"
          data-testid="skeleton-telemetry"
        >
          <span className="sr-only">Loading API telemetry</span>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-3 space-y-2">
                <Skeleton announce={false} className="h-3 w-20" />
                <Skeleton announce={false} className="h-8 w-16" />
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <Skeleton announce={false} className="h-5 w-40" />
              <Skeleton announce={false} className="h-4 w-72" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 pb-3 border-b">
                <Skeleton announce={false} className="h-3 w-40" />
                <Skeleton announce={false} className="h-3 w-12 ml-auto" />
                <Skeleton announce={false} className="h-3 w-12" />
                <Skeleton announce={false} className="h-3 w-12" />
              </div>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 py-2.5">
                  <Skeleton announce={false} className="h-3 w-56" />
                  <Skeleton announce={false} className="h-3 w-10 ml-auto" />
                  <Skeleton announce={false} className="h-3 w-10" />
                  <Skeleton announce={false} className="h-3 w-10" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : error ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load API telemetry"
          testId="error-telemetry"
        />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Total requests</div>
              <div className="text-2xl font-semibold">{data.totals.totalCount.toLocaleString()}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">2xx</div>
              <div className="text-2xl font-semibold text-acr-pos">{data.totals.total2xx.toLocaleString()}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">4xx</div>
              <div className="text-2xl font-semibold text-acr-warning">{data.totals.total4xx.toLocaleString()}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">5xx</div>
              <div className={`text-2xl font-semibold ${data.totals.total5xx > 0 ? "text-acr-neg" : ""}`}>
                {data.totals.total5xx.toLocaleString()}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Error rate</div>
              <div className={`text-2xl font-semibold ${data.totals.errorRate >= 0.05 ? "text-acr-warning" : ""}`}>
                {(data.totals.errorRate * 100).toFixed(2)}%
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-route summary</CardTitle>
              <CardDescription>Sorted by request count. p95 over the last 100 requests per route.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {data.routes.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  headline="No traffic yet"
                  subtitle="Per-route counts appear as soon as the API serves its first request after this process started."
                  actionIcon={RefreshCw}
                  cta={{
                    label: "Refresh",
                    onClick: () => refetch(),
                    "data-testid": "empty-state-telemetry-refresh",
                  }}
                  testId="empty-state-telemetry"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border bg-muted/30">
                        <th className="px-3 py-2 text-left font-medium">Route</th>
                        <th className="px-3 py-2 text-right font-medium">Count</th>
                        <th className="px-3 py-2 text-right font-medium">2xx</th>
                        <th className="px-3 py-2 text-right font-medium">4xx</th>
                        <th className="px-3 py-2 text-right font-medium">5xx</th>
                        <th className="px-3 py-2 text-right font-medium">Errors</th>
                        <th className="px-3 py-2 text-right font-medium">avg ms</th>
                        <th className="px-3 py-2 text-right font-medium">p50</th>
                        <th className="px-3 py-2 text-right font-medium">p95</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.routes.map((r) => {
                        const hot = r.errorRate >= 0.05 || r.count5xx > 0 || r.p95Ms > 2000;
                        return (
                          <tr key={r.route} className={`border-b border-border/40 ${hot ? "bg-acr-warn-soft/20" : ""}`}>
                            <td className="px-3 py-1.5 font-mono text-caption">
                              {hot && <AlertTriangle className="w-3 h-3 inline mr-1 text-acr-warning" aria-hidden="true" />}
                              {r.route}
                            </td>
                            <td className="px-3 py-1.5 text-right">{r.totalCount.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right text-acr-pos">{r.count2xx.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right text-acr-warning">{r.count4xx.toLocaleString()}</td>
                            <td className={`px-3 py-1.5 text-right ${r.count5xx > 0 ? "text-acr-neg font-semibold" : ""}`}>{r.count5xx.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right">
                              <Badge variant={r.errorRate >= 0.05 ? "destructive" : r.errorRate > 0 ? "outline" : "secondary"} className="text-micro">
                                {(r.errorRate * 100).toFixed(1)}%
                              </Badge>
                            </td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{r.avgMs}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{r.p50Ms}</td>
                            <td className={`px-3 py-1.5 text-right ${r.p95Ms > 2000 ? "text-acr-warning" : "text-muted-foreground"}`}>{r.p95Ms}</td>
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
            Generated at {formatDateTime(data.generatedAt)}.
          </p>
        </>
      ) : null}
    </>
  );
}

export default function FounderTelemetryPage() {
  return (
    <PageShell label="API telemetry">
      <TelemetryContent />
    </PageShell>
  );
}
