import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { usd } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';

import {
  CHART_COLORS,
  chartColorVar,
  CHART_POS,
  CHART_NEG,
  CHART_WARN,
  CHART_GRID,
} from '@/lib/chart-colors';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { QueryErrorState } from '@/components/query-error-state';
import {
  TrendingUp,
  TrendingDown,
  BarChart2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Layers,
  DollarSign,
  Activity,
  Percent,
  Shield,
  FileDown,
  Info,
  SlidersHorizontal,
} from 'lucide-react';

const ACTION_STYLES: Record<string, { color: string; icon: JSX.Element }> = {
  sell: { color: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg', icon: <TrendingDown className="w-4 h-4" /> },
  hold: { color: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent', icon: <Shield className="w-4 h-4" /> },
  refinance: { color: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand', icon: <RefreshCw className="w-4 h-4" /> },
  develop: { color: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos', icon: <TrendingUp className="w-4 h-4" /> },
  subdivide: { color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', icon: <Layers className="w-4 h-4" /> },
};

// P1 money-precision: K/M compact bands kept for hero portfolio numbers (Monte
// Carlo dashboards prioritize readability of $1.2M/$5K outcomes over cents).
// Sub-$1K fall-through swapped to canonical usd(noCents); negative values
// route through usd via abs+sign-prefix so the canonical formatter stays at the
// boundary.
function formatDollar(n: number) {
  if (!Number.isFinite(n)) return '$0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${usd(abs, { noCents: true })}`;
}

/**
 * GET /portfolio-optimizer/simulations returns stored rows whose payload lives
 * under `row.results`. Rows written after the full-detail shape landed carry
 * results.scenarios/riskMetrics/timeline; older rows carry only the percentile
 * summary (portfolioValue/totalReturn/riskOfLoss). Normalize either into the rich
 * shape this dashboard renders — reconstructing the scenario cards from the
 * percentile fields when detailed scenarios are absent — so a reload never
 * crashes on a partially-shaped row. Returns undefined when there is no row.
 */
function normalizeSimulation(row: any) {
  if (!row) return undefined;
  const r = row.results ?? {};
  const scenarios = r.scenarios ?? ((r.portfolioValue && r.totalReturn) ? {
    pessimistic: { value: r.portfolioValue.p10 ?? 0, roi: r.totalReturn.p10 ?? 0 },
    base: { value: r.portfolioValue.p50 ?? 0, roi: r.totalReturn.p50 ?? 0 },
    optimistic: { value: r.portfolioValue.p90 ?? 0, roi: r.totalReturn.p90 ?? 0 },
  } : undefined);
  const riskMetrics = r.riskMetrics ?? (
    r.riskOfLoss != null ? { probabilityOfLoss: r.riskOfLoss } : undefined
  );
  return {
    ...row,
    scenarios,
    riskMetrics,
    timeline: row.timeline ?? r.timeline ?? [],
    summary: row.summary,
  };
}

const fmtPct1 = (v: unknown) => (Number.isFinite(v) ? `${(v as number).toFixed(1)}%` : '—');
const fmtMoneyOrDash = (v: unknown) => (Number.isFinite(v) ? formatDollar(v as number) : '—');

function MetricCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: JSX.Element }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums mt-0.5 m-0">{value}</dd>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground" aria-hidden="true">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Capital Stack Visualization ─────────────────────────────────────────────

function CapitalStackBar({ equity = 30, mezzanine = 20, seniorDebt = 50 }: { equity?: number; mezzanine?: number; seniorDebt?: number }) {
  const total = equity + mezzanine + seniorDebt;
  const ep = ((equity / total) * 100).toFixed(0);
  const mp = ((mezzanine / total) * 100).toFixed(0);
  const sp = ((seniorDebt / total) * 100).toFixed(0);
  return (
    <div className="space-y-2">
      <div className="flex h-8 rounded-card overflow-hidden">
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-acr-pos" style={{ width: `${ep}%` }}>Equity {ep}%</div>
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-acr-warn" style={{ width: `${mp}%` }}>Mezz {mp}%</div>
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-acr-accent" style={{ width: `${sp}%` }}>Sr Debt {sp}%</div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-acr-pos inline-block" />Equity</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-acr-warn inline-block" />Mezzanine</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-acr-accent inline-block" />Senior Debt</span>
      </div>
    </div>
  );
}

// ─── Recommendation Drill-Down Modal ─────────────────────────────────────────

function RecDrillDownModal({ rec }: { rec: any }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Show reasoning for this ${rec.recommendationType} recommendation`}>
          <Info className="w-3 h-3 mr-1" aria-hidden="true" /> Why?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{rec.recommendationType} recommendation</DialogTitle>
          <DialogDescription>Supporting analysis for this AI recommendation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm font-medium mb-1">Reasoning</p>
            <p className="text-sm text-muted-foreground">{rec.reasoning}</p>
          </div>
          {rec.expectedImpact && (
            <div>
              <p className="text-sm font-medium mb-2">Expected impact</p>
              <dl className="grid grid-cols-2 gap-3 text-sm m-0">
                {rec.expectedImpact.valueChange !== 0 && (
                  <div className="p-2 bg-muted/40 rounded">
                    <dt className="text-xs text-muted-foreground">Value change</dt>
                    <dd className={`font-bold tabular-nums m-0 ${rec.expectedImpact.valueChange > 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                      {rec.expectedImpact.valueChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.valueChange)}
                    </dd>
                  </div>
                )}
                {rec.expectedImpact.cashFlowChange !== 0 && (
                  <div className="p-2 bg-muted/40 rounded">
                    <dt className="text-xs text-muted-foreground">Cash flow/yr</dt>
                    <dd className={`font-bold tabular-nums m-0 ${rec.expectedImpact.cashFlowChange > 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                      {rec.expectedImpact.cashFlowChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.cashFlowChange)}
                    </dd>
                  </div>
                )}
                {rec.expectedImpact.riskChange !== undefined && (
                  <div className="p-2 bg-muted/40 rounded">
                    <dt className="text-xs text-muted-foreground">Risk change</dt>
                    <dd className="font-bold tabular-nums m-0">{rec.expectedImpact.riskChange > 0 ? '+' : ''}{rec.expectedImpact.riskChange?.toFixed(1)}%</dd>
                  </div>
                )}
                {rec.expectedImpact.liquidityChange !== undefined && (
                  <div className="p-2 bg-muted/40 rounded">
                    <dt className="text-xs text-muted-foreground">Liquidity</dt>
                    <dd className="font-bold tabular-nums m-0">{rec.expectedImpact.liquidityChange > 0 ? '+' : ''}{rec.expectedImpact.liquidityChange?.toFixed(1)}%</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div>
            <p className="text-sm font-medium mb-1">Confidence</p>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 h-2"
                role="progressbar"
                aria-label="Recommendation confidence"
                aria-valuenow={rec.confidence}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <Progress value={rec.confidence} className="flex-1 h-2" aria-hidden="true" />
              </div>
              <span className="text-sm tabular-nums">{rec.confidence}%</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Priority score</p>
            <Badge variant="outline" className="tabular-nums" aria-label={`Priority ${rec.priority} out of 10`}>{rec.priority}/10</Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PortfolioOptimizerPage() {
  useDocumentTitle('Portfolio optimizer');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yearsForward, setYearsForward] = useState('5');

  // Custom stress test state
  const [customScenario, setCustomScenario] = useState({ priceChange: '-10', liquidityChange: '-20', label: 'Custom' });

  const {
    data: metricsData,
    isLoading: metricsLoading,
    isError: metricsIsError,
    error: metricsError,
    refetch: refetchMetrics,
    isRefetching: metricsRefetching,
  } = useQuery({
    queryKey: ['portfolio-optimizer', 'metrics'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/metrics', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: Couldn't load portfolio metrics`);
      return res.json();
    },
  });

  const {
    data: simulationsData,
    isLoading: simsLoading,
    isError: simsIsError,
    error: simsError,
    refetch: refetchSims,
    isRefetching: simsRefetching,
  } = useQuery({
    queryKey: ['portfolio-optimizer', 'simulations'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/simulations', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: Couldn't load simulation results`);
      return res.json();
    },
  });

  const {
    data: recsData,
    isLoading: recsLoading,
    isError: recsIsError,
    error: recsError,
    refetch: refetchRecs,
    isRefetching: recsRefetching,
  } = useQuery({
    queryKey: ['portfolio-optimizer', 'recommendations'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/recommendations', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: Couldn't load recommendations`);
      return res.json();
    },
  });

  const { data: diversData } = useQuery({
    queryKey: ['portfolio-optimizer', 'diversification'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/diversification', { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: Couldn't load diversification analysis`);
      return res.json();
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/simulate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearsForward: parseInt(yearsForward), numSimulations: 10000 }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Simulation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Monte Carlo complete', description: '10,000 simulations run successfully.' });
      queryClient.invalidateQueries({ queryKey: ['portfolio-optimizer', 'simulations'] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't run simulation", description: `${err.message} — your prior simulation results are still available.`, variant: 'destructive' });
    },
  });

  const analyzeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearsForward: parseInt(yearsForward) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Analysis complete', description: 'Portfolio analysis and AI recommendations ready.' });
      queryClient.invalidateQueries({ queryKey: ['portfolio-optimizer'] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't run analysis", description: `${err.message} — your prior analysis is still available.`, variant: 'destructive' });
    },
  });

  const recStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/portfolio-optimizer/recommendations/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-optimizer', 'recommendations'] });
      toast({ title: `Recommendation ${vars.status}` });
    },
    onError: () => {
      toast({ title: "Couldn't update recommendation", description: "Its status is unchanged. Try again.", variant: 'destructive' });
    },
  });

  const metrics = metricsData?.metrics;
  const holdings = metricsData?.holdings ?? [];
  const latestSim = normalizeSimulation(simulationsData?.simulations?.[0]);
  const recommendations = recsData?.recommendations ?? [];
  const diversification = diversData?.diversification;

  // Build timeline chart data from latest simulation
  const timelineData = latestSim?.timeline?.map((t: any) => ({
    year: `Y${t.year}`,
    p10: Math.round(t.values.p10),
    p25: Math.round(t.values.p25),
    p50: Math.round(t.values.p50),
    p75: Math.round(t.values.p75),
    p90: Math.round(t.values.p90),
  })) ?? [];

  // Derived advanced metrics
  const sharpeRatio = metrics && latestSim ? (() => {
    const riskFreeRate = 0.045; // 4.5% T-bill
    const expectedReturn = latestSim.summary?.expectedReturn ?? metrics.expectedAnnualReturn ?? 0;
    const portfolioVol = latestSim.summary?.volatility ?? metrics.volatility ?? 0.15;
    return portfolioVol > 0 ? ((expectedReturn - riskFreeRate) / portfolioVol).toFixed(2) : null;
  })() : null;

  const maxDrawdown = latestSim?.summary?.worstCase
    ? (((metrics?.totalValue ?? 0) - (latestSim.summary.worstCase ?? 0)) / (metrics?.totalValue ?? 1) * 100).toFixed(1)
    : null;

  const calmarRatio = metrics?.expectedAnnualReturn && maxDrawdown
    ? ((metrics.expectedAnnualReturn * 100) / parseFloat(maxDrawdown)).toFixed(2)
    : null;

  // Efficient frontier approximation from percentile data
  const efficientFrontierData = timelineData.length > 0 ? [
    { risk: 5, return: timelineData[timelineData.length - 1]?.p10 ?? 0, label: "Conservative" },
    { risk: 12, return: timelineData[timelineData.length - 1]?.p25 ?? 0, label: "Moderate" },
    { risk: 18, return: timelineData[timelineData.length - 1]?.p50 ?? 0, label: "Current" },
    { risk: 25, return: timelineData[timelineData.length - 1]?.p75 ?? 0, label: "Growth" },
    { risk: 35, return: timelineData[timelineData.length - 1]?.p90 ?? 0, label: "Aggressive" },
  ].map(d => ({ ...d, return: Math.round(d.return / 1000) })) : [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart2 className="w-8 h-8 text-primary" aria-hidden="true" />
            Portfolio optimizer
          </h1>
          <p className="text-muted-foreground mt-1">
            Monte Carlo simulation, diversification analysis, and optimization recommendations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            aria-label="Export portfolio report as PDF"
            onClick={async () => {
              try {
                const res = await fetch('/api/portfolio-optimizer/report/pdf', { credentials: 'include' });
                if (!res.ok) {
                  toast({ title: "Couldn't export PDF", description: 'PDF export endpoint is not configured. Check the system status or try again later.', variant: 'destructive' });
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'portfolio-report.pdf';
                a.click();
                toast({ title: 'PDF exported', description: 'Portfolio report downloaded.' });
              } catch {
                toast({ title: "Couldn't export PDF", description: 'Network error generating the report. Try again in a moment.', variant: 'destructive' });
              }
            }}
          >
            <FileDown className="w-4 h-4 mr-2" aria-hidden="true" />
            Export PDF
          </Button>
          <Select value={yearsForward} onValueChange={setYearsForward}>
            <SelectTrigger className="w-28" aria-label="Forecast horizon in years">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 years</SelectItem>
              <SelectItem value="5">5 years</SelectItem>
              <SelectItem value="10">10 years</SelectItem>
              <SelectItem value="20">20 years</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => analyzeAllMutation.mutate()}
            disabled={analyzeAllMutation.isPending}
            aria-label="Run full portfolio analysis"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${analyzeAllMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {analyzeAllMutation.isPending ? 'Analyzing…' : 'Run full analysis'}
          </Button>
        </div>
      </div>

      {/* Metrics row */}
      {metricsLoading && (
        <div className="space-y-6" aria-busy="true" aria-label="Loading portfolio metrics">
          {/* Shaped like the metric cards + tab content this replaces. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-5 space-y-2">
                  <Skeleton className="h-4 w-24" announce={i === 0} announceText="Loading portfolio metrics" />
                  <Skeleton className="h-8 w-28" announce={false} />
                  <Skeleton className="h-3 w-32" announce={false} />
                </CardContent>
              </Card>
            ))}
          </div>
          <Skeleton className="h-10 w-full max-w-2xl" announce={false} />
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-64" announce={false} />
              <Skeleton className="h-4 w-80 max-w-full" announce={false} />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" announce={false} />
            </CardContent>
          </Card>
        </div>
      )}

      {metricsIsError && !metricsLoading && (
        <QueryErrorState
          error={metricsError as Error}
          onRetry={() => refetchMetrics()}
          isRetrying={metricsRefetching}
          title="Couldn't load your portfolio"
        />
      )}

      {metrics && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 m-0">
          <MetricCard
            label="Portfolio value"
            value={formatDollar(metrics.totalValue)}
            sub={`${metrics.totalProperties} properties · ${Math.round(metrics.totalAcres).toLocaleString()} acres`}
            icon={<DollarSign className="w-5 h-5" aria-hidden="true" />}
          />
          <MetricCard
            label="Annual cash flow"
            value={formatDollar(metrics.totalCashFlow)}
            sub={
              metrics.totalValue > 0
                ? `${((metrics.totalCashFlow / metrics.totalValue) * 100).toFixed(1)}% yield`
                : "No valuation yet"
            }
            icon={<Activity className="w-5 h-5" aria-hidden="true" />}
          />
          {/* avgAppreciation / diversificationScore are NULL until holdings
              carry valuations — the API is honest about missing data, so the
              cards must be too (this crashed the whole page via ErrorBoundary
              on sparse portfolios, 2026-07-11 sweep). */}
          <MetricCard
            label="Avg appreciation"
            value={metrics.avgAppreciation != null ? `${metrics.avgAppreciation.toFixed(1)}%` : "—"}
            sub="Annual weighted avg"
            icon={<TrendingUp className="w-5 h-5" aria-hidden="true" />}
          />
          <MetricCard
            label="Sharpe ratio"
            value={metrics.sharpeRatio != null ? metrics.sharpeRatio.toFixed(2) : "—"}
            sub={
              metrics.diversificationScore != null
                ? `Diversification: ${Math.round(metrics.diversificationScore)}/100`
                : "Diversification: —"
            }
            icon={<Percent className="w-5 h-5" aria-hidden="true" />}
          />
        </dl>
      )}

      {!metrics && !metricsLoading && !metricsIsError && (
        <EmptyState
          icon={BarChart2}
          headline="No portfolio holdings yet"
          subtitle='Mark a property as "owned" and the optimizer takes it from there — Monte Carlo projections, diversification scoring, and rebalancing recommendations.'
          cta={{
            label: 'Add your first property',
            href: '/properties',
            'data-testid': 'optimizer-empty-add-property',
          }}
          testId="optimizer-empty-state"
        />
      )}

      {/* Advanced Risk Metrics Row */}
      {metrics && (sharpeRatio || maxDrawdown || calmarRatio) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {sharpeRatio && (
            <Card className={`${parseFloat(sharpeRatio) >= 1 ? "border-acr-pos-soft bg-acr-pos-soft/30 dark:border-acr-pos-soft dark:bg-acr-pos-soft/10" : parseFloat(sharpeRatio) >= 0.5 ? "border-acr-warn-soft bg-acr-warn-soft/30" : "border-acr-neg-soft bg-acr-neg-soft/30"}`}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                <p className={`text-2xl font-bold ${parseFloat(sharpeRatio) >= 1 ? "text-acr-pos" : parseFloat(sharpeRatio) >= 0.5 ? "text-acr-warn" : "text-acr-neg"}`}>{sharpeRatio}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {parseFloat(sharpeRatio) >= 1 ? "Excellent risk-adj return" : parseFloat(sharpeRatio) >= 0.5 ? "Acceptable" : "Below threshold"}
                </p>
              </CardContent>
            </Card>
          )}
          {maxDrawdown && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Max Drawdown</p>
                <p className="text-2xl font-bold text-acr-neg">-{maxDrawdown}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Worst-case loss scenario</p>
              </CardContent>
            </Card>
          )}
          {calmarRatio && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Calmar Ratio</p>
                <p className="text-2xl font-bold">{calmarRatio}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Return / max drawdown</p>
              </CardContent>
            </Card>
          )}
          {metrics.diversificationScore != null && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Diversification</p>
                <div className="flex items-end gap-1">
                  <p className="text-2xl font-bold">{Math.round(metrics.diversificationScore)}</p>
                  <span className="text-sm text-muted-foreground mb-0.5">/100</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                  <div className={`h-full rounded-full ${metrics.diversificationScore >= 70 ? "bg-acr-pos" : metrics.diversificationScore >= 40 ? "bg-acr-warn" : "bg-acr-neg"}`}
                    style={{ width: `${metrics.diversificationScore}%` }} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {metrics && (
        <Tabs defaultValue="monte-carlo">
          <TabsList className="flex-wrap">
            <TabsTrigger value="monte-carlo">Monte Carlo</TabsTrigger>
            {efficientFrontierData.length > 0 && <TabsTrigger value="efficient-frontier">Efficient Frontier</TabsTrigger>}
            <TabsTrigger value="diversification">Diversification</TabsTrigger>
            <TabsTrigger value="stress-test">Stress Test</TabsTrigger>
            <TabsTrigger value="recommendations">AI Recommendations ({recommendations.length})</TabsTrigger>
            <TabsTrigger value="capital-stack">Capital Stack</TabsTrigger>
            <TabsTrigger value="attribution">Attribution</TabsTrigger>
            <TabsTrigger value="comparison">Concentration</TabsTrigger>
          </TabsList>

          {/* ── MONTE CARLO ── */}
          <TabsContent value="monte-carlo" className="space-y-6">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => simulateMutation.mutate()}
                disabled={simulateMutation.isPending}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${simulateMutation.isPending ? 'animate-spin' : ''}`} />
                {simulateMutation.isPending ? 'Running 10,000 simulations…' : 'Run Monte Carlo'}
              </Button>
              {latestSim && (
                <span className="text-sm text-muted-foreground">
                  Last run: {format(new Date(latestSim.createdAt), 'MMM d, yyyy')}
                </span>
              )}
            </div>

            {simsLoading && (
              <div className="space-y-6" aria-busy="true" aria-label="Loading simulation results">
                {/* Shaped like the scenario cards + timeline chart below. */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i}>
                      <CardHeader className="pb-2">
                        <Skeleton className="h-4 w-36" announce={i === 0} announceText="Loading simulation results" />
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <Skeleton className="h-8 w-24" announce={false} />
                        <Skeleton className="h-4 w-20" announce={false} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card>
                  <CardHeader>
                    <Skeleton className="h-5 w-72 max-w-full" announce={false} />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-72 w-full" announce={false} />
                  </CardContent>
                </Card>
              </div>
            )}

            {simsIsError && !simsLoading && (
              <QueryErrorState
                error={simsError as Error}
                onRetry={() => refetchSims()}
                isRetrying={simsRefetching}
                title="Couldn't load simulation results"
                compact
              />
            )}

            {!simsLoading && !simsIsError && (latestSim ? (
              <>
                {/* Scenario summary */}
                {latestSim.scenarios && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-acr-neg-soft dark:border-acr-neg-soft">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-acr-neg dark:text-acr-neg">Pessimistic (10th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.pessimistic.value)}</div>
                      <div className="text-sm text-muted-foreground">{fmtPct1(latestSim.scenarios.pessimistic.roi)} ROI</div>
                    </CardContent>
                  </Card>
                  <Card className="border-primary dark:border-primary/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-primary">Base Case (50th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.base.value)}</div>
                      <div className="text-sm text-muted-foreground">{fmtPct1(latestSim.scenarios.base.roi)} ROI</div>
                    </CardContent>
                  </Card>
                  <Card className="border-acr-pos-soft dark:border-acr-pos-soft">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-acr-pos dark:text-acr-pos">Optimistic (90th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.optimistic.value)}</div>
                      <div className="text-sm text-muted-foreground">{fmtPct1(latestSim.scenarios.optimistic.roi)} ROI</div>
                    </CardContent>
                  </Card>
                </div>
                )}

                {/* Timeline chart */}
                {timelineData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Portfolio Value Distribution Over Time</CardTitle>
                      <CardDescription>
                        Shaded bands show 10th–90th percentile range from 10,000 Monte Carlo simulations
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div role="img" aria-label={`Portfolio value distribution over ${timelineData.length} years with 10th–90th percentile bands from Monte Carlo simulation`}>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData} margin={{ top: 10, right: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                          <XAxis dataKey="year" />
                          <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                          <Tooltip
                            formatter={((v: any, name: string) => [formatDollar(v), name.replace('p', 'P').replace(/(\d+)/, '$1th %ile')]) as any}
                          />
                          <Legend />
                          {/* Percentile fan: one themed color per band, translucent
                              fills so overlapping bands read as a distribution. */}
                          <Area type="monotone" dataKey="p90" stackId="a" stroke={chartColorVar(0)} fill={chartColorVar(0)} fillOpacity={0.12} name="p90" />
                          <Area type="monotone" dataKey="p75" stackId="b" stroke={chartColorVar(1)} fill={chartColorVar(1)} fillOpacity={0.16} name="p75" />
                          <Area type="monotone" dataKey="p50" stackId="c" stroke={chartColorVar(2)} fill={chartColorVar(2)} fillOpacity={0.2} name="p50" strokeWidth={2} />
                          <Area type="monotone" dataKey="p25" stackId="d" stroke={chartColorVar(3)} fill={chartColorVar(3)} fillOpacity={0.16} name="p25" />
                          <Area type="monotone" dataKey="p10" stackId="e" stroke={chartColorVar(4)} fill={chartColorVar(4)} fillOpacity={0.12} name="p10" />
                        </AreaChart>
                      </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Risk metrics */}
                {latestSim.riskMetrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Value at Risk (95%)</p>
                      <p className="text-xl font-bold text-acr-neg mt-1">
                        {fmtMoneyOrDash(latestSim.riskMetrics.valueAtRisk95)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Expected Shortfall</p>
                      <p className="text-xl font-bold text-acr-warn mt-1">
                        {fmtMoneyOrDash(latestSim.riskMetrics.expectedShortfall)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Probability of Loss</p>
                      <p className="text-xl font-bold mt-1">
                        {fmtPct1(latestSim.riskMetrics.probabilityOfLoss)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Max Drawdown</p>
                      <p className="text-xl font-bold text-acr-neg mt-1">
                        {fmtPct1(latestSim.riskMetrics.maxDrawdown)}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                )}
              </>
            ) : (
              <EmptyState
                icon={Activity}
                headline="No simulation data yet"
                subtitle="Run Monte Carlo to project this portfolio forward — 10,000 simulated paths produce percentile bands, value-at-risk, and drawdown estimates."
                cta={{
                  label: simulateMutation.isPending ? 'Running simulations…' : 'Run Monte Carlo',
                  onClick: () => simulateMutation.mutate(),
                  'data-testid': 'optimizer-empty-simulate',
                }}
                actionIcon={RefreshCw}
                testId="optimizer-sims-empty"
              />
            ))}
          </TabsContent>

          {/* ── EFFICIENT FRONTIER ── */}
          {efficientFrontierData.length > 0 && (
            <TabsContent value="efficient-frontier" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SlidersHorizontal className="w-5 h-5 text-primary" />
                    Efficient Frontier — Risk vs. Return
                  </CardTitle>
                  <CardDescription>
                    Each point represents a portfolio allocation strategy. The curve shows the maximum return achievable at each risk level based on your Monte Carlo simulation.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="h-72"
                    role="img"
                    aria-label={`Efficient frontier risk vs return for ${efficientFrontierData.length} portfolio strategies`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={efficientFrontierData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" tickFormatter={(v) => `$${v}K`} tick={{ fontSize: 11 }} />
                        <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip formatter={(v: any) => [`$${v}K projected`, "Portfolio Value"]} />
                        <Bar dataKey="return" radius={[0, 4, 4, 0]}>
                          {efficientFrontierData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.label === "Current" ? "hsl(var(--primary))" : `hsl(var(--primary) / ${0.4 + index * 0.15})`}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {sharpeRatio && (
                      <div className="rounded-card border p-3 text-center">
                        <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                        <p className="text-xl font-bold text-primary">{sharpeRatio}</p>
                        <p className="text-xs text-muted-foreground">risk-adj return</p>
                      </div>
                    )}
                    {maxDrawdown && (
                      <div className="rounded-card border p-3 text-center">
                        <p className="text-xs text-muted-foreground">Max Drawdown</p>
                        <p className="text-xl font-bold text-acr-neg">-{maxDrawdown}%</p>
                        <p className="text-xs text-muted-foreground">worst scenario</p>
                      </div>
                    )}
                    {calmarRatio && (
                      <div className="rounded-card border p-3 text-center">
                        <p className="text-xs text-muted-foreground">Calmar Ratio</p>
                        <p className="text-xl font-bold">{calmarRatio}</p>
                        <p className="text-xs text-muted-foreground">return/drawdown</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 p-3 bg-primary/5 rounded-card border border-primary/10">
                    <p className="text-xs font-medium flex items-center gap-1.5 mb-1">
                      <Info className="w-3.5 h-3.5 text-primary" />
                      Interpretation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {sharpeRatio && parseFloat(sharpeRatio) >= 1
                        ? `Your Sharpe ratio of ${sharpeRatio} indicates strong risk-adjusted returns. Your current portfolio is well-positioned on the efficient frontier.`
                        : `A Sharpe ratio below 1 suggests room to improve risk-adjusted returns. Consider the AI recommendations to rebalance toward higher-quality holdings.`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── DIVERSIFICATION ── */}
          <TabsContent value="diversification" className="space-y-6">
            {diversification ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* By State */}
                  <Card>
                    <CardHeader>
                      <CardTitle>By State</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div role="img" aria-label={`Portfolio distribution by state across ${diversification.byState.length} states: ${diversification.byState.map((s: any) => `${s.state} ${s.percentage.toFixed(0)}%`).join(", ")}`}>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={diversification.byState}
                            dataKey="percentage"
                            nameKey="state"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            label={({ state, percentage }: any) => `${state} ${percentage.toFixed(0)}%`}
                          >
                            {diversification.byState.map((_: any, i: number) => (
                              <Cell key={i} fill={chartColorVar(i)} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any) => [`${v.toFixed(1)}%`, 'Share']} />
                        </PieChart>
                      </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* By Property Type */}
                  <Card>
                    <CardHeader>
                      <CardTitle>By Property Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {diversification.byPropertyType?.map(({ type, percentage }: any) => (
                          <div key={type} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span>{type || 'Unclassified'}</span>
                              <span className="text-muted-foreground">{percentage.toFixed(1)}%</span>
                            </div>
                            <Progress value={percentage} className="h-2" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* By Acre Size */}
                  <Card>
                    <CardHeader>
                      <CardTitle>By Acreage Range</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div role="img" aria-label={`Portfolio distribution by acreage range across ${diversification.byAcreSize.length} buckets`}>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={diversification.byAcreSize}>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
                          <Tooltip formatter={(v: any) => [`${v.toFixed(1)}%`, 'Share']} />
                          <Bar dataKey="percentage" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Concentration score */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Diversification Score</CardTitle>
                      <CardDescription>100 = perfectly diversified</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="text-5xl font-bold text-primary">
                          {Math.round(diversification.concentrationScore)}
                        </div>
                        <div className="text-sm text-muted-foreground">/ 100</div>
                      </div>
                      <Progress value={diversification.concentrationScore} className="h-3" />

                      {diversification.topRisks?.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <p className="text-sm font-medium text-acr-warn dark:text-acr-warn flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Top Concentration Risks
                          </p>
                          {diversification.topRisks.map((r: string, i: number) => (
                            <p key={i} className="text-sm text-muted-foreground">• {r}</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <EmptyState
                icon={Layers}
                headline="No diversification data yet"
                subtitle="Run the full analysis to break your holdings down by state, property type, and acreage — and get a concentration-risk score."
                cta={{
                  label: analyzeAllMutation.isPending ? 'Analyzing…' : 'Run full analysis',
                  onClick: () => analyzeAllMutation.mutate(),
                  'data-testid': 'optimizer-diversification-analyze',
                }}
                actionIcon={RefreshCw}
                testId="optimizer-diversification-empty"
              />
            )}
          </TabsContent>

          {/* ── RECOMMENDATIONS ── */}
          <TabsContent value="recommendations" className="space-y-4">
            {recsLoading && (
              <div className="space-y-4" aria-busy="true" aria-label="Loading recommendations">
                {/* Shaped like the recommendation cards below. */}
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-4">
                        <Skeleton className="h-5 w-5 rounded-full shrink-0 mt-0.5" announce={i === 0} announceText="Loading recommendations" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-5 w-48 max-w-full" announce={false} />
                          <Skeleton className="h-4 w-full" announce={false} />
                          <Skeleton className="h-4 w-2/3" announce={false} />
                        </div>
                        <Skeleton className="h-9 w-24 shrink-0" announce={false} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {recsIsError && !recsLoading && (
              <QueryErrorState
                error={recsError as Error}
                onRetry={() => refetchRecs()}
                isRetrying={recsRefetching}
                title="Couldn't load recommendations"
                compact
              />
            )}

            {!recsLoading && !recsIsError && recommendations.length === 0 && (
              <EmptyState
                icon={CheckCircle}
                headline="No pending recommendations"
                subtitle="Run the full analysis and the optimizer will propose sell / hold / refinance moves ranked by priority and confidence."
                cta={{
                  label: analyzeAllMutation.isPending ? 'Analyzing…' : 'Run full analysis',
                  onClick: () => analyzeAllMutation.mutate(),
                  'data-testid': 'optimizer-recs-analyze',
                }}
                actionIcon={RefreshCw}
                testId="optimizer-recs-empty"
              />
            )}

            {recommendations.map((rec: any) => {
              const style = ACTION_STYLES[rec.recommendationType] || ACTION_STYLES.hold;
              return (
                <Card key={rec.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 mt-0.5">{style.icon}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={style.color + ' capitalize text-xs'}>
                            {rec.recommendationType}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Priority {rec.priority}/10 · {rec.confidence}% confidence
                          </span>
                        </div>
                        <p className="text-sm">{rec.reasoning}</p>
                        {rec.expectedImpact && (
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            {rec.expectedImpact.valueChange !== 0 && (
                              <span className={rec.expectedImpact.valueChange > 0 ? 'text-acr-pos' : 'text-acr-neg'}>
                                Value: {rec.expectedImpact.valueChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.valueChange)}
                              </span>
                            )}
                            {rec.expectedImpact.cashFlowChange !== 0 && (
                              <span className={rec.expectedImpact.cashFlowChange > 0 ? 'text-acr-pos' : 'text-acr-neg'}>
                                Cash flow: {rec.expectedImpact.cashFlowChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.cashFlowChange)}/yr
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <RecDrillDownModal rec={rec} />
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => recStatusMutation.mutate({ id: rec.id, status: 'approved' })}
                          disabled={recStatusMutation.isPending}
                        >
                          <ArrowRight className="w-3 h-3 mr-1" />
                          Act
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => recStatusMutation.mutate({ id: rec.id, status: 'rejected' })}
                          disabled={recStatusMutation.isPending}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          {/* ── STRESS TEST ── */}
          <TabsContent value="stress-test" className="space-y-6">
            <StressTestTab />
          </TabsContent>

          {/* ── CAPITAL STACK ── */}
          <TabsContent value="capital-stack" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Capital Stack Visualization</CardTitle>
                <CardDescription>Equity / Mezzanine / Senior Debt layers for your portfolio financing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <CapitalStackBar equity={30} mezzanine={15} seniorDebt={55} />
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 rounded-card bg-acr-pos-soft dark:bg-acr-pos-soft/20">
                    <p className="text-xs text-muted-foreground">Equity</p>
                    <p className="text-xl font-bold text-acr-pos">30%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Highest risk / return</p>
                  </div>
                  <div className="p-4 rounded-card bg-acr-warn-soft dark:bg-acr-warn-soft/20">
                    <p className="text-xs text-muted-foreground">Mezzanine</p>
                    <p className="text-xl font-bold text-acr-warn">15%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Bridge / mezz debt</p>
                  </div>
                  <div className="p-4 rounded-card bg-acr-accent dark:bg-acr-accent/20">
                    <p className="text-xs text-muted-foreground">Senior Debt</p>
                    <p className="text-xl font-bold text-acr-accent">55%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Lowest risk / first lien</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Note: Capital stack percentages are illustrative based on portfolio leverage assumptions. Adjust in settings.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PERFORMANCE ATTRIBUTION ── */}
          <TabsContent value="attribution" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Performance Attribution</CardTitle>
                <CardDescription>Which properties are driving portfolio returns</CardDescription>
              </CardHeader>
              <CardContent>
                {holdings.length > 0 ? (
                  <>
                  {/* Mobile: stacked holding cards — the 5-column attribution
                      table side-scrolls at phone widths. md+ keeps the table. */}
                  <ul className="md:hidden divide-y divide-border" data-testid="list-attribution-mobile">
                    {holdings.map((h: any, i: number) => (
                      <li key={i} className="py-3" data-testid={`card-attribution-${i}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{h.address || h.name || `Property ${i + 1}`}</p>
                            <p className="text-xs text-muted-foreground">{h.county}, {h.state}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono font-medium tabular-nums">{formatDollar(h.currentValue || h.estimatedValue || 0)}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {metrics?.totalValue ? ((h.currentValue / metrics.totalValue) * 100).toFixed(1) : '—'}% of portfolio
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-1.5 text-xs">
                          <span className={`font-mono tabular-nums ${(h.annualCashFlow || 0) >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                            {formatDollar(h.annualCashFlow || 0)}/yr cash flow
                          </span>
                          <span className={`tabular-nums ${(h.appreciationRate || 0) >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                            {(h.appreciationRate || 0).toFixed(1)}% appreciation
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Desktop: full table. Hidden on mobile. */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2 pr-4 font-medium text-muted-foreground">Property</th>
                          <th scope="col" className="text-right py-2 pr-4 font-medium text-muted-foreground">Value</th>
                          <th scope="col" className="text-right py-2 pr-4 font-medium text-muted-foreground">Cash Flow/yr</th>
                          <th scope="col" className="text-right py-2 pr-4 font-medium text-muted-foreground">Appreciation</th>
                          <th scope="col" className="text-right py-2 font-medium text-muted-foreground">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h: any, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                              <p className="font-medium truncate max-w-[200px]">{h.address || h.name || `Property ${i + 1}`}</p>
                              <p className="text-xs text-muted-foreground">{h.county}, {h.state}</p>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono">{formatDollar(h.currentValue || h.estimatedValue || 0)}</td>
                            <td className={`py-2 pr-4 text-right font-mono ${(h.annualCashFlow || 0) >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                              {formatDollar(h.annualCashFlow || 0)}
                            </td>
                            <td className={`py-2 pr-4 text-right ${(h.appreciationRate || 0) >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                              {(h.appreciationRate || 0).toFixed(1)}%
                            </td>
                            <td className="py-2 text-right text-muted-foreground">
                              {metrics?.totalValue ? ((h.currentValue / metrics.totalValue) * 100).toFixed(1) : '—'}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                ) : (
                  <EmptyState
                    icon={Activity}
                    headline="No attribution data yet"
                    subtitle="Run the full analysis to see which holdings are driving portfolio value, cash flow, and appreciation."
                    cta={{
                      label: analyzeAllMutation.isPending ? 'Analyzing…' : 'Run full analysis',
                      onClick: () => analyzeAllMutation.mutate(),
                      'data-testid': 'optimizer-attribution-analyze',
                    }}
                    actionIcon={RefreshCw}
                    testId="optimizer-attribution-empty"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CONCENTRATION vs EQUAL-WEIGHT BENCHMARK ── */}
          <TabsContent value="comparison" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current Allocation vs Equal-Weight Benchmark</CardTitle>
                <CardDescription>
                  Your concentration by state beside an equal-weight spread — the wider the gap, the more concentrated you are in that state
                </CardDescription>
              </CardHeader>
              <CardContent>
                {diversification ? (
                  <div role="img" aria-label={`Current allocation vs equal-weight benchmark by state across ${(diversification.byState || []).length} states`}>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        ...(diversification.byState || []).map((d: any, _i: number, arr: any[]) => ({
                          label: d.state,
                          current: Math.round(d.percentage),
                          // Honest, computable reference: an even spread across
                          // the states you already hold. No fabricated "AI"
                          // series — a real optimizer target lands with the
                          // recommendations engine, not random jitter.
                          benchmark: arr.length > 0 ? Math.round(100 / arr.length) : 0,
                        })),
                      ]}
                      margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: any) => [`${v}%`, '']} />
                      <Legend />
                      <Bar dataKey="current" name="Current %" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="benchmark" name="Equal-weight %" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState
                    icon={BarChart2}
                    headline="No comparison data yet"
                    subtitle="Run the full analysis to see your current allocation beside an equal-weight benchmark, state by state."
                    cta={{
                      label: analyzeAllMutation.isPending ? 'Analyzing…' : 'Run full analysis',
                      onClick: () => analyzeAllMutation.mutate(),
                      'data-testid': 'optimizer-comparison-analyze',
                    }}
                    actionIcon={RefreshCw}
                    testId="optimizer-comparison-empty"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Stress Test Component ────────────────────────────────────────────────────

const STRESS_SCENARIOS = [
  {
    id: "recession_mild",
    label: "Mild Recession",
    description: "10-15% land price decline, credit tightening",
    priceImpact: -0.12,
    liquidityImpact: -0.25,
    color: CHART_WARN,
  },
  {
    id: "recession_severe",
    label: "Severe Recession",
    description: "25-35% price decline, 2008-level market freeze",
    priceImpact: -0.30,
    liquidityImpact: -0.60,
    color: CHART_NEG,
  },
  {
    id: "rate_shock",
    label: "Interest Rate Shock",
    description: "Fed rates jump 300bps, financing dries up",
    priceImpact: -0.15,
    liquidityImpact: -0.40,
    color: CHART_COLORS[3],
  },
  {
    id: "drought",
    label: "Agricultural Drought",
    description: "Severe drought reducing agricultural land values",
    priceImpact: -0.20,
    liquidityImpact: -0.30,
    color: CHART_COLORS[1],
  },
  {
    id: "inflation_surge",
    label: "Inflation Surge",
    description: "High inflation — land as hard asset may appreciate",
    priceImpact: 0.08,
    liquidityImpact: -0.15,
    color: CHART_POS,
  },
];

function StressTestTab() {
  const [selectedScenario, setSelectedScenario] = useState(STRESS_SCENARIOS[0]);
  const { data: portfolioData } = useQuery<{ simulation: any }>({
    queryKey: ["/api/portfolio-optimizer/simulate"],
    queryFn: () => fetch("/api/portfolio-optimizer/simulate").then(r => r.json()).catch(() => ({ simulation: null })),
  });

  const totalValue = portfolioData?.simulation?.totalPortfolioValue || 500000;
  const stressedValue = totalValue * (1 + selectedScenario.priceImpact);
  const loss = totalValue - stressedValue;
  const lossPercent = Math.abs(selectedScenario.priceImpact * 100).toFixed(0);

  const barData = STRESS_SCENARIOS.map(s => ({
    name: s.label.split(" ").slice(0, 2).join(" "),
    impact: Math.round(s.priceImpact * 100),
    color: s.color,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Scenario selector */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Select Stress Scenario</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {STRESS_SCENARIOS.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedScenario(s)}
                  aria-pressed={selectedScenario.id === s.id}
                  className={`w-full text-left p-3 rounded-card border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedScenario.id === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40 active:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className={`text-sm ml-auto font-semibold ${s.priceImpact < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
                      {s.priceImpact > 0 ? "+" : ""}{(s.priceImpact * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-5">{s.description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Stress test results */}
        <div className="space-y-3">
          <Card className={selectedScenario.priceImpact < 0 ? "border-acr-neg-soft dark:border-acr-neg-soft" : "border-acr-pos-soft dark:border-acr-pos-soft"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{selectedScenario.label} Impact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current Value</p>
                  <p className="text-xl font-bold">{formatDollar(totalValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stressed Value</p>
                  <p className={`text-xl font-bold ${selectedScenario.priceImpact < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
                    {formatDollar(stressedValue)}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-muted/40 rounded-card">
                <p className="text-sm font-medium">
                  {selectedScenario.priceImpact < 0 ? "Portfolio Loss:" : "Portfolio Gain:"}
                  <span className={`ml-2 ${selectedScenario.priceImpact < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
                    {selectedScenario.priceImpact < 0 ? "-" : "+"}{formatDollar(Math.abs(loss))} ({lossPercent}%)
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Liquidity Impact</p>
                <Progress value={Math.max(0, 100 + selectedScenario.liquidityImpact * 100)} className="h-2" />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Estimated {Math.abs(Math.round(selectedScenario.liquidityImpact * 100))}% reduction in market liquidity
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Mitigation Strategies</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {selectedScenario.priceImpact < -0.2 && (
                  <li className="text-xs flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5" />
                    Build cash reserves (6-12 months of expenses)
                  </li>
                )}
                <li className="text-xs flex items-start gap-1.5">
                  <Shield className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5" />
                  Diversify across states to reduce geographic concentration
                </li>
                <li className="text-xs flex items-start gap-1.5">
                  <Shield className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5" />
                  Prioritize seller-financed notes for stable cash flow
                </li>
                {selectedScenario.id === "rate_shock" && (
                  <li className="text-xs flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5" />
                    Lock in fixed-rate financing before rate increases
                  </li>
                )}
                {selectedScenario.id === "recession_severe" && (
                  <li className="text-xs flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5" />
                    Identify distressed sellers — opportunistic buying window
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Scenario comparison chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All Scenarios Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="img" aria-label={`All scenarios price impact comparison across ${barData.length} scenarios: ${barData.map(b => `${b.name} ${b.impact}%`).join(", ")}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => [`${v}%`, "Price Impact"]} />
              <Bar dataKey="impact" radius={[3, 3, 0, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
