import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp, TrendingDown, DollarSign, Percent, BarChart3, Loader2,
} from "lucide-react";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface PnLReport {
  year: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  roi: number;
  propertiesSold: number;
  avgSalePrice: number;
  avgHoldingPeriodDays: number;
  topPerformers?: Array<{ propertyId: number; netProfit: number; roi: number }>;
  byQuarter?: Array<{ quarter: number; revenue: number; profit: number }>;
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
    queryFn: () => fetch("/api/portfolio-pnl/periods").then(r => r.json()),
  });

  const { data: reportData, isLoading } = useQuery<{ report: PnLReport }>({
    queryKey: ["/api/portfolio-pnl", selectedYear],
    queryFn: () => fetch(`/api/portfolio-pnl/${selectedYear}`).then(r => r.json()),
  });

  const report = reportData?.report;
  const years = periodsData?.years ?? [currentYear];

  const roiIsPositive = report ? report.roi >= 0 : true;

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
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading P&amp;L data…
        </div>
      ) : !report ? (
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
              value={usd(report.totalRevenue)}
              icon={DollarSign}
              trend="up"
            />
            <StatCard
              label="Net profit"
              value={usd(report.netProfit)}
              icon={roiIsPositive ? TrendingUp : TrendingDown}
              trend={roiIsPositive ? "up" : "down"}
            />
            <StatCard
              label="ROI"
              value={`${report.roi.toFixed(1)}%`}
              icon={Percent}
              trend={roiIsPositive ? "up" : "down"}
            />
            <StatCard
              label="Properties sold"
              value={String(report.propertiesSold)}
              icon={BarChart3}
              subtext={`Avg ${usd(report.avgSalePrice)} each`}
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
                    { label: "Total revenue", value: report.totalRevenue, type: "income" },
                    { label: "Total cost (acquisition + holding)", value: -report.totalCost, type: "expense" },
                    { label: "Gross profit", value: report.grossProfit, type: "result", bold: true },
                    { label: "Net profit", value: report.netProfit, type: "result", bold: true },
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
                    { label: "Return on investment", value: `${report.roi.toFixed(1)}%` },
                    { label: "Avg sale price", value: usd(report.avgSalePrice) },
                    { label: "Avg holding period", value: `${report.avgHoldingPeriodDays} days` },
                    { label: "Properties transacted", value: String(report.propertiesSold) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="text-sm font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          {report.byQuarter && report.byQuarter.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Quarterly breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-4 gap-2" aria-label="Quarterly revenue and profit">
                  {report.byQuarter.map(q => (
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

          {report.topPerformers && report.topPerformers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Top performing properties</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2" aria-label="Top performing properties by ROI">
                  {report.topPerformers.map((p, i) => (
                    <li key={p.propertyId} className="flex items-center justify-between text-sm gap-3 flex-wrap">
                      <span className="text-muted-foreground">
                        #<span className="tabular-nums">{i + 1}</span> · Property <span className="tabular-nums">{p.propertyId}</span>
                      </span>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="text-xs tabular-nums">{p.roi.toFixed(1)}% ROI</Badge>
                        <span className="text-acr-pos font-medium tabular-nums">{usd(p.netProfit)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
