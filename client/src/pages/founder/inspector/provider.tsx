/**
 * /founder/inspector/provider/:name — per-provider aggregate audit.
 *
 * One screen per external provider (Lob, PostGrid, Twilio, Telnyx,
 * SendGrid, SES, OpenRouter, ElevenLabs, Stripe, Sentry, Fly, Neon).
 * Spend trend, cost per event, alternative pricing, and a best-effort
 * ledger-vs-invoice reconciliation block.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft,
  TrendingUp,
  AlertTriangle,
  Activity,
  ScrollText,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface ProviderAuditResponse {
  provider: string;
  windowDays: number;
  monthly: Array<{ month: string; costCents: number; events: number }>;
  window: {
    costCents: number;
    events: number;
    avgPerEventCents: number;
    minPerEventCents: number;
    maxPerEventCents: number;
  };
  distribution: Array<{ bucket: number; count: number }>;
  topOrgs: Array<{
    organizationId: number | null;
    name: string;
    slug: string | null;
    costCents: number;
    events: number;
  }>;
  alternatives: Array<{ name: string; perEventCents: number }>;
  recommendations: Array<{
    provider: string;
    perEventCents: number;
    savingsPerEventCents: number;
    savingsPct: number;
  }>;
  errorRate: { sample: number; errors: number; pct: number } | null;
  latency: { avgMs: number | null; p50Ms: number | null; p95Ms: number | null } | null;
  reconciliation: {
    ledgerSumCents: number;
    invoiceSumCents: number | null;
    deltaCents: number | null;
    note: string | null;
  };
}

export default function ProviderInspector() {
  const [, params] = useRoute<{ name: string }>("/founder/inspector/provider/:name");
  const name = (params?.name ?? "").toLowerCase();
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);
  useDocumentTitle(`${name} — Provider audit`);

  const { data, isLoading, error } = useQuery<ProviderAuditResponse>({
    queryKey: [`/api/founder/inspector/provider/${name}?days=${windowDays}`],
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <PageShell label="Provider audit">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }
  if (error || !data) {
    return (
      <PageShell label="Provider audit">
        <p className="text-sm text-destructive">
          Failed to load: {error instanceof Error ? error.message : "unknown error"}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell label={`${data.provider} audit`}>
      <div className="space-y-6">
        <header>
          <Link
            href="/founder"
            className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft className="w-3 h-3" aria-hidden /> Back to Now
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mt-1">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight uppercase">
                {data.provider}
              </h1>
              <p className="text-sm text-muted-foreground">
                Last {data.windowDays} days · {fmtUsd(data.window.costCents)} across{" "}
                {data.window.events.toLocaleString()} events ·{" "}
                {fmtCents(data.window.avgPerEventCents)}/event avg
              </p>
            </div>
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setWindowDays(d as 30 | 60 | 90)}
                  aria-label={`Show ${d} day window`}
                  className={
                    "px-3 py-1.5 transition-colors " +
                    (windowDays === d
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted")
                  }
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Monthly spend trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" aria-hidden /> Monthly spend trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.monthly.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No spend yet.</p>
            ) : (
              <div className="w-full h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis
                      tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={((v: number) => fmtUsd(v)) as never}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="costCents"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost-per-event distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost-per-event distribution ({windowDays}d)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.distribution.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No events.</p>
            ) : (
              <div className="w-full h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.distribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fontSize: 10 }}
                      label={{ value: "bucket (¢)", fontSize: 10, position: "insideBottom" }}
                    />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              min {fmtCents(data.window.minPerEventCents)} · max {fmtCents(data.window.maxPerEventCents)} ·
              avg {fmtCents(data.window.avgPerEventCents)}
            </p>
          </CardContent>
        </Card>

        {/* Error rate + SLA */}
        {(data.errorRate !== null || data.latency !== null) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" aria-hidden /> Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {data.errorRate && (
                  <>
                    <Stat
                      label="Sample"
                      value={data.errorRate.sample.toLocaleString()}
                    />
                    <Stat
                      label="Errors"
                      value={data.errorRate.errors.toLocaleString()}
                      tone={data.errorRate.pct >= 1 ? "warning" : "neutral"}
                    />
                    <Stat
                      label="Error rate"
                      value={`${data.errorRate.pct.toFixed(2)}%`}
                      tone={data.errorRate.pct >= 1 ? "warning" : "neutral"}
                    />
                  </>
                )}
                {data.latency && (
                  <Stat label="p95 latency" value={`${data.latency.p95Ms ?? 0}ms`} />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost vs alternative providers</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recommendations.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No cheaper alternatives recorded — {data.provider} is currently the best-priced
                option in its class.
              </p>
            ) : (
              <div className="space-y-1.5 text-sm">
                {data.recommendations.map((r) => (
                  <div
                    key={r.provider}
                    className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-1.5"
                  >
                    <Badge variant="default" className="font-mono">{r.provider}</Badge>
                    <span className="tabular-nums">{fmtCents(r.perEventCents)}/event</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      saves {fmtCents(r.savingsPerEventCents)} per event ({r.savingsPct}%)
                    </span>
                    <Link
                      href={`/founder/inspector/provider/${r.provider}`}
                      className="ml-auto underline text-primary"
                    >
                      Audit {r.provider} →
                    </Link>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground mt-2">
                  Routing rules live at{" "}
                  <Link href="/founder/studio" className="underline">/founder/studio</Link>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top orgs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top orgs by spend</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topOrgs.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No org attribution in this window.</p>
            ) : (
              <>
                {/* Mobile list */}
                <div className="md:hidden space-y-2">
                  {data.topOrgs.map((o) => (
                    <Link
                      key={o.organizationId ?? "platform"}
                      href={
                        o.organizationId
                          ? `/founder/inspector/org/${o.organizationId}`
                          : "/founder"
                      }
                    >
                      <a className="block border border-border rounded p-2 text-sm hover:bg-muted/30">
                        <div className="font-medium truncate">{o.name}</div>
                        <div className="text-xs text-muted-foreground flex justify-between">
                          <span>{o.events.toLocaleString()} events</span>
                          <span className="tabular-nums">{fmtUsd(o.costCents)}</span>
                        </div>
                      </a>
                    </Link>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Org</TableHead>
                        <TableHead className="text-right">Events</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topOrgs.map((o) => (
                        <TableRow key={o.organizationId ?? "platform"}>
                          <TableCell>
                            <div className="font-medium">{o.name}</div>
                            {o.slug && <div className="text-xs text-muted-foreground font-mono">{o.slug}</div>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{o.events.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtUsd(o.costCents)}</TableCell>
                          <TableCell className="text-right">
                            {o.organizationId !== null && (
                              <Link
                                href={`/founder/inspector/org/${o.organizationId}`}
                                className="underline text-primary text-xs"
                              >
                                Cost tab →
                              </Link>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Reconciliation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ScrollText className="w-4 h-4" aria-hidden /> Bill reconciliation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ledger sum</span>
              <span className="font-bold tabular-nums">
                {fmtUsd(data.reconciliation.ledgerSumCents)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider invoice</span>
              <span className="font-bold tabular-nums">
                {data.reconciliation.invoiceSumCents === null
                  ? "—"
                  : fmtUsd(data.reconciliation.invoiceSumCents)}
              </span>
            </div>
            {data.reconciliation.deltaCents !== null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" aria-hidden /> Δ
                </span>
                <span
                  className={
                    Math.abs(data.reconciliation.deltaCents) > 1
                      ? "text-destructive font-bold tabular-nums"
                      : "tabular-nums"
                  }
                >
                  {fmtUsd(data.reconciliation.deltaCents)}
                </span>
              </div>
            )}
            {data.reconciliation.note && (
              <p className="text-xs italic text-muted-foreground">{data.reconciliation.note}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div
        className={
          "font-bold tabular-nums " + (tone === "warning" ? "text-destructive" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(dollars) < 1 ? 4 : 2,
  }).format(dollars);
}

function fmtCents(cents: number): string {
  if (Math.abs(cents) < 1) return `${cents.toFixed(2)}¢`;
  return fmtUsd(cents);
}
