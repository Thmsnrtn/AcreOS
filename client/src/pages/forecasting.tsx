import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Bar,
} from "recharts";
import { chartColor } from "@/lib/chartPalette";
import {
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Target,
} from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { format, addMonths } from "date-fns";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface MonthlyData {
  [month: string]: {
    income: number;
    expenses: number;
  };
}

interface PortfolioSummary {
  totalProjectedIncome: number;
  totalProjectedExpenses: number;
  netCashFlow: number;
  averageRiskScore: number;
  highRiskNoteCount: number;
  activeNoteCount: number;
  incomeBySource: Record<string, number>;
  expensesByCategory: Record<string, number>;
  monthlyData: MonthlyData;
}

// Abbreviated currency for chart axes / KPI cards (tight space). Money-precision
// rule still applies for ledger / bookkeeping surfaces — this is a forecast view
// where K/M abbreviations are conventional.
function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  format(addMonths(new Date(), i), "MMM yy")
);

export default function ForecastingPage() {
  useDocumentTitle("Cash flow forecasting");
  const { data: resp, isLoading, isError, error, refetch, isRefetching } = useQuery<{ summary: PortfolioSummary }>({
    queryKey: ["/api/cash-flow/portfolio/summary"],
    queryFn: () => fetch("/api/cash-flow/portfolio/summary").then((r) => r.json()),
  });

  const summary = resp?.summary;

  const chartData = MONTH_LABELS.map((label) => {
    const key = label;
    const entry = summary?.monthlyData?.[key];
    return {
      month: label,
      income: entry?.income ?? 0,
      expenses: entry?.expenses ?? 0,
      net: (entry?.income ?? 0) - (entry?.expenses ?? 0),
    };
  });

  const monthlyEntries = summary?.monthlyData
    ? Object.entries(summary.monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 12)
        .map(([month, data], i) => ({
          month: MONTH_LABELS[i] ?? month,
          income: data.income,
          expenses: data.expenses,
          net: data.income - data.expenses,
        }))
    : chartData;

  const incomeBreakdown = summary
    ? Object.entries(summary.incomeBySource).map(([source, amount]) => ({
        name: source.replace(/_/g, " "),
        amount,
      }))
    : [];

  const riskScore = summary?.averageRiskScore ?? 0;
  const riskColor = riskScore > 60 ? "text-acr-neg" : riskScore > 30 ? "text-acr-warn" : "text-acr-pos";

  return (
    <PageShell label="Forecasting">
      {isLoading ? (
        <PageSkeleton variant="table" statCards={4} announceText="Loading forecast data" />
      ) : isError ? (
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          compact
          title="Couldn't load your forecast"
          description="We hit a snag loading your cash-flow forecast. Your data is safe — try again."
          testId="forecasting-query-error"
        />
      ) : !summary ? (
        <EmptyState
          icon={Target}
          headline="No active notes or properties found."
          subtitle="Add notes to see forecasts."
          // TODO(cta): note origination lives behind Finance — forecast is a derived view
          cta={{ label: "", _noOp: true }}
          testId="empty-state-forecasting"
        />
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-8 h-8 text-acr-pos" aria-hidden="true" />
                  <div>
                    <dd className="text-2xl font-bold text-acr-pos tabular-nums">
                      {fmt(summary.totalProjectedIncome)}
                    </dd>
                    <dt className="text-xs text-muted-foreground">
                      12-mo income forecast
                    </dt>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-8 h-8 text-acr-accent" aria-hidden="true" />
                  <div>
                    <dd className={`text-2xl font-bold tabular-nums ${summary.netCashFlow >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                      {fmt(summary.netCashFlow)}
                    </dd>
                    <dt className="text-xs text-muted-foreground">Net cash flow</dt>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-acr-brand" aria-hidden="true" />
                  <div>
                    <dd className="text-2xl font-bold tabular-nums">{summary.activeNoteCount}</dd>
                    <dt className="text-xs text-muted-foreground">Active notes</dt>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <AlertCircle
                    className={`w-8 h-8 ${summary.highRiskNoteCount > 0 ? "text-acr-neg" : "text-acr-pos"}`}
                    aria-hidden="true"
                  />
                  <div>
                    <dd className={`text-2xl font-bold tabular-nums ${riskColor}`}>
                      {summary.highRiskNoteCount}
                    </dd>
                    <dt className="text-xs text-muted-foreground">High-risk notes</dt>
                  </div>
                </div>
              </CardContent>
            </Card>
          </dl>

          <Card>
            <CardHeader>
              <CardTitle>Monthly cash flow — next 12 months</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyEntries.length > 0 ? (
                <div
                  role="img"
                  aria-label={`12-month cash flow forecast: ${fmt(summary.totalProjectedIncome)} income, ${fmt(summary.totalProjectedExpenses)} expenses, ${fmt(summary.netCashFlow)} net`}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={monthlyEntries}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColor(0)} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => fmt(v)}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip formatter={((value: number, name: string) => [fmt(value), name]) as any} />
                      <Bar dataKey="income" name="Income" fill={chartColor(1)} radius={[4, 4, 0, 0]} opacity={0.85} />
                      <Bar dataKey="expenses" name="Expenses" fill={chartColor(2)} radius={[4, 4, 0, 0]} opacity={0.85} />
                      <Line type="monotone" dataKey="net" name="Net" stroke={chartColor(3)} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                  Monthly data will appear once notes have payment history.
                </div>
              )}
            </CardContent>
          </Card>

          {incomeBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Income by source</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3" aria-label="Projected income by source">
                  {incomeBreakdown
                    .sort((a, b) => b.amount - a.amount)
                    .map((item) => {
                      const pct = summary.totalProjectedIncome > 0
                        ? (item.amount / summary.totalProjectedIncome) * 100
                        : 0;
                      return (
                        <li key={item.name}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="capitalize font-medium">{item.name}</span>
                            <span className="text-muted-foreground tabular-nums">
                              {fmt(item.amount)} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div
                            className="h-2 bg-muted rounded-full overflow-hidden"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${item.name}: ${fmt(item.amount)} (${Math.round(pct)}% of projected income)`}
                          >
                            <div
                              className="h-full bg-acr-pos rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Portfolio risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center">
                  <p
                    className={`text-4xl font-bold tabular-nums ${riskColor}`}
                    aria-label={`Average risk score ${Math.round(summary.averageRiskScore)} of 100, ${riskScore > 60 ? "high" : riskScore > 30 ? "moderate" : "low"} risk`}
                  >
                    {Math.round(summary.averageRiskScore)}
                  </p>
                  <p className="text-sm text-muted-foreground">Avg risk score</p>
                  <p className="text-xs text-muted-foreground">(0 = low, 100 = high)</p>
                </div>
                <dl className="flex-1 space-y-2 min-w-[200px]">
                  <div className="flex justify-between text-sm">
                    <dt>Low risk notes</dt>
                    <dd>
                      <Badge variant="outline" className="text-acr-pos tabular-nums">
                        {summary.activeNoteCount - summary.highRiskNoteCount}
                      </Badge>
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt>High risk notes</dt>
                    <dd>
                      <Badge
                        variant="outline"
                        className={`tabular-nums ${summary.highRiskNoteCount > 0 ? "text-acr-neg" : "text-acr-pos"}`}
                      >
                        {summary.highRiskNoteCount}
                      </Badge>
                    </dd>
                  </div>
                  {summary.highRiskNoteCount > 0 && (
                    <p className="text-xs text-acr-neg pt-1" role="alert">
                      <span aria-hidden="true">⚠️ </span>
                      <span className="tabular-nums">{summary.highRiskNoteCount}</span> note(s) need attention — review payment history.
                    </p>
                  )}
                </dl>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
