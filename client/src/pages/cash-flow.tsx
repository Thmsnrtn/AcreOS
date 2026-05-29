import { useState } from 'react';
import { RequiredDisclaimer } from '@/components/required-disclaimer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorState } from '@/components/query-error-state';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { usd } from '@/lib/format';
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
import { chartColor } from "@/lib/chartPalette";
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
  // Compact display for chart axes + KPI cards. M/K bands round
  // intentionally for screen real estate; sub-$1K falls through to usd()
  // so cents are preserved (cash-flow projections can show partial-dollar
  // monthly nets that previously rounded silently).
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return usd(n, { noCents: true });
}

const URGENCY_STYLES: Record<string, string> = {
  critical: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg',
  high: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  medium: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  low: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent',
};

const IMPACT_STYLES: Record<string, string> = {
  high: 'text-acr-neg dark:text-acr-neg',
  medium: 'text-acr-warn dark:text-acr-warn',
  low: 'text-acr-warn dark:text-acr-warn',
};

const PATTERN_STYLES: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  consistent: { label: 'Consistent', color: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos', icon: <CheckCircle className="w-4 h-4" aria-hidden="true" /> },
  improving: { label: 'Improving', color: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent', icon: <TrendingUp className="w-4 h-4" aria-hidden="true" /> },
  declining: { label: 'Declining', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', icon: <TrendingDown className="w-4 h-4" aria-hidden="true" /> },
  erratic: { label: 'Erratic', color: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg', icon: <AlertTriangle className="w-4 h-4" aria-hidden="true" /> },
};

function humanize(s: string): string {
  if (!s) return '';
  const spaced = s.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function CashFlowPage() {
  useDocumentTitle('Cash flow forecaster');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [forecastId, setForecastId] = useState<number | null>(null);

  // Portfolio summary
  const { data: summaryData, isLoading: summaryLoading, isError: summaryError, error: summaryErrorObj, isFetching: summaryFetching, refetch: refetchSummary } = useQuery({
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
      toast({
        title: "Couldn't generate forecast",
        description: `${err.message} — your existing forecast (if any) is unchanged. Try again in a moment.`,
        variant: 'destructive',
      });
    },
  });

  const summary = summaryData?.summary;
  const highRisk = highRiskData?.highRisk ?? [];
  const insights = insightsData?.insights ?? [];
  const accuracy = accuracyData?.comparison;

  const monthlyChartData = summary?.monthlyBreakdown?.map((m: any) => ({
    month: m.month,
    Income: Math.round(m.income),
    Expenses: Math.round(m.expenses),
    'Net cash flow': Math.round(m.net),
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
      <RequiredDisclaimer type="financial" />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="w-8 h-8 text-primary" aria-hidden="true" />
            Cash flow forecaster
          </h1>
          <p className="text-muted-foreground mt-1">
            12-month income and expense projections with payment health analysis and AI insights.
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="min-h-11"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {generateMutation.isPending ? 'Forecasting…' : 'Generate forecast'}
        </Button>
      </div>

      {/* Portfolio Cash Flow Health Banner */}
      {summary && cashFlowHealthPct !== null && (
        <section
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-4 ${monthlyNetCashFlow >= 0 ? "bg-acr-pos-soft border-acr-pos-soft dark:bg-acr-pos-soft/20 dark:border-acr-pos-soft" : "bg-acr-neg-soft border-acr-neg-soft dark:bg-acr-neg-soft/20 dark:border-acr-neg-soft"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield
                className={`w-4 h-4 ${monthlyNetCashFlow >= 0 ? "text-acr-pos" : "text-acr-neg"}`}
                aria-hidden="true"
              />
              <span className="font-semibold text-sm">Portfolio cash flow health</span>
            </div>
            <div className="flex items-center gap-3">
              {coverageRatio !== null && (
                <span className="text-xs text-muted-foreground">
                  Coverage ratio: <span className="font-bold text-foreground tabular-nums">{coverageRatio.toFixed(2)}x</span>
                </span>
              )}
              {runwayMonths !== null && (
                <Badge variant="destructive" className="text-xs">
                  <span className="tabular-nums">{runwayMonths}</span> mo runway
                </Badge>
              )}
            </div>
          </div>
          <div
            className="w-full bg-background/60 rounded-full h-3 overflow-hidden"
            role="progressbar"
            aria-label="Portfolio cash flow health"
            aria-valuenow={Math.round(cashFlowHealthPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all duration-700 ${monthlyNetCashFlow >= 0 ? "bg-acr-pos" : "bg-acr-neg"}`}
              style={{ width: `${cashFlowHealthPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {monthlyNetCashFlow >= 0
              ? `Positive cash flow of ${formatDollar(monthlyNetCashFlow)}/mo · Your portfolio is generating surplus income.`
              : `Negative cash flow of ${formatDollar(Math.abs(monthlyNetCashFlow))}/mo · Expenses exceed income — review high-risk notes.`}
          </p>
        </section>
      )}

      {/* Portfolio KPIs */}
      {summary ? (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                <dt className="text-sm text-muted-foreground">Projected income</dt>
              </div>
              <dd className="text-2xl font-bold text-acr-pos tabular-nums">{formatDollar(summary.totalProjectedIncome)}</dd>
              <p className="text-xs text-muted-foreground mt-0.5">Next 12 months</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                <dt className="text-sm text-muted-foreground">Projected expenses</dt>
              </div>
              <dd className="text-2xl font-bold text-acr-neg tabular-nums">{formatDollar(summary.totalProjectedExpenses)}</dd>
              <p className="text-xs text-muted-foreground mt-0.5">Next 12 months</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-primary" aria-hidden="true" />
                <dt className="text-sm text-muted-foreground">Net cash flow</dt>
              </div>
              <dd className={`text-2xl font-bold tabular-nums ${summary.netCashFlow >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                {formatDollar(summary.netCashFlow)}
              </dd>
              <p className="text-xs text-muted-foreground mt-0.5">Next 12 months</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                <dt className="text-sm text-muted-foreground">High-risk notes</dt>
              </div>
              <dd className="text-2xl font-bold text-acr-warn tabular-nums">{summary.highRiskNoteCount}</dd>
              <p className="text-xs text-muted-foreground mt-0.5">
                Avg risk score: <span className="tabular-nums">{Math.round(summary.averagePaymentRiskScore * 100)}%</span>
              </p>
            </CardContent>
          </Card>
        </dl>
      ) : summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-4 w-28" announce={i === 0} announceText="Loading cash flow forecast" />
                <Skeleton className="h-8 w-24" announce={false} />
                <Skeleton className="h-3 w-20" announce={false} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summaryError ? (
        <QueryErrorState
          error={summaryErrorObj as Error}
          onRetry={() => refetchSummary()}
          isRetrying={summaryFetching}
          title="Couldn't load cash flow forecast"
          description="Your forecast data is unchanged. Retry, or generate a new forecast above."
          testId="cash-flow-summary-error"
        />
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" aria-hidden="true" />
          <p className="text-lg font-medium">No forecast data yet.</p>
          <p className="text-sm mt-1">Click "Generate forecast" to create your first cash flow projection.</p>
        </div>
      )}

      {summary && (
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Portfolio timeline</TabsTrigger>
            <TabsTrigger value="breakdown">Income breakdown</TabsTrigger>
            <TabsTrigger value="risk">
              High-risk notes (<span className="tabular-nums">{highRisk.length}</span>)
            </TabsTrigger>
            {insights.length > 0 && (
              <TabsTrigger value="insights">
                AI insights (<span className="tabular-nums">{insights.length}</span>)
              </TabsTrigger>
            )}
            {accuracy && <TabsTrigger value="accuracy">Forecast accuracy</TabsTrigger>}
          </TabsList>

          {/* ── TIMELINE ── */}
          <TabsContent value="timeline" className="space-y-4">
            {/* 24-month portfolio income timeline with uncertainty band */}
            {portfolioTimelineData?.timeline && portfolioTimelineData.timeline.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>24-month income projection</CardTitle>
                  <CardDescription>
                    Expected monthly income across all active notes and owned properties.
                    Shaded band shows uncertainty range. Balloon payments are highlighted.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    role="img"
                    aria-label={`24-month income projection across ${portfolioTimelineData.timeline.length} months. Balloon-payment months are highlighted; band represents ±25% uncertainty.`}
                  >
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={portfolioTimelineData.timeline} accessibilityLayer>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                      <Tooltip
                        formatter={((v: any, name: string) => [
                          formatDollar(v),
                          name === 'incomeLow' ? 'Low estimate' :
                          name === 'incomeHigh' ? 'High estimate' : 'Expected income',
                        ]) as any}
                        labelFormatter={((label: string) => {
                          const row = portfolioTimelineData.timeline.find((r: any) => r.month === label);
                          return row?.isBalloon ? `${label} — balloon payment due` : label;
                        }) as any}
                      />
                      {/* Flat 5%-opacity band between low + high — no gradient. */}
                      <Area
                        type="monotone"
                        dataKey="incomeHigh"
                        stroke="none"
                        fill="var(--acr-brand)"
                        fillOpacity={0.05}
                        legendType="none"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="incomeLow"
                        stroke="none"
                        fill="var(--acr-bg, white)"
                        fillOpacity={1}
                        legendType="none"
                        isAnimationActive={false}
                      />
                      {/* 1px solid stroke for income — no fill. */}
                      <Area
                        type="monotone"
                        dataKey="income"
                        stroke="var(--acr-brand)"
                        strokeWidth={1}
                        fill="none"
                        name="Expected income"
                        dot={false}
                        activeDot={{ r: 3, fill: 'var(--acr-brand)' }}
                        isAnimationActive={false}
                      />
                      {/* Balloon months — single small triangle below the x-axis.
                          Recharts renders dots in the chart plane, so we paint a
                          ▲ glyph just under each balloon month using the active
                          x-coordinate; the tooltip already names the amount. */}
                      <Area
                        type="monotone"
                        dataKey="incomeLow"
                        stroke="none"
                        fill="none"
                        legendType="none"
                        isAnimationActive={false}
                        dot={(props: any) => {
                          const { cx, payload, key } = props;
                          if (!payload?.isBalloon) return <g key={key} />;
                          const ax: number = typeof cx === 'number' ? cx : 0;
                          return (
                            <g
                              key={key}
                              role="img"
                              aria-label={`Balloon payment month ${payload.month}`}
                            >
                              <polygon
                                points={`${ax - 4},290 ${ax + 4},290 ${ax},283`}
                                fill="var(--acr-warn)"
                              />
                            </g>
                          );
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <span aria-hidden="true">▲</span>
                    <span className="ml-1">Triangles below the axis mark balloon-payment months. Band represents ±25% uncertainty.</span>
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Monthly cash flow projection</CardTitle>
                <CardDescription>Projected income, expenses, and net cash flow over the next 12 months.</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  role="img"
                  aria-label={`Monthly income vs. expenses bar chart over ${monthlyChartData.length} months. Total income ${formatDollar(monthlyChartData.reduce((s: number, m: any) => s + (m.Income || 0), 0))}, total expenses ${formatDollar(monthlyChartData.reduce((s: number, m: any) => s + (m.Expenses || 0), 0))}.`}
                >
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                      <Tooltip formatter={((v: any, name: string) => [formatDollar(v), name]) as any} />
                      <Legend />
                      <ReferenceLine y={0} stroke={chartColor(3)} />
                      <Bar dataKey="Income" fill={chartColor(0)} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Expenses" fill={chartColor(4)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Net cash flow area */}
                <div
                  role="img"
                  aria-label={`Net cash flow area chart over ${monthlyChartData.length} months. Total net ${formatDollar(monthlyChartData.reduce((s: number, m: any) => s + (m['Net cash flow'] || 0), 0))}.`}
                  className="mt-4"
                >
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                      <Tooltip formatter={(v: any) => [formatDollar(v), 'Net cash flow']} />
                      <ReferenceLine y={0} stroke={chartColor(3)} />
                      <Area
                        type="monotone"
                        dataKey="Net cash flow"
                        stroke={chartColor(5)}
                        fill={chartColor(6)}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── BREAKDOWN ── */}
          <TabsContent value="breakdown" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Income by source</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-3" aria-label="Income by source">
                    {incomeBreakdown.map((item) => {
                      const pct = (item.value / summary.totalProjectedIncome) * 100;
                      const label = humanize(item.name);
                      return (
                        <li key={item.name} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span>{label}</span>
                            <span className="font-medium tabular-nums">{formatDollar(item.value)}</span>
                          </div>
                          <Progress
                            value={pct}
                            className="h-2"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${label}: ${formatDollar(item.value)}, ${pct.toFixed(1)}% of projected income`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Expenses by category</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-3" aria-label="Expenses by category">
                    {Object.entries(summary.expensesByCategory).map(([cat, amt]: [string, any]) => {
                      const pct = (amt / summary.totalProjectedExpenses) * 100;
                      const label = humanize(cat);
                      return (
                        <li key={cat} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span>{label}</span>
                            <span className="font-medium text-acr-neg tabular-nums">{formatDollar(amt)}</span>
                          </div>
                          <Progress
                            value={pct}
                            className="h-2"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${label}: ${formatDollar(amt)}, ${pct.toFixed(1)}% of projected expenses`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── HIGH-RISK NOTES ── */}
          <TabsContent value="risk" className="space-y-4">
            {highRisk.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground" role="status">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
                <p>No high-risk notes detected. Portfolio looks healthy.</p>
              </div>
            ) : (
              <ul className="space-y-4" aria-label="High-risk notes">
                {highRisk.map(({ note, riskScore, riskFactors }: any) => (
                  <li key={note.id}>
                    <Card className="border-acr-warn-soft dark:border-acr-warn-soft">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">Note <span className="tabular-nums">#{note.id}</span></p>
                              <Badge
                                className="bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn"
                                aria-label={`Risk score ${(riskScore * 100).toFixed(0)} percent`}
                              >
                                Risk: <span className="tabular-nums ml-1">{(riskScore * 100).toFixed(0)}%</span>
                              </Badge>
                              {note.paymentPattern && (
                                <Badge className={PATTERN_STYLES[note.paymentPattern]?.color || ''}>
                                  {PATTERN_STYLES[note.paymentPattern]?.icon}
                                  <span className="ml-1">{PATTERN_STYLES[note.paymentPattern]?.label || note.paymentPattern}</span>
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Balance: <span className="tabular-nums">{note.balance ? formatDollar(note.balance) : '—'}</span> ·
                              Rate: <span className="tabular-nums">{note.interestRate ?? '—'}%</span>
                            </p>
                          </div>
                        </div>

                        {riskFactors?.length > 0 && (
                          <ul className="mt-3 space-y-2" aria-label="Risk factors">
                            {riskFactors.slice(0, 3).map((f: any, i: number) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <span className={`shrink-0 font-medium ${IMPACT_STYLES[f.impact]}`}>
                                  {f.impact.toUpperCase()}
                                </span>
                                <span className="text-muted-foreground">{f.factor}</span>
                                {f.mitigation && (
                                  <span className="text-xs text-acr-pos dark:text-acr-pos ml-1">
                                    → {f.mitigation}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ── INSIGHTS ── */}
          {insights.length > 0 && (
            <TabsContent value="insights" className="space-y-4">
              <ul className="space-y-4" aria-label="AI insights">
                {insights.map((insight: any, i: number) => (
                  <li key={i}>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start gap-3">
                          <div
                            aria-hidden="true"
                            className={`p-1.5 rounded ${insight.urgency === 'critical' || insight.urgency === 'high' ? 'bg-acr-neg-soft' : 'bg-acr-accent'}`}
                          >
                            <Zap className={`w-4 h-4 ${insight.urgency === 'critical' || insight.urgency === 'high' ? 'text-acr-neg' : 'text-acr-accent'}`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={URGENCY_STYLES[insight.urgency] || ''}>
                                {humanize(insight.urgency)}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{humanize(insight.type ?? '')}</span>
                            </div>
                            <p className="text-sm">{insight.message}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}

          {/* ── ACCURACY ── */}
          {accuracy && (
            <TabsContent value="accuracy" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Forecast accuracy — last 6 months</CardTitle>
                  <CardDescription>
                    Overall accuracy: <span className="tabular-nums">{(accuracy.overallAccuracy * 100).toFixed(1)}%</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {accuracy.forecasts?.length > 0 ? (
                    <ul className="space-y-4" aria-label="Historical forecast comparisons">
                      {accuracy.forecasts.map((f: any) => (
                        <li key={f.forecastId} className="space-y-2 pb-4 border-b last:border-b-0">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Forecast <span className="tabular-nums">#{f.forecastId}</span></span>
                            <span className={`tabular-nums ${Math.abs(f.variancePercent) < 10 ? 'text-acr-pos' : 'text-acr-warn'}`}>
                              Income variance: {f.variancePercent.toFixed(1)}%
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <dt className="text-muted-foreground">Projected income</dt>
                              <dd className="font-medium tabular-nums">{formatDollar(f.projectedIncome)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Actual income</dt>
                              <dd className="font-medium tabular-nums">{formatDollar(f.actualIncome)}</dd>
                            </div>
                          </dl>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">No historical comparison data available yet.</p>
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
