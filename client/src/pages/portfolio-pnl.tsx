import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp, TrendingDown, DollarSign, Percent, BarChart3,
} from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";

// The REAL /api/portfolio-pnl/:year contract (server/services/portfolioPnl.ts).
// This page previously declared an imagined shape (totalRevenue/roi at the
// top level): the payload parsed as truthy, every field read undefined, and
// `report.roi.toFixed` crashed the whole page via ErrorBoundary
// (2026-07-11 full-app sweep).
interface PnlPeriod {
  label: string; // "2025-Q3" or "2025-09"
  acquisitionCost: number;
  saleProceeds: number;
  interestIncome: number;
  otherIncome: number;
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number;
  dealsAcquired: number;
  dealsSold: number;
}

interface PnLReport {
  orgId: number;
  periods: PnlPeriod[];
  totals: {
    acquisitionCost: number;
    saleProceeds: number;
    interestIncome: number;
    totalRevenue: number;
    netProfit: number;
    cocReturn: number; // netProfit / acquisitionCost, as a 0–1 ratio
    irr: number | null;
  };
}

/** Derive the page's view fields from the real report — no fabrication:
 *  anything the server doesn't measure renders as "—", never invented. */
function toView(report: PnLReport) {
  const t = report.totals;
  const dealsSold = report.periods.reduce((s, p) => s + (p.dealsSold || 0), 0);
  return {
    totalRevenue: t.totalRevenue,
    totalCost: t.acquisitionCost,
    grossProfit: t.totalRevenue - t.acquisitionCost,
    netProfit: t.netProfit,
    roi: Number.isFinite(t.cocReturn) ? t.cocReturn * 100 : 0,
    irr: t.irr,
    dealsSold,
    avgSalePrice: dealsSold > 0 ? t.saleProceeds / dealsSold : null,
    byQuarter: report.periods
      .filter((p) => /-Q\d$/.test(p.label))
      .map((p) => ({
        quarter: Number(p.label.slice(-1)),
        revenue: p.totalRevenue,
        profit: p.grossProfit,
      })),
  };
}

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  subtext,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  subtext?: string;
}) {
  const trendColors = { up: "text-acr-pos", down: "text-acr-neg", neutral: "text-muted-foreground" };
  const trendColor = trend ? trendColors[trend] : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <dt className={`flex items-center gap-2 mb-1 text-xs ${trendColor}`}>
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {label}
        </dt>
        <dd className="text-2xl font-bold tabular-nums">{value}</dd>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

export default function PortfolioPnLPage() {
  useDocumentTitle("Portfolio P&L");
  const yearId = useId();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(String(currentYear));

  const { data: periodsData } = useQuery<{ years: number[] }>({
    queryKey: ["/api/portfolio-pnl/periods"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio-pnl/periods", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load periods (${res.status})`);
      return res.json();
    },
  });

  const {
    data: reportData,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery<{ report: PnLReport }>({
    queryKey: ["/api/portfolio-pnl", selectedYear],
    // Throw on !ok — the old `.then(r => r.json())` parsed error BODIES as
    // data, so a 4xx rendered the crash path instead of the error state.
    queryFn: async () => {
      const res = await fetch(`/api/portfolio-pnl/${selectedYear}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load P&L (${res.status})`);
      return res.json();
    },
  });

  const report = reportData?.report;
  const view = report ? toView(report) : null;
  const years = periodsData?.years ?? [currentYear];

  const roiIsPositive = view ? view.roi >= 0 : true;

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-portfolio-pnl-title">
            Portfolio P&amp;L
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Annual profit and loss summary for your land portfolio.
          </p>
        </div>
        <div>
          <Label htmlFor={yearId} className="sr-only">Select year</Label>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger id={yearId} className="w-28 tabular-nums" aria-label="Select year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)} className="tabular-nums">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <PageSkeleton variant="table" statCards={4} rows={6} announceText="Loading P&L data" />
      ) : isError ? (
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          compact
          title="Couldn't load your P&L"
          description="We hit a snag loading your portfolio profit and loss. Your data is safe — try again."
          testId="portfolio-pnl-query-error"
        />
      ) : !view ? (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>No P&amp;L data available for <span className="tabular-nums">{selectedYear}</span>.</p>
          <p className="text-sm mt-1">Data appears here after properties are sold and deals are closed.</p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Total revenue"
              value={usd(view.totalRevenue)}
              icon={DollarSign}
              trend="up"
            />
            <StatCard
              label="Net profit"
              value={usd(view.netProfit)}
              icon={roiIsPositive ? TrendingUp : TrendingDown}
              trend={roiIsPositive ? "up" : "down"}
            />
            <StatCard
              label="Cash-on-cash return"
              value={`${view.roi.toFixed(1)}%`}
              icon={Percent}
              trend={roiIsPositive ? "up" : "down"}
            />
            <StatCard
              label="Deals sold"
              value={String(view.dealsSold)}
              icon={BarChart3}
              subtext={view.avgSalePrice != null ? `Avg ${usd(view.avgSalePrice)} each` : undefined}
            />
          </dl>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Income statement</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  {[
                    { label: "Total revenue (sales + interest)", value: view.totalRevenue, type: "income" },
                    { label: "Acquisition cost", value: -view.totalCost, type: "expense" },
                    { label: "Gross profit", value: view.grossProfit, type: "result", bold: true },
                    { label: "Net profit", value: view.netProfit, type: "result", bold: true },
                  ].map(({ label, value, type, bold }) => (
                    <div key={label} className={`flex justify-between items-center text-sm ${bold ? "font-semibold pt-2 border-t" : ""}`}>
                      <dt className={type === "expense" ? "text-muted-foreground" : ""}>{label}</dt>
                      <dd className={`tabular-nums ${value >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                        {value >= 0 ? "+" : ""}{usd(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Key metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  {[
                    { label: "Cash-on-cash return", value: `${view.roi.toFixed(1)}%` },
                    // IRR is derived in-house from the org's actual deal/note
                    // cash flows (server/services/portfolioPnl.ts) — an
                    // estimate, carried by the canonical chip, not the label.
                    { label: "Annualized IRR", value: view.irr != null ? `${(view.irr * 100).toFixed(1)}%` : "—", isEstimate: view.irr != null },
                    { label: "Avg sale price", value: view.avgSalePrice != null ? usd(view.avgSalePrice) : "—" },
                    { label: "Deals sold", value: String(view.dealsSold) },
                  ].map(({ label, value, isEstimate }) => (
                    <div key={label} className="flex justify-between items-center gap-2">
                      <dt className="text-sm text-muted-foreground">
                        {label}
                        {isEstimate && (
                          <DataProvenanceChip
                            source="Portfolio cash flows"
                            classification="estimate"
                            className="ml-1.5"
                          />
                        )}
                      </dt>
                      <dd className="text-sm font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          {view.byQuarter.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Quarterly breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-4 gap-2" aria-label="Quarterly revenue and profit">
                  {view.byQuarter.map(q => (
                    <li key={q.quarter} className="text-center p-3 rounded-card border bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Q<span className="tabular-nums">{q.quarter}</span></p>
                      <p className="text-sm font-medium tabular-nums">{usd(q.revenue)}</p>
                      <p className={`text-xs tabular-nums ${q.profit >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                        {q.profit >= 0 ? "+" : ""}{usd(q.profit)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
