import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Target,
} from "lucide-react";
import { format, addMonths } from "date-fns";

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

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  format(addMonths(new Date(), i), "MMM yy")
);

export default function ForecastingPage() {
  const { data: resp, isLoading } = useQuery<{ summary: PortfolioSummary }>({
    queryKey: ["/api/cash-flow/portfolio/summary"],
    queryFn: () => fetch("/api/cash-flow/portfolio/summary").then((r) => r.json()),
  });

  const summary = resp?.summary;

  // Build chart data from monthlyData
  const chartData = MONTH_LABELS.map((label) => {
    // The API uses keys like "2026-04" etc. We just build synthetic labels
    const key = label;
    const entry = summary?.monthlyData?.[key];
    return {
      month: label,
      income: entry?.income ?? 0,
      expenses: entry?.expenses ?? 0,
      net: (entry?.income ?? 0) - (entry?.expenses ?? 0),
    };
  });

  // If monthlyData is keyed by something else, extract in order
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

  const riskColor =
    (summary?.averageRiskScore ?? 0) > 60
      ? "text-red-600"
      : (summary?.averageRiskScore ?? 0) > 30
      ? "text-amber-600"
      : "text-green-600";

  return (
    <PageShell>
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !summary ? (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No active notes or properties found. Add notes to see forecasts.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">
                      {fmt(summary.totalProjectedIncome)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      12-mo Income Forecast
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-8 h-8 text-blue-500" />
                  <div>
                    <p
                      className={`text-2xl font-bold ${summary.netCashFlow >= 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {fmt(summary.netCashFlow)}
                    </p>
                    <p className="text-xs text-muted-foreground">Net Cash Flow</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold">{summary.activeNoteCount}</p>
                    <p className="text-xs text-muted-foreground">Active Notes</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <AlertCircle
                    className={`w-8 h-8 ${summary.highRiskNoteCount > 0 ? "text-red-500" : "text-green-500"}`}
                  />
                  <div>
                    <p className={`text-2xl font-bold ${riskColor}`}>
                      {summary.highRiskNoteCount}
                    </p>
                    <p className="text-xs text-muted-foreground">High-Risk Notes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly cash flow chart */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Cash Flow — Next 12 Months</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyEntries.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={monthlyEntries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => fmt(v)}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                      opacity={0.85}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                      opacity={0.85}
                    />
                    <Line
                      type="monotone"
                      dataKey="net"
                      name="Net"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                  Monthly data will appear once notes have payment history.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Income breakdown */}
          {incomeBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Income by Source</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {incomeBreakdown
                    .sort((a, b) => b.amount - a.amount)
                    .map((item) => {
                      const pct = summary.totalProjectedIncome > 0
                        ? (item.amount / summary.totalProjectedIncome) * 100
                        : 0;
                      return (
                        <div key={item.name}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="capitalize font-medium">{item.name}</span>
                            <span className="text-muted-foreground">
                              {fmt(item.amount)} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk summary */}
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className={`text-4xl font-bold ${riskColor}`}>
                    {Math.round(summary.averageRiskScore)}
                  </p>
                  <p className="text-sm text-muted-foreground">Avg Risk Score</p>
                  <p className="text-xs text-muted-foreground">(0 = low, 100 = high)</p>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Low risk notes</span>
                    <Badge variant="outline" className="text-green-700">
                      {summary.activeNoteCount - summary.highRiskNoteCount}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>High risk notes</span>
                    <Badge
                      variant="outline"
                      className={
                        summary.highRiskNoteCount > 0 ? "text-red-700" : "text-green-700"
                      }
                    >
                      {summary.highRiskNoteCount}
                    </Badge>
                  </div>
                  {summary.highRiskNoteCount > 0 && (
                    <p className="text-xs text-red-600 pt-1">
                      ⚠️ {summary.highRiskNoteCount} note(s) need attention — review
                      payment history
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
