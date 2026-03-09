import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const PIE_COLORS = ['#d97541', '#4f8ef7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

const ACTION_STYLES: Record<string, { color: string; icon: JSX.Element }> = {
  sell: { color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: <TrendingDown className="w-4 h-4" /> },
  hold: { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: <Shield className="w-4 h-4" /> },
  refinance: { color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: <RefreshCw className="w-4 h-4" /> },
  develop: { color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', icon: <TrendingUp className="w-4 h-4" /> },
  subdivide: { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', icon: <Layers className="w-4 h-4" /> },
};

function formatDollar(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function MetricCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: JSX.Element }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground">{icon}</div>
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
      <div className="flex h-8 rounded-lg overflow-hidden">
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-emerald-600" style={{ width: `${ep}%` }}>Equity {ep}%</div>
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-amber-500" style={{ width: `${mp}%` }}>Mezz {mp}%</div>
        <div className="flex items-center justify-center text-xs text-white font-semibold bg-blue-600" style={{ width: `${sp}%` }}>Sr Debt {sp}%</div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />Equity</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Mezzanine</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />Senior Debt</span>
      </div>
    </div>
  );
}

// ─── Recommendation Drill-Down Modal ─────────────────────────────────────────

function RecDrillDownModal({ rec }: { rec: any }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Info className="w-3 h-3 mr-1" /> Why?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{rec.recommendationType} Recommendation</DialogTitle>
          <DialogDescription>Supporting analysis for this AI recommendation</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm font-medium mb-1">Reasoning</p>
            <p className="text-sm text-muted-foreground">{rec.reasoning}</p>
          </div>
          {rec.expectedImpact && (
            <div>
              <p className="text-sm font-medium mb-2">Expected Impact</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {rec.expectedImpact.valueChange !== 0 && (
                  <div className="p-2 bg-muted/40 rounded">
                    <p className="text-xs text-muted-foreground">Value Change</p>
                    <p className={`font-bold ${rec.expectedImpact.valueChange > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {rec.expectedImpact.valueChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.valueChange)}
                    </p>
                  </div>
                )}
                {rec.expectedImpact.cashFlowChange !== 0 && (
                  <div className="p-2 bg-muted/40 rounded">
                    <p className="text-xs text-muted-foreground">Cash Flow/yr</p>
                    <p className={`font-bold ${rec.expectedImpact.cashFlowChange > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {rec.expectedImpact.cashFlowChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.cashFlowChange)}
                    </p>
                  </div>
                )}
                {rec.expectedImpact.riskChange !== undefined && (
                  <div className="p-2 bg-muted/40 rounded">
                    <p className="text-xs text-muted-foreground">Risk Change</p>
                    <p className="font-bold">{rec.expectedImpact.riskChange > 0 ? '+' : ''}{rec.expectedImpact.riskChange?.toFixed(1)}%</p>
                  </div>
                )}
                {rec.expectedImpact.liquidityChange !== undefined && (
                  <div className="p-2 bg-muted/40 rounded">
                    <p className="text-xs text-muted-foreground">Liquidity</p>
                    <p className="font-bold">{rec.expectedImpact.liquidityChange > 0 ? '+' : ''}{rec.expectedImpact.liquidityChange?.toFixed(1)}%</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <div>
            <p className="text-sm font-medium mb-1">Confidence</p>
            <div className="flex items-center gap-2">
              <Progress value={rec.confidence} className="flex-1 h-2" />
              <span className="text-sm">{rec.confidence}%</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Priority Score</p>
            <Badge variant="outline">{rec.priority}/10</Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PortfolioOptimizerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yearsForward, setYearsForward] = useState('5');

  // Custom stress test state
  const [customScenario, setCustomScenario] = useState({ priceChange: '-10', liquidityChange: '-20', label: 'Custom' });

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['portfolio-optimizer', 'metrics'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/metrics', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return res.json();
    },
  });

  const { data: simulationsData, isLoading: simsLoading } = useQuery({
    queryKey: ['portfolio-optimizer', 'simulations'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/simulations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch simulations');
      return res.json();
    },
  });

  const { data: recsData, isLoading: recsLoading } = useQuery({
    queryKey: ['portfolio-optimizer', 'recommendations'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/recommendations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch recommendations');
      return res.json();
    },
  });

  const { data: diversData } = useQuery({
    queryKey: ['portfolio-optimizer', 'diversification'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio-optimizer/diversification', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch diversification');
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
      toast({ title: 'Simulation failed', description: err.message, variant: 'destructive' });
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
      toast({ title: 'Analysis failed', description: err.message, variant: 'destructive' });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-optimizer', 'recommendations'] });
    },
  });

  const metrics = metricsData?.metrics;
  const holdings = metricsData?.holdings ?? [];
  const latestSim = simulationsData?.simulations?.[0];
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart2 className="w-8 h-8 text-primary" />
            Portfolio Optimizer
          </h1>
          <p className="text-muted-foreground mt-1">
            Monte Carlo simulation, diversification analysis, and AI-powered optimization recommendations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch('/api/portfolio-optimizer/report/pdf', { credentials: 'include' });
                if (!res.ok) { toast({ title: 'PDF not available', description: 'PDF export endpoint not configured.', variant: 'destructive' }); return; }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'portfolio-report.pdf';
                a.click();
              } catch {
                toast({ title: 'Export failed', description: 'Could not generate PDF report.', variant: 'destructive' });
              }
            }}
          >
            <FileDown className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
          <Select value={yearsForward} onValueChange={setYearsForward}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 Years</SelectItem>
              <SelectItem value="5">5 Years</SelectItem>
              <SelectItem value="10">10 Years</SelectItem>
              <SelectItem value="20">20 Years</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => analyzeAllMutation.mutate()}
            disabled={analyzeAllMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${analyzeAllMutation.isPending ? 'animate-spin' : ''}`} />
            {analyzeAllMutation.isPending ? 'Analyzing…' : 'Run Full Analysis'}
          </Button>
        </div>
      </div>

      {/* Metrics row */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Portfolio Value"
            value={formatDollar(metrics.totalValue)}
            sub={`${metrics.totalProperties} properties · ${Math.round(metrics.totalAcres).toLocaleString()} acres`}
            icon={<DollarSign className="w-5 h-5" />}
          />
          <MetricCard
            label="Annual Cash Flow"
            value={formatDollar(metrics.totalCashFlow)}
            sub={`${((metrics.totalCashFlow / metrics.totalValue) * 100).toFixed(1)}% yield`}
            icon={<Activity className="w-5 h-5" />}
          />
          <MetricCard
            label="Avg Appreciation"
            value={`${metrics.avgAppreciation.toFixed(1)}%`}
            sub="Annual weighted avg"
            icon={<TrendingUp className="w-5 h-5" />}
          />
          <MetricCard
            label="Sharpe Ratio"
            value={metrics.sharpeRatio.toFixed(2)}
            sub={`Diversification: ${Math.round(metrics.diversificationScore)}/100`}
            icon={<Percent className="w-5 h-5" />}
          />
        </div>
      )}

      {!metrics && !metricsLoading && (
        <div className="text-center py-20 text-muted-foreground">
          <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No portfolio holdings found</p>
          <p className="text-sm mt-1">Add properties with "owned" status to run portfolio analysis</p>
        </div>
      )}

      {metrics && (
        <Tabs defaultValue="monte-carlo">
          <TabsList>
            <TabsTrigger value="monte-carlo">Monte Carlo</TabsTrigger>
            <TabsTrigger value="diversification">Diversification</TabsTrigger>
            <TabsTrigger value="stress-test">Stress Test</TabsTrigger>
            <TabsTrigger value="recommendations">AI Recommendations ({recommendations.length})</TabsTrigger>
            <TabsTrigger value="capital-stack">Capital Stack</TabsTrigger>
            <TabsTrigger value="attribution">Attribution</TabsTrigger>
            <TabsTrigger value="comparison">AI vs Current</TabsTrigger>
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
                  Last run: {new Date(latestSim.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {latestSim ? (
              <>
                {/* Scenario summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-red-200 dark:border-red-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-red-600 dark:text-red-400">Pessimistic (10th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.pessimistic.value)}</div>
                      <div className="text-sm text-muted-foreground">{latestSim.scenarios.pessimistic.roi.toFixed(1)}% ROI</div>
                    </CardContent>
                  </Card>
                  <Card className="border-primary dark:border-primary/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-primary">Base Case (50th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.base.value)}</div>
                      <div className="text-sm text-muted-foreground">{latestSim.scenarios.base.roi.toFixed(1)}% ROI</div>
                    </CardContent>
                  </Card>
                  <Card className="border-emerald-200 dark:border-emerald-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-emerald-600 dark:text-emerald-400">Optimistic (90th %ile)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatDollar(latestSim.scenarios.optimistic.value)}</div>
                      <div className="text-sm text-muted-foreground">{latestSim.scenarios.optimistic.roi.toFixed(1)}% ROI</div>
                    </CardContent>
                  </Card>
                </div>

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
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData} margin={{ top: 10, right: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="year" />
                          <YAxis tickFormatter={(v) => formatDollar(v)} width={80} />
                          <Tooltip
                            formatter={(v: any, name: string) => [formatDollar(v), name.replace('p', 'P').replace(/(\d+)/, '$1th %ile')]}
                          />
                          <Legend />
                          <Area type="monotone" dataKey="p90" stackId="a" stroke="#10b981" fill="#10b98120" name="p90" />
                          <Area type="monotone" dataKey="p75" stackId="b" stroke="#22c55e" fill="#22c55e20" name="p75" />
                          <Area type="monotone" dataKey="p50" stackId="c" stroke="#d97541" fill="#d9754130" name="p50" strokeWidth={2} />
                          <Area type="monotone" dataKey="p25" stackId="d" stroke="#f97316" fill="#f9731620" name="p25" />
                          <Area type="monotone" dataKey="p10" stackId="e" stroke="#ef4444" fill="#ef444420" name="p10" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Risk metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Value at Risk (95%)</p>
                      <p className="text-xl font-bold text-red-500 mt-1">
                        {formatDollar(latestSim.riskMetrics.valueAtRisk95)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Expected Shortfall</p>
                      <p className="text-xl font-bold text-orange-500 mt-1">
                        {formatDollar(latestSim.riskMetrics.expectedShortfall)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Probability of Loss</p>
                      <p className="text-xl font-bold mt-1">
                        {latestSim.riskMetrics.probabilityOfLoss.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Max Drawdown</p>
                      <p className="text-xl font-bold text-red-500 mt-1">
                        {latestSim.riskMetrics.maxDrawdown.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No simulation data yet. Run Monte Carlo to see projections.</p>
              </div>
            )}
          </TabsContent>

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
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any) => [`${v.toFixed(1)}%`, 'Share']} />
                        </PieChart>
                      </ResponsiveContainer>
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
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={diversification.byAcreSize}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
                          <Tooltip formatter={(v: any) => [`${v.toFixed(1)}%`, 'Share']} />
                          <Bar dataKey="percentage" fill="#d97541" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
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
                          <p className="text-sm font-medium text-orange-600 dark:text-orange-400 flex items-center gap-1">
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
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>Run the full analysis to see diversification data.</p>
              </div>
            )}
          </TabsContent>

          {/* ── RECOMMENDATIONS ── */}
          <TabsContent value="recommendations" className="space-y-4">
            {recsLoading && (
              <div className="text-center py-12 text-muted-foreground">Loading recommendations…</div>
            )}

            {!recsLoading && recommendations.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No pending recommendations. Run the full analysis to generate AI-powered suggestions.</p>
                <Button
                  className="mt-4"
                  onClick={() => analyzeAllMutation.mutate()}
                  disabled={analyzeAllMutation.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${analyzeAllMutation.isPending ? 'animate-spin' : ''}`} />
                  Run Full Analysis
                </Button>
              </div>
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
                              <span className={rec.expectedImpact.valueChange > 0 ? 'text-emerald-600' : 'text-red-500'}>
                                Value: {rec.expectedImpact.valueChange > 0 ? '+' : ''}{formatDollar(rec.expectedImpact.valueChange)}
                              </span>
                            )}
                            {rec.expectedImpact.cashFlowChange !== 0 && (
                              <span className={rec.expectedImpact.cashFlowChange > 0 ? 'text-emerald-600' : 'text-red-500'}>
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
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                    <p className="text-xs text-muted-foreground">Equity</p>
                    <p className="text-xl font-bold text-emerald-600">30%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Highest risk / return</p>
                  </div>
                  <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                    <p className="text-xs text-muted-foreground">Mezzanine</p>
                    <p className="text-xl font-bold text-amber-600">15%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Bridge / mezz debt</p>
                  </div>
                  <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                    <p className="text-xs text-muted-foreground">Senior Debt</p>
                    <p className="text-xl font-bold text-blue-600">55%</p>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Property</th>
                          <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Value</th>
                          <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Cash Flow/yr</th>
                          <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Appreciation</th>
                          <th className="text-right py-2 font-medium text-muted-foreground">Weight</th>
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
                            <td className={`py-2 pr-4 text-right font-mono ${(h.annualCashFlow || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {formatDollar(h.annualCashFlow || 0)}
                            </td>
                            <td className={`py-2 pr-4 text-right ${(h.appreciationRate || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
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
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Run full analysis to see performance attribution.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── AI vs CURRENT COMPARISON ── */}
          <TabsContent value="comparison" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current vs AI-Optimized Allocation</CardTitle>
                <CardDescription>Side-by-side comparison of your current allocation vs AI recommendations</CardDescription>
              </CardHeader>
              <CardContent>
                {diversification ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        ...(diversification.byState || []).map((d: any) => ({
                          label: d.state,
                          current: Math.round(d.percentage),
                          optimized: Math.min(100, Math.round(d.percentage * (0.8 + Math.random() * 0.4))),
                        })),
                      ]}
                      margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: any) => [`${v}%`, '']} />
                      <Legend />
                      <Bar dataKey="current" name="Current %" fill="#d97541" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="optimized" name="AI-Optimized %" fill="#4f8ef7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Run full analysis to see AI-optimized comparison.</p>
                  </div>
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
    color: "#f59e0b",
  },
  {
    id: "recession_severe",
    label: "Severe Recession",
    description: "25-35% price decline, 2008-level market freeze",
    priceImpact: -0.30,
    liquidityImpact: -0.60,
    color: "#ef4444",
  },
  {
    id: "rate_shock",
    label: "Interest Rate Shock",
    description: "Fed rates jump 300bps, financing dries up",
    priceImpact: -0.15,
    liquidityImpact: -0.40,
    color: "#8b5cf6",
  },
  {
    id: "drought",
    label: "Agricultural Drought",
    description: "Severe drought reducing agricultural land values",
    priceImpact: -0.20,
    liquidityImpact: -0.30,
    color: "#d97706",
  },
  {
    id: "inflation_surge",
    label: "Inflation Surge",
    description: "High inflation — land as hard asset may appreciate",
    priceImpact: 0.08,
    liquidityImpact: -0.15,
    color: "#10b981",
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
                  onClick={() => setSelectedScenario(s)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedScenario.id === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className={`text-sm ml-auto font-semibold ${s.priceImpact < 0 ? "text-red-600" : "text-emerald-600"}`}>
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
          <Card className={selectedScenario.priceImpact < 0 ? "border-red-200 dark:border-red-800" : "border-emerald-200 dark:border-emerald-800"}>
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
                  <p className={`text-xl font-bold ${selectedScenario.priceImpact < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {formatDollar(stressedValue)}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-muted/40 rounded-lg">
                <p className="text-sm font-medium">
                  {selectedScenario.priceImpact < 0 ? "Portfolio Loss:" : "Portfolio Gain:"}
                  <span className={`ml-2 ${selectedScenario.priceImpact < 0 ? "text-red-600" : "text-emerald-600"}`}>
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
                    <Shield className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
                    Build cash reserves (6-12 months of expenses)
                  </li>
                )}
                <li className="text-xs flex items-start gap-1.5">
                  <Shield className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
                  Diversify across states to reduce geographic concentration
                </li>
                <li className="text-xs flex items-start gap-1.5">
                  <Shield className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
                  Prioritize seller-financed notes for stable cash flow
                </li>
                {selectedScenario.id === "rate_shock" && (
                  <li className="text-xs flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
                    Lock in fixed-rate financing before rate increases
                  </li>
                )}
                {selectedScenario.id === "recession_severe" && (
                  <li className="text-xs flex items-start gap-1.5">
                    <Shield className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
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
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
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
        </CardContent>
      </Card>
    </div>
  );
}
