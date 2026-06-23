/**
 * /founder/observability-cost — Sentry / observability cost dashboard.
 *
 * Sentry cost tuning (May 2026 follow-up to Wave 6 hygiene work).
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at
 * the API layer (GET /api/founder/observability-cost returns 403 for
 * non-founder orgs).
 *
 * Surfaces:
 *   1. Current sampling rates (env-driven, tunable without redeploy)
 *   2. Projected monthly volume at the current customer count
 *   3. Same projection at 100 customers (founder's planning bar)
 *   4. Recommended sampling rates if any category is over the free-tier ceiling
 */

import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Gauge } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface Rates {
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  profilesSampleRate: number;
}

interface Projection {
  customers: number;
  rates: Rates;
  monthly: { errors: number; performanceUnits: number; replays: number };
  freeTier: { errors: number; performanceUnits: number; replays: number };
  withinFreeTier: boolean;
  recommendation: string;
}

interface ObservabilityCostResponse {
  source: "live+projection" | "projection";
  live: { errors: number; performanceUnits: number; replays: number } | null;
  current: Projection;
  at100Customers: Projection;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtRate(r: number): string {
  if (r === 0) return "0%";
  return `${(r * 100).toFixed(2)}%`;
}

function StatusBadge({ within }: { within: boolean }) {
  return within ? (
    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Within free tier
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Over free tier
    </Badge>
  );
}

function ProjectionCard({
  title,
  description,
  projection,
}: {
  title: string;
  description: string;
  projection: Projection;
}) {
  const rows: Array<{
    label: string;
    value: number;
    ceiling: number;
    over: boolean;
  }> = [
    {
      label: "Errors / mo",
      value: projection.monthly.errors,
      ceiling: projection.freeTier.errors,
      over: projection.monthly.errors > projection.freeTier.errors,
    },
    {
      label: "Performance units / mo",
      value: projection.monthly.performanceUnits,
      ceiling: projection.freeTier.performanceUnits,
      over: projection.monthly.performanceUnits > projection.freeTier.performanceUnits,
    },
    {
      label: "Replays / mo",
      value: projection.monthly.replays,
      ceiling: projection.freeTier.replays,
      over: projection.monthly.replays > projection.freeTier.replays,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{title}</span>
          <StatusBadge within={projection.withinFreeTier} />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Projected</TableHead>
              <TableHead className="text-right">Free tier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell
                  className={`text-right font-mono ${row.over ? "text-amber-600 dark:text-amber-400" : ""}`}
                >
                  {fmtNum(row.value)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {fmtNum(row.ceiling)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!projection.withinFreeTier ? (
          <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>Recommendation:</strong> {projection.recommendation}
          </p>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">{projection.recommendation}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RatesCard({ rates }: { rates: Rates }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          Current sampling rates
        </CardTitle>
        <CardDescription>
          Driven by VITE_SENTRY_* env vars — re-tune without redeploy via Fly secrets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Setting</TableHead>
              <TableHead>Env var</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Traces</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                VITE_SENTRY_TRACES_RATE
              </TableCell>
              <TableCell className="text-right font-mono">{fmtRate(rates.tracesSampleRate)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Replay (session)</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                VITE_SENTRY_REPLAY_SESSION_RATE
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmtRate(rates.replaysSessionSampleRate)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Replay (on error)</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                VITE_SENTRY_REPLAY_ON_ERROR_RATE
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmtRate(rates.replaysOnErrorSampleRate)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Profiles</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                VITE_SENTRY_PROFILES_RATE
              </TableCell>
              <TableCell className="text-right font-mono">{fmtRate(rates.profilesSampleRate)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function ObservabilityCostContent() {
  useDocumentTitle("Observability cost");
  const { data, isLoading, isError, error } = useQuery<ObservabilityCostResponse>({
    queryKey: ["/api/founder/observability-cost"],
    refetchInterval: 5 * 60_000,
  });

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Observability cost</h1>
          <p className="text-sm text-muted-foreground">
            Sentry sampling rates + projected monthly volume vs free-tier ceiling.
          </p>
        </div>
        {data?.source === "live+projection" ? (
          <Badge variant="outline">Live stats</Badge>
        ) : (
          <Badge variant="outline">Projection only</Badge>
        )}
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load observability cost data: {(error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {data.live ? (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Live Sentry usage (last 30 days)</CardTitle>
                <CardDescription>From Sentry stats API.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Errors</div>
                    <div className="text-2xl font-semibold">{fmtNum(data.live.errors)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Performance units</div>
                    <div className="text-2xl font-semibold">
                      {fmtNum(data.live.performanceUnits)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Replays</div>
                    <div className="text-2xl font-semibold">{fmtNum(data.live.replays)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RatesCard rates={data.current.rates} />
            <ProjectionCard
              title={`Projection — ${data.current.customers} active customers`}
              description="Based on current customer count and sampling rates."
              projection={data.current}
            />
            <ProjectionCard
              title="Projection — 100 customers"
              description="Founder planning bar. Confirms we stay under free tier at 100x current."
              projection={data.at100Customers}
            />
          </div>
        </>
      )}
    </>
  );
}

export default function FounderObservabilityCostPage() {
  return (
    <PageShell label="Observability cost">
      <ObservabilityCostContent />
    </PageShell>
  );
}
