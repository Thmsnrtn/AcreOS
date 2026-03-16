import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface AvailablePeriods {
  years: number[];
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
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
  const trendColors = { up: "text-green-600", down: "text-red-600", neutral: "text-muted-foreground" };
  const trendColor = trend ? trendColors[trend] : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 mb-1 text-xs ${trendColor}`}>
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

export default function PortfolioPnLPage() {
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
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading P&amp;L data...
        </div>
      ) : !report ? (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No P&amp;L data available for {selectedYear}.</p>
          <p className="text-sm mt-1">Data appears here after properties are sold and deals are closed.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Total Revenue"
              value={formatCurrency(report.totalRevenue)}
              icon={DollarSign}
              trend="up"
            />
            <StatCard
              label="Net Profit"
              value={formatCurrency(report.netProfit)}
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
              label="Properties Sold"
              value={String(report.propertiesSold)}
              icon={BarChart3}
              subtext={`Avg ${formatCurrency(report.avgSalePrice)} each`}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Income Statement</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { label: "Total Revenue", value: report.totalRevenue, type: "income" },
                    { label: "Total Cost (Acquisition + Holding)", value: -report.totalCost, type: "expense" },
                    { label: "Gross Profit", value: report.grossProfit, type: "result", bold: true },
                    { label: "Net Profit", value: report.netProfit, type: "result", bold: true },
                  ].map(({ label, value, type, bold }) => (
                    <div key={label} className={`flex justify-between items-center text-sm ${bold ? "font-semibold pt-2 border-t" : ""}`}>
                      <span className={type === "expense" ? "text-muted-foreground" : ""}>{label}</span>
                      <span className={value >= 0 ? "text-green-600" : "text-red-600"}>
                        {value >= 0 ? "+" : ""}{formatCurrency(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Key Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: "Return on Investment", value: `${report.roi.toFixed(1)}%` },
                    { label: "Avg Sale Price", value: formatCurrency(report.avgSalePrice) },
                    { label: "Avg Holding Period", value: `${report.avgHoldingPeriodDays} days` },
                    { label: "Properties Transacted", value: String(report.propertiesSold) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {report.byQuarter && report.byQuarter.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Quarterly Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {report.byQuarter.map(q => (
                    <div key={q.quarter} className="text-center p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Q{q.quarter}</p>
                      <p className="text-sm font-medium">{formatCurrency(q.revenue)}</p>
                      <p className={`text-xs ${q.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {q.profit >= 0 ? "+" : ""}{formatCurrency(q.profit)}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {report.topPerformers && report.topPerformers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Top Performing Properties</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {report.topPerformers.map((p, i) => (
                    <div key={p.propertyId} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        #{i + 1} · Property {p.propertyId}
                      </span>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="text-xs">{p.roi.toFixed(1)}% ROI</Badge>
                        <span className="text-green-600 font-medium">{formatCurrency(p.netProfit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
