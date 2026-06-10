/**
 * /founder/cost — Consolidated cost screen.
 *
 * The single place Tom needs to check costs during his daily 15-minute review.
 * Calm. No chrome. Every number contextualized.
 *
 * Layout (top → bottom):
 *   1. Header strip: this-month AI spend / infra cost projection / margin
 *   2. 30-day AI spend sparkline (inline SVG — no charting library)
 *   3. Vendor lines (top 3 by spend)
 *   4. Per-org AI cost table (top 5)
 *   5. Last cost-optimizer run summary + link to /founder/cost-optimizer
 *
 * Data source: GET /api/founder/cost-summary (routes-founder-cost.ts)
 * Related deep-tool pages (linked, not duplicated here):
 *   /founder/ai-costs          — full per-call AI telemetry
 *   /founder/cost-optimizer    — nightly optimizer runs + recommendations
 *   /founder/observability-cost — Sentry sampling projections
 *   /founder/unit-economics    — per-customer gross margin
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Server,
  Users,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  BarChart2,
  BarChart3,
  Database,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { cn } from "@/lib/utils";

// ─── Types — mirror routes-founder-cost.ts response shape ────────────────────

interface DailyPoint {
  date: string;
  usd: number;
}

interface InfraSnapshot {
  runAt: string;
  aiCostUsd: number;
  flyCostUsd: number;
  mrrUsd: number;
  profitMarginPct: number;
  customerCount: number;
  summary: string;
}

interface OrgCost {
  organizationId: number;
  organizationName: string;
  usd: number;
  calls: number;
}

interface VendorLine {
  vendor: string;
  usd: number;
  source: "ai_telemetry" | "cost_optimizer" | "estimated";
  note: string;
}

interface CostSummaryResponse {
  asOf: string;
  aiSpendThisMonth: number;
  aiCallsThisMonth: number;
  dailyTrend: DailyPoint[];
  infraSnapshot: InfraSnapshot | null;
  topOrgs: OrgCost[];
  vendorLines: VendorLine[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Inline sparkline ─────────────────────────────────────────────────────────
// A tiny 30-day trend line. No charting library — pure SVG path.

function SparkLine({ data }: { data: DailyPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-12 text-xs text-muted-foreground">
        Not enough data yet
      </div>
    );
  }

  const W = 400;
  const H = 48;
  const PAD = 4;
  const maxUsd = Math.max(...data.map((d) => d.usd), 0.001);

  const points = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (d.usd / maxUsd) * (H - PAD * 2);
    return [x, y] as [number, number];
  });

  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  // Fill area below the line
  const fillPath =
    path +
    ` L ${points[points.length - 1][0].toFixed(1)},${H} L ${points[0][0].toFixed(1)},${H} Z`;

  const trend = data[data.length - 1].usd > data[0].usd ? "up" : "down";
  const strokeColor = trend === "up" ? "var(--acr-neg, #ef4444)" : "var(--acr-pos, #22c55e)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-12"
      aria-label="30-day AI spend trend"
      role="img"
    >
      <defs>
        <linearGradient id="cost-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#cost-spark-fill)" />
      <path d={path} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: VendorLine["source"] }) {
  if (source === "estimated") {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted">
        estimated
      </Badge>
    );
  }
  return null;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CostSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FounderCostPage() {
  useDocumentTitle("Cost — Founder");

  const { data, isLoading, error, refetch } = useQuery<CostSummaryResponse>({
    queryKey: ["/api/founder/cost-summary"],
    staleTime: 5 * 60 * 1000, // 5 min — cost data doesn't need real-time
  });

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto space-y-6 pb-12">

        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Cost</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              AI spend, infra, and vendor review — one scroll
            </p>
          </div>
          {data && (
            <div className="text-xs text-muted-foreground text-right shrink-0">
              <p>as of {fmtDate(data.asOf)}</p>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors mt-1 ml-auto"
                aria-label="Refresh cost data"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {isLoading && <CostSkeleton />}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            title="Could not load cost data"
          />
        )}

        {/* ── Content ──────────────────────────────────────────────────── */}
        {data && (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-5"
          >
            {/* ── Header strip: three key numbers ──────────────────────── */}
            <motion.div
              variants={staggerItem}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              {/* AI spend this month */}
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      AI spend · this month
                    </span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {fmtUsd(data.aiSpendThisMonth)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {data.aiCallsThisMonth.toLocaleString()} calls
                  </p>
                </CardContent>
              </Card>

              {/* Infra (Fly) */}
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Infra (Fly.io) · est.
                    </span>
                  </div>
                  {data.infraSnapshot ? (
                    <>
                      <p className="text-2xl font-bold tabular-nums text-foreground">
                        {fmtUsd(data.infraSnapshot.flyCostUsd)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        from nightly optimizer · {fmtDate(data.infraSnapshot.runAt)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold tabular-nums text-muted-foreground">—</p>
                      <p className="text-xs text-muted-foreground mt-1">optimizer hasn't run yet</p>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Profit margin */}
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {data.infraSnapshot && data.infraSnapshot.profitMarginPct >= 20 ? (
                      <TrendingUp className="w-4 h-4 text-acr-pos shrink-0" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-acr-neg shrink-0" />
                    )}
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Profit margin
                    </span>
                  </div>
                  {data.infraSnapshot ? (
                    <>
                      <p
                        className={cn(
                          "text-2xl font-bold tabular-nums",
                          data.infraSnapshot.profitMarginPct >= 40
                            ? "text-acr-pos"
                            : data.infraSnapshot.profitMarginPct >= 20
                            ? "text-acr-warn"
                            : "text-acr-neg"
                        )}
                      >
                        {fmtPct(data.infraSnapshot.profitMarginPct)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        MRR {fmtUsd(data.infraSnapshot.mrrUsd)} ·{" "}
                        {data.infraSnapshot.customerCount}{" "}
                        {data.infraSnapshot.customerCount === 1 ? "customer" : "customers"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold tabular-nums text-muted-foreground">—</p>
                      <p className="text-xs text-muted-foreground mt-1">no optimizer run yet</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* ── 30-day sparkline ──────────────────────────────────────── */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-muted-foreground" />
                    AI spend — 30-day trend
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Daily AI cost across all orgs
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-4">
                  {data.dailyTrend.length === 0 ? (
                    <EmptyState
                      icon={BarChart3}
                      headline="No spend data yet"
                      subtitle="AI calls will appear here once the system has processed requests."
                      // TODO(cta): spend data is system-generated from AI call volume; no direct user action
                      cta={{ label: "", _noOp: true }}
                    />
                  ) : (
                    <SparkLine data={data.dailyTrend} />
                  )}
                  {data.dailyTrend.length > 0 && (
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
                      <span>{fmtDate(data.dailyTrend[0].date)}</span>
                      <span>{fmtDate(data.dailyTrend[data.dailyTrend.length - 1].date)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* ── Vendor lines ──────────────────────────────────────────── */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    Vendor spend
                  </CardTitle>
                  <CardDescription className="text-xs">
                    What the platform pays, by vendor
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Vendor</TableHead>
                        <TableHead className="text-xs text-right">Spend</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.vendorLines.map((v) => (
                        <TableRow key={v.vendor}>
                          <TableCell className="font-medium text-sm">
                            <div className="flex items-center gap-2">
                              {v.vendor}
                              <SourceBadge source={v.source} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            {fmtUsd(v.usd)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                            {v.note}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </motion.div>

            {/* ── Per-org AI cost ──────────────────────────────────────── */}
            {data.topOrgs.length > 0 && (
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      Top orgs by AI spend · this month
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Identify heavy users before they hit quota
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Org</TableHead>
                          <TableHead className="text-xs text-right">Spend</TableHead>
                          <TableHead className="text-xs text-right hidden sm:table-cell">Calls</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.topOrgs.map((o) => (
                          <TableRow key={o.organizationId}>
                            <TableCell className="font-medium text-sm">{o.organizationName}</TableCell>
                            <TableCell className="text-right font-mono text-sm tabular-nums">
                              {fmtUsd(o.usd)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground hidden sm:table-cell tabular-nums">
                              {o.calls.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {data.topOrgs.length === 0 && (
              <motion.div variants={staggerItem}>
                <Card>
                  <CardContent className="pt-6">
                    <EmptyState
                      icon={Database}
                      headline="No per-org spend yet"
                      subtitle="AI usage by organization will appear here once customers are active."
                      // TODO(cta): per-org spend is system-generated; no direct founder action
                      cta={{ label: "", _noOp: true }}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ── Last optimizer run summary ────────────────────────────── */}
            {data.infraSnapshot?.summary && (
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      {data.infraSnapshot.profitMarginPct >= 20 ? (
                        <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0" />
                      )}
                      Optimizer assessment
                    </CardTitle>
                    <CardDescription className="text-xs">
                      From nightly cost-optimizer run · {fmtDate(data.infraSnapshot.runAt)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-sm text-foreground leading-relaxed">
                      {data.infraSnapshot.summary}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ── Deep-tool links ───────────────────────────────────────── */}
            <motion.div variants={staggerItem}>
              <Card className="bg-muted/30">
                <CardContent className="pt-5 pb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Deep tools
                  </p>
                  <div className="space-y-2">
                    {[
                      { href: "/founder/cost-optimizer", label: "Cost optimizer", description: "Nightly runs, recommendations, auto-applied actions" },
                      { href: "/founder/ai-costs", label: "AI telemetry", description: "Per-call breakdown — model, feature, top spenders" },
                      { href: "/founder/unit-economics", label: "Unit economics", description: "Per-customer gross margin and COGS" },
                      { href: "/founder/observability-cost", label: "Sentry cost", description: "Sampling rate projections and free-tier headroom" },
                    ].map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-muted transition-colors group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                            {link.label}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{link.description}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

          </motion.div>
        )}
      </div>
    </PageShell>
  );
}
