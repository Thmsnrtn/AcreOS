/**
 * /founder/unit-economics — Per-customer profit margin dashboard.
 *
 * Lavender Week 12.
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at the
 * API layer (GET /api/founder/unit-economics returns 403 to non-founder
 * orgs).
 *
 * Layout (top → bottom):
 *   1. Aggregate metrics strip — total MRR, total COGS, gross margin %, count.
 *   2. Top-10 most profitable customers (green tint).
 *   3. Top-10 unprofitable customers (red tint), each with an inline "Why?"
 *      expander that drills into the COGS components for that org.
 *   4. 90-day MRR / COGS / gross-margin trend chart (inline SVG).
 *
 * Zero-customer state renders a clean empty state — current production
 * reality is a zero-customer cluster, so this page must never crash on
 * empty data.
 */

import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  ChevronDown,
  AlertTriangle,
  LineChart,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Types — must match server/services/unitEconomics.ts ────────────────────

interface UnitEconomicsRow {
  organizationId: number;
  organizationName: string;
  subscriptionTier: string;
  mrrUsd: number;
  aiCostUsd: number;
  directMailCostUsd: number;
  smsCostUsd: number;
  emailCostUsd: number;
  skipTraceCostUsd: number;
  fixedCostShareUsd: number;
  totalCogsUsd: number;
  profitMarginUsd: number;
  profitMarginPct: number;
  consecutiveUnprofitableDays: number;
  computedAt: string;
}

interface UnitEconomicsResponse {
  totals: {
    customerCount: number;
    payingCustomerCount: number;
    totalMrrUsd: number;
    totalCogsUsd: number;
    grossMarginUsd: number;
    grossMarginPct: number;
  };
  rows: UnitEconomicsRow[];
  trend: Array<{
    date: string;
    totalMrrUsd: number;
    totalCogsUsd: number;
    grossMarginUsd: number;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(n: number, digits = 2): string {
  return `$${(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtPct(n: number, digits = 1): string {
  return `${(n ?? 0).toFixed(digits)}%`;
}

// ─── Trend chart (inline SVG; no chart-lib dep) ─────────────────────────────

function TrendChart({ trend }: { trend: UnitEconomicsResponse["trend"] }) {
  if (!trend.length) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No snapshots yet — once the nightly job has run a few days you'll see
        the 90-day trend here.
      </p>
    );
  }
  const w = 720;
  const h = 200;
  const padX = 32;
  const padY = 16;
  const xs = trend.map((_, i) => padX + (i * (w - padX * 2)) / Math.max(1, trend.length - 1));
  const allValues = trend.flatMap((t) => [t.totalMrrUsd, t.totalCogsUsd, t.grossMarginUsd]);
  const minV = Math.min(...allValues, 0);
  const maxV = Math.max(...allValues, 1);
  const range = maxV - minV || 1;
  const yFor = (v: number) => h - padY - ((v - minV) / range) * (h - padY * 2);

  function pathFor(key: "totalMrrUsd" | "totalCogsUsd" | "grossMarginUsd"): string {
    return trend
      .map((t, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${yFor(t[key]).toFixed(1)}`)
      .join(" ");
  }

  const zeroY = yFor(0);

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} role="img" aria-label="MRR / COGS / Gross margin trend over the last 90 days">
        {/* Zero baseline */}
        <line
          x1={padX}
          x2={w - padX}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeDasharray="4 4"
        />
        <path d={pathFor("totalMrrUsd")} fill="none" stroke="hsl(142 71% 45%)" strokeWidth={1.6} />
        <path d={pathFor("totalCogsUsd")} fill="none" stroke="hsl(0 72% 51%)" strokeWidth={1.6} />
        <path d={pathFor("grossMarginUsd")} fill="none" stroke="hsl(217 91% 60%)" strokeWidth={1.8} />
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "hsl(142 71% 45%)" }} aria-hidden />
          MRR
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "hsl(0 72% 51%)" }} aria-hidden />
          COGS
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "hsl(217 91% 60%)" }} aria-hidden />
          Gross margin
        </span>
      </div>
    </div>
  );
}

// ─── Why-expander row (cost breakdown for unprofitable customers) ───────────

function WhyExpander({ row }: { row: UnitEconomicsRow }) {
  const [open, setOpen] = useState(false);
  const components: Array<{ label: string; usd: number }> = [
    { label: "AI", usd: row.aiCostUsd },
    { label: "Direct mail", usd: row.directMailCostUsd },
    { label: "SMS", usd: row.smsCostUsd },
    { label: "Email", usd: row.emailCostUsd },
    { label: "Skip trace", usd: row.skipTraceCostUsd },
    { label: "Fixed-cost share", usd: row.fixedCostShareUsd },
  ];
  components.sort((a, b) => b.usd - a.usd);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`${open ? "Hide" : "Show"} cost breakdown for ${row.organizationName}`}
        >
          Why?
          <ChevronDown
            className={`h-3 w-3 ml-1 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between font-medium">
            <span>Cost component</span>
            <span>30d USD</span>
          </div>
          {components.map((c) => (
            <div key={c.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{c.label}</span>
              <span className="tabular-nums">{fmtUsd(c.usd, 4)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-1.5 font-medium">
            <span>Total COGS</span>
            <span className="tabular-nums">{fmtUsd(row.totalCogsUsd, 4)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">MRR</span>
            <span className="tabular-nums">{fmtUsd(row.mrrUsd, 2)}</span>
          </div>
          <div className="flex items-center justify-between font-medium text-destructive">
            <span>Profit margin</span>
            <span className="tabular-nums">
              {fmtUsd(row.profitMarginUsd, 2)} ({fmtPct(row.profitMarginPct)})
            </span>
          </div>
          {row.consecutiveUnprofitableDays > 0 ? (
            <p className="pt-1.5 text-xs text-muted-foreground">
              Unprofitable for{" "}
              <strong className="text-foreground">{row.consecutiveUnprofitableDays}d</strong>{" "}
              consecutively.
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Summary tile ───────────────────────────────────────────────────────────

function SummaryTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {icon}
          {label}
        </div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
        {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FounderUnitEconomicsPage() {
  useDocumentTitle("Unit economics");
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<UnitEconomicsResponse>({
    queryKey: ["/api/founder/unit-economics"],
    refetchInterval: 5 * 60_000,
  });

  // Sort the array two ways for the two tables. The server returns rows
  // sorted by margin ASC; we still re-sort defensively on the client so the
  // UI doesn't crater if the contract changes.
  const { topProfitable, topUnprofitable } = useMemo(() => {
    const rows = data?.rows ?? [];
    const sortedDesc = [...rows].sort((a, b) => b.profitMarginUsd - a.profitMarginUsd);
    const sortedAsc = [...rows].sort((a, b) => a.profitMarginUsd - b.profitMarginUsd);
    return {
      topProfitable: sortedDesc.slice(0, 10),
      topUnprofitable: sortedAsc.filter((r) => r.profitMarginUsd < 0).slice(0, 10),
    };
  }, [data?.rows]);

  return (
    <PageShell label="Per-customer unit economics">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Per-customer unit economics</h1>
          <p className="text-sm text-muted-foreground">
            MRR vs trailing-30-day COGS per organisation. Refreshed nightly; manual refresh below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <DollarSign className="h-3 w-3" aria-hidden="true" />
            Lavender W12
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching || isLoading}
            aria-label="Refresh unit economics rollup"
          >
            {isRefetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {isError ? (
        <Card className="mb-6">
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load unit economics: {(error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {/* Aggregate metrics */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile
          icon={<Users className="h-4 w-4" aria-hidden />}
          label="Customers"
          value={
            isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span>
                {data?.totals.customerCount ?? 0}
                <span className="ml-1 text-base text-muted-foreground">
                  ({data?.totals.payingCustomerCount ?? 0} paying)
                </span>
              </span>
            )
          }
        />
        <SummaryTile
          icon={<DollarSign className="h-4 w-4" aria-hidden />}
          label="Total MRR"
          value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtUsd(data?.totals.totalMrrUsd ?? 0)}
        />
        <SummaryTile
          icon={<TrendingDown className="h-4 w-4" aria-hidden />}
          label="Total COGS (30d)"
          value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtUsd(data?.totals.totalCogsUsd ?? 0)}
        />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          label="Gross margin"
          value={
            isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              `${fmtUsd(data?.totals.grossMarginUsd ?? 0)} (${fmtPct(data?.totals.grossMarginPct ?? 0)})`
            )
          }
          tone={(data?.totals.grossMarginUsd ?? 0) >= 0 ? "pos" : "neg"}
        />
      </div>

      {/* Empty state — zero customers */}
      {!isLoading && (data?.rows.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Users}
              title="No customer snapshots yet"
              description="The unit-economics rollup runs nightly. Once you have paying customers and the job has executed, this page will show their per-customer profitability."
              secondaryDescription="Acceptable on a zero-customer cluster — this is the current production reality."
              testId="unit-economics-empty"
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Top profitable + Top unprofitable */}
      {(data?.rows.length ?? 0) > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden />
                Top 10 profitable
              </CardTitle>
              <CardDescription>Most positive profit-margin customers (30d).</CardDescription>
            </CardHeader>
            <CardContent>
              {topProfitable.length === 0 ? (
                <p className="text-sm text-muted-foreground">No profitable customers yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">MRR</TableHead>
                      <TableHead className="text-right">COGS</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProfitable.map((r) => (
                      <TableRow key={r.organizationId} className="bg-emerald-500/5">
                        <TableCell>
                          <div className="font-medium">{r.organizationName}</div>
                          <div className="text-xs text-muted-foreground">{r.subscriptionTier}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(r.mrrUsd)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtUsd(r.totalCogsUsd, 4)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">
                          {fmtUsd(r.profitMarginUsd)} ({fmtPct(r.profitMarginPct)})
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-destructive" aria-hidden />
                Top 10 unprofitable
              </CardTitle>
              <CardDescription>
                Negative-margin customers; expand "Why?" to drill into COGS components.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {topUnprofitable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No unprofitable customers — every paying customer is in the black.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">MRR</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topUnprofitable.map((r) => (
                      <TableRow key={r.organizationId} className="bg-destructive/5">
                        <TableCell>
                          <div className="font-medium flex items-center gap-1.5">
                            {r.organizationName}
                            {r.consecutiveUnprofitableDays >= 7 ? (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-destructive"
                                aria-label={`Unprofitable ${r.consecutiveUnprofitableDays}d`}
                              />
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.subscriptionTier}
                            {r.consecutiveUnprofitableDays > 0
                              ? ` · ${r.consecutiveUnprofitableDays}d streak`
                              : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtUsd(r.mrrUsd)}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {fmtUsd(r.profitMarginUsd)}
                        </TableCell>
                        <TableCell className="text-right">
                          <WhyExpander row={r} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* 90-day trend chart */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-4 w-4" aria-hidden />
            90-day trend
          </CardTitle>
          <CardDescription>
            Aggregate MRR vs COGS vs gross margin per day. Built from `customer_unit_economics`
            daily snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-[200px] w-full" /> : <TrendChart trend={data?.trend ?? []} />}
        </CardContent>
      </Card>
    </PageShell>
  );
}
