/**
 * /founder/ai-costs — AI cost observability dashboard.
 *
 * Phase 3 Week 9.
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at the
 * API layer (GET /api/founder/ai-costs returns 403 to non-founder orgs).
 *
 * Surfaces four cards rolled up from ai_usage_daily + ai_telemetry_events:
 *   1. Today's usage by org (top 10) with a 7-day sparkline per org
 *   2. Cost by feature (taskType) over the last 7 days
 *   3. Top 20 most expensive single calls in the last 24 hours
 *   4. Per-model cost distribution over the last 7 days
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
import { DollarSign, Activity, BarChart3, Layers, Sparkles } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SparklinePoint {
  date: string;
  usd: number;
}

interface OrgUsage {
  organizationId: number;
  organizationName: string;
  usedUsdToday: number;
  capUsd: number;
  callCount: number;
  sparkline: SparklinePoint[];
}

interface FeatureUsage {
  taskType: string;
  usd: number;
  calls: number;
}

interface TopCall {
  id: number;
  organizationId: number | null;
  taskType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  latencyMs: number;
  complexity: string;
  createdAt: string;
}

interface ModelUsage {
  model: string;
  usd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

interface CostsResponse {
  totals: {
    usdToday: number;
    callsToday: number;
    orgsActiveToday: number;
  };
  todayByOrg: OrgUsage[];
  byFeature: FeatureUsage[];
  topCalls: TopCall[];
  byModel: ModelUsage[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(n: number, digits = 2): string {
  return `$${(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Tiny inline SVG sparkline ──────────────────────────────────────────────

function Sparkline({ points }: { points: SparklinePoint[] }) {
  if (!points.length) {
    return <span className="text-xs text-muted-foreground">no data</span>;
  }
  const w = 80;
  const h = 24;
  const max = Math.max(...points.map((p) => p.usd), 0.0001);
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (p.usd / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} aria-label="7-day spend sparkline" role="img">
      <path d={path} stroke="currentColor" strokeWidth={1.5} fill="none" />
    </svg>
  );
}

// ─── Stacked-bar for cost-by-feature ────────────────────────────────────────

function StackedFeatureBar({ items }: { items: FeatureUsage[] }) {
  const total = items.reduce((acc, it) => acc + it.usd, 0);
  if (total <= 0) {
    return <p className="text-sm text-muted-foreground">No AI spend in the last 7 days.</p>;
  }
  const palette = [
    "bg-acr-accent",
    "bg-acr-pos",
    "bg-acr-warn",
    "bg-acr-brand",
    "bg-acr-neg",
    "bg-acr-accent",
    "bg-acr-warn",
    "bg-lime-500",
  ];
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border" role="img" aria-label="Cost by feature stacked bar">
        {items.map((it, idx) => {
          const pct = (it.usd / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={it.taskType}
              className={palette[idx % palette.length]}
              style={{ width: `${pct}%` }}
              title={`${it.taskType}: ${fmtUsd(it.usd, 4)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {items.slice(0, 8).map((it, idx) => (
          <li key={it.taskType} className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-sm ${palette[idx % palette.length]}`} aria-hidden="true" />
            <span className="font-mono text-xs">{it.taskType}</span>
            <span className="ml-auto tabular-nums">{fmtUsd(it.usd, 4)}</span>
            <span className="text-xs text-muted-foreground">({it.calls} calls)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function AiCostsContent() {
  useDocumentTitle("AI costs");
  const { data, isLoading, isError, error } = useQuery<CostsResponse>({
    queryKey: ["/api/founder/ai-costs"],
    refetchInterval: 60_000,
  });

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI cost observability</h1>
          <p className="text-sm text-muted-foreground">
            Per-org daily spend caps + cost-by-feature + top expensive prompts.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Phase 3 W9
        </Badge>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load AI cost data: {(error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {/* Totals strip */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryTile
          icon={<DollarSign className="h-4 w-4" />}
          label="Total spend today"
          value={isLoading ? null : fmtUsd(data?.totals.usdToday ?? 0, 4)}
        />
        <SummaryTile
          icon={<Activity className="h-4 w-4" />}
          label="AI calls today"
          value={isLoading ? null : (data?.totals.callsToday ?? 0).toLocaleString()}
        />
        <SummaryTile
          icon={<Layers className="h-4 w-4" />}
          label="Orgs active today"
          value={isLoading ? null : (data?.totals.orgsActiveToday ?? 0).toLocaleString()}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Card 1 — Today's usage by org (top 10) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Today by org (top 10)
            </CardTitle>
            <CardDescription>UTC day. Sparkline = trailing 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <SkeletonRows />
            ) : !data?.todayByOrg.length ? (
              <p className="text-sm text-muted-foreground">No AI spend today.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">% of cap</TableHead>
                    <TableHead className="text-right">7-day</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.todayByOrg.map((o) => {
                    const pct = o.capUsd > 0 ? (o.usedUsdToday / o.capUsd) * 100 : 0;
                    const danger = pct >= 80;
                    return (
                      <TableRow key={o.organizationId}>
                        <TableCell className="font-medium">{o.organizationName}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(o.usedUsdToday, 4)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${danger ? "text-destructive" : ""}`}>
                          {o.capUsd > 0 ? `${pct.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          <Sparkline points={o.sparkline} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Cost by feature */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Cost by feature (7d)
            </CardTitle>
            <CardDescription>Pax / lead-summary / draft-reply / etc.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <StackedFeatureBar items={data?.byFeature ?? []} />
            )}
          </CardContent>
        </Card>

        {/* Card 3 — Top expensive prompts */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Top 20 expensive calls (24h)
            </CardTitle>
            <CardDescription>Sorted by single-call USD cost.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <SkeletonRows />
            ) : !data?.topCalls.length ? (
              <p className="text-sm text-muted-foreground">No AI calls in the last 24 hours.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Org</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topCalls.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.taskType}</TableCell>
                      <TableCell className="font-mono text-xs">{c.model}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.organizationId ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtTokens(c.promptTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtTokens(c.completionTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(c.usd, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{c.latencyMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Card 4 — Per-model cost distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" /> Per-model cost (7d)
            </CardTitle>
            <CardDescription>Distribution of spend across the model fleet.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <SkeletonRows />
            ) : !data?.byModel.length ? (
              <p className="text-sm text-muted-foreground">No AI spend in the last 7 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byModel.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-mono text-xs">{m.model}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(m.usd, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.calls.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtTokens(m.promptTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtTokens(m.completionTokens)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function FounderAiCostsPage() {
  return (
    <PageShell label="AI cost observability">
      <AiCostsContent />
    </PageShell>
  );
}

// ─── Local helper components ────────────────────────────────────────────────

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums">
            {value ?? <Skeleton className="h-5 w-20" />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
