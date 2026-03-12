import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Activity,
  Shield,
  CheckCircle,
  Zap,
} from 'lucide-react';

function formatDollar(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const URGENCY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
};

const IMPACT_STYLES: Record<string, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-orange-600 dark:text-orange-400',
  low: 'text-yellow-600 dark:text-yellow-400',
};

const PATTERN_STYLES: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  consistent: { label: 'Consistent', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', icon: <CheckCircle className="w-4 h-4" /> },
  improving: { label: 'Improving', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: <TrendingUp className="w-4 h-4" /> },
  declining: { label: 'Declining', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', icon: <TrendingDown className="w-4 h-4" /> },
  erratic: { label: 'Erratic', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: <AlertTriangle className="w-4 h-4" /> },
};

export default function CashFlowPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [forecastId, setForecastId] = useState<number | null>(null);

  // Portfolio summary
  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['cash-flow', 'portfolio', 'summary'],
    queryFn: async () => {
      const res = await fetch('/api/cash-flow/portfolio/summary', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch portfolio summary');
      return res.json();
    },
  });

  // High risk notes
  const { data: highRiskData } = useQuery({
    queryKey: ['cash-flow', 'portfolio', 'high-risk'],
    queryFn: async () => {
      const res = await fetch('/api/cash-flow/portfolio/high-risk', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch high risk notes');
      return res.json();
    },
  });

  // Insights for current forecast
  const { data: insightsData } = useQuery({
    queryKey: ['cash-flow', 'insights', forecastId],
    queryFn: async () => {
      const res = await fetch(`/api/cash-flow/forecast/${forecastId}/insights`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch insights');
      return res.json();
    },
    enabled: !!forecastId,
  });

  // Actual vs projected
  const { data: accuracyData } = useQuery({
    queryKey: ['cash-flow', 'accuracy'],
    queryFn: async () => {
      const res = await fetch('/api/cash-flow/forecast/actual-vs-projected?periodMonths=6', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch accuracy data');
      return res.json();
    },
  });

  // 24-month portfolio timeline
  const { data: portfolioTimelineData } = useQuery({
    queryKey: ['cash-flow', 'portfolio', 'timeline'],
    queryFn: async () => {
      const res = await fetch('/api/cash-flow/portfolio/timeline?months=24', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch portfolio timeline');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cash-flow/forecast', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodMonths: 12 }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Forecast failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setForecastId(data.forecast?.id);
      toast({ title: 'Forecast generated', description: '12-month cash flow projection ready.' });
      queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
      refetchSummary();
    },
    onError: (err: Error) => {
      toast({ title: 'Forecast failed', description: err.message, variant: 'destructive' });
    },
  });

  const summary = summaryData?.summary;
  const highRisk = highRiskData?.highRisk ?? [];
  const insights = insightsData?.insights ?? [];
  const accuracy = accuracyData?.comparison;

  // Build monthly chart from summary
  const monthlyChartData = summary?.monthlyBreakdown?.map((m: any) => ({
    month: m.month,
    Income: Math.round(m.income),
    Expenses: Math.round(m.expenses),
    'Net Cash Flow': Math.round(m.net),
  })) ?? [];

  // Income breakdown pie data
  const incomeBreakdown = summary
    ? Object.entries(summary.incomeBySource).map(([source, amount]: [string, any]) => ({
        name: source.replace(/_/g, ' '),
        value: Math.round(amount),
      }))
    : [];

  // Portfolio health gauge
  const monthlyNetCashFlow = summary?.totalMonthlyNet ?? 0;
  const monthlyObligations = summary?.totalMonthlyExpenses ?? 0;
  const coverageRatio = monthlyObligations > 0 ? (monthlyNetCashFlow + monthlyObligations) / monthlyObligations : null;
  const cashFlowHealthPct = coverageRatio ? Math.min(100, Math.max(0, (coverageRatio - 0.8) * 100)) : null;
  const runwayMonths = summary?.cashReserves && monthlyNetCashFlow < 0
    ? Math.floor(summary.cashReserves / Math.abs(monthlyNetCashFlow))
    : null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="w-8 h-8 text-primary" />
            Cash Flow Forecaster
          </h1>
          <p className="text-muted-foreground mt-1">
            12-month income and expense projections with payment health analysis and AI insights.
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
          {generateMutation.isPending ? 'Forecasting…' : 'Generate Forecast'}
        </Button>
      </div>

      {/* Portfolio Cash Flow Health Banner */}
      {summary && cashFlowHealthPct !== null && (
        <div className={`rounded-xl border p-4 ${monthlyNetCashFlow >= 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800" : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${monthlyNetCashFlow >= 0 ? "text-emerald-600" : "text-red-500"}`} />
              <span className="font-semibold text-sm">Portfolio Cash Flow Health</span>
            </div>
            <div className="flex items-center gap-3">
              {coverageRatio !== null && (
                <span className="text-xs text-muted-foreground">Coverage Ratio: <span className="font-bold text-foreground">{coverageRatio.toFixed(2)}x</span></span>
              )}
              {runwayMonths !== null && (
                <Badge variant="destructive" className="text-xs">
                  {runwayMonths} mo runway
                </Badge>
              )}
            </div>
          </div>
          <div className="w-full bg-background/60 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${monthlyNetCashFlow >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
              style={{ width: `${cashFlowHealthPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {monthlyNetCashFlow >= 0
              ? `Positive cash flow of ${formatDollar(monthlyNetCashFlow)}/mo · Your portfolio is generating surplus income.`
              : `Negative cash flow of ${formatDollar(Math.abs(monthlyNetCashFlow))}/mo · Expenses exceed income — review high-risk notes.`}
          </p>
        </div>
      )}

      {/* Portfolio KPIs */}
      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-muted-foreground">Projected Income</span>
              </div>
              <div className="text-2xl font-bold text-emerald-600">{formatDollar(summary.totalProjectedIncome)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Next 12 months</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-sm text-muted-foreground">Projected Expenses</span>
              </div>
              <div className="text-2xl font-bold text-red-500">{formatDollar(summary.totalProjectedExpenses)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Next 12 months</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Net Cash Flow</span>
              </div>
              <div className={`text-2xl font-bold ${summary.netCashFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {formatDollar(summary.netCashFlow)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Next 12 months</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-muted-foreground">High-Risk Notes</span>
              </div>
              <div className="text-2xl font-bold text-orange-500">{summary.highRiskNoteCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Avg risk score: {Math.round(summary.averagePaymentRiskScore * 100)}%
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        !summaryLoading && (
          <div className="text-center py-16 text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No forecast data yet</p>
            <p className="text-sm mt-1">Click "Generate Forecast" to create your first cash flow projection</p>
          </div>
        )
      )}

      {summary && (
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Portfolio Timeline</TabsTrigger>
            <TabsTrigger value="breakdown">Income Breakdown</TabsTrigger>
            <TabsTrigger value="risk">High-Risk Notes ({highRisk.length})</TabsTrigger>
            {insights.length > 0 && <TabsTrigger value="insights">AI Insights ({insights.length})</TabsTrigger>}
            {accuracy && <TabsTrigger value="accuracy">Forecast Accuracy</TabsTrigger>}
          </TabsList>

          {/* ── TIMELINE ── */}
          <TabsContent value="timeline" className="space-y-4">
            {/* 24-month portfolio income timeline with uncertainty band */}
            {portfolioTimelineData?.timeline && portfolioTimelineData.timeline.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>24-Month Income Projection</CardTitle>
                  <CardDescription>
                    Expected monthly income across all active notes and owned properties.
                    Shaded band shows uncertainty range. Balloon payments are highlighted.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={portfolioTimelineData.timeline}>
                      <defs>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                      <Tooltip
                        formatter={(v: any, name: string) => [
                          formatDollar(v),
                          name === 'incomeLow' ? 'Low estimate' :
                          name === 'incomeHigh' ? 'High estimate' : 'Expected income',
                        ]}
                        labelFormatter={(label: string) => {
                          const row = portfolioTimelineData.timeline.find((r: any) => r.month === label);
                          return row?.isBalloon ? `${label} 🎈 Balloon payment due` : label;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="incomeHigh"
                        stroke="none"
                        fill="url(#bandGrad)"
                        legendType="none"
                      />
                      <Area
                        type="monotone"
                        dataKey="income"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#incomeGrad)"
                        name="Expected income"
                        dot={(props: any) => {
                          const { cx, cy, payload } = props;
                          if (!payload.isBalloon) return <g key={`dot-${cx}-${cy}`} />;
                          return (
                            <circle key={`balloon-${cx}-${cy}`} cx={cx} cy={cy} r={6}
                              fill="#f59e0b" stroke="#fff" strokeWidth={2} />
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="incomeLow"
                        stroke="none"
                        fill="white"
                        legendType="none"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground mt-2">
                    Yellow dots indicate balloon payment months. Band represents ±25% uncertainty.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Monthly Cash Flow Projection</CardTitle>
                <CardDescription>Projected income, expenses, and net cash flow over the next 12 months</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                    <Tooltip formatter={(v: any, name: string) => [formatDollar(v), name]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#888" />
                    <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Net Cash Flow area */}
                <ResponsiveContainer width="100%" height={160} className="mt-4">
                  <AreaChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                    <Tooltip formatter={(v: any) => [formatDollar(v), 'Net Cash Flow']} />
                    <ReferenceLine y={0} stroke="#888" />
                    <Area
                      type="monotone"
                      dataKey="Net Cash Flow"
                      stroke="#d97541"
                      fill="#d9754130"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── BREAKDOWN ── */}
          <TabsContent value="breakdown" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Income by Source</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {incomeBreakdown.map((item) => (
                    <div key={item.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{item.name}</span>
                        <span className="font-medium">{formatDollar(item.value)}</span>
                      </div>
                      <Progress
                        value={(item.value / summary.totalProjectedIncome) * 100}
                        className="h-2"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Expenses by Category</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(summary.expensesByCategory).map(([cat, amt]: [string, any]) => (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{cat}</span>
                        <span className="font-medium text-red-500">{formatDollar(amt)}</span>
                      </div>
                      <Progress
                        value={(amt / summary.totalProjectedExpenses) * 100}
                        className="h-2"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── HIGH-RISK NOTES ── */}
          <TabsContent value="risk" className="space-y-4">
            {highRisk.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No high-risk notes detected. Portfolio looks healthy.</p>
              </div>
            ) : (
              highRisk.map(({ note, riskScore, riskFactors }: any) => (
                <Card key={note.id} className="border-orange-200 dark:border-orange-800">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">Note #{note.id}</p>
                          <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                            Risk: {(riskScore * 100).toFixed(0)}%
                          </Badge>
                          {note.paymentPattern && (
                            <Badge className={PATTERN_STYLES[note.paymentPattern]?.color || ''}>
                              {PATTERN_STYLES[note.paymentPattern]?.icon}
                              <span className="ml-1">{PATTERN_STYLES[note.paymentPattern]?.label || note.paymentPattern}</span>
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Balance: {note.balance ? formatDollar(note.balance) : '—'} ·
                          Rate: {note.interestRate ?? '—'}%
                        </p>
                      </div>
                    </div>

                    {riskFactors?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {riskFactors.slice(0, 3).map((f: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <span className={`shrink-0 font-medium ${IMPACT_STYLES[f.impact]}`}>
                              {f.impact.toUpperCase()}
                            </span>
                            <span className="text-muted-foreground">{f.factor}</span>
                            {f.mitigation && (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1">
                                → {f.mitigation}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── INSIGHTS ── */}
          {insights.length > 0 && (
            <TabsContent value="insights" className="space-y-4">
              {insights.map((insight: any, i: number) => (
                <Card key={i}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded ${insight.urgency === 'critical' || insight.urgency === 'high' ? 'bg-red-100' : 'bg-blue-100'}`}>
                        <Zap className={`w-4 h-4 ${insight.urgency === 'critical' || insight.urgency === 'high' ? 'text-red-600' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={URGENCY_STYLES[insight.urgency] || ''}>
                            {insight.urgency}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize">{insight.type?.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-sm">{insight.message}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          )}

          {/* ── ACCURACY ── */}
          {accuracy && (
            <TabsContent value="accuracy" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Forecast Accuracy — Last 6 Months</CardTitle>
                  <CardDescription>
                    Overall accuracy: {(accuracy.overallAccuracy * 100).toFixed(1)}%
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {accuracy.forecasts?.length > 0 ? (
                    <div className="space-y-4">
                      {accuracy.forecasts.map((f: any) => (
                        <div key={f.forecastId} className="space-y-2 pb-4 border-b last:border-b-0">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Forecast #{f.forecastId}</span>
                            <span className={Math.abs(f.variancePercent) < 10 ? 'text-emerald-600' : 'text-orange-500'}>
                              Income variance: {f.variancePercent.toFixed(1)}%
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Projected Income</p>
                              <p className="font-medium">{formatDollar(f.projectedIncome)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Actual Income</p>
                              <p className="font-medium">{formatDollar(f.actualIncome)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No historical comparison data available yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
