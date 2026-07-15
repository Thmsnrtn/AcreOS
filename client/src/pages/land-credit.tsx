import { useId, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { RequiredDisclaimer } from '@/components/required-disclaimer';
import { useProperties } from '@/hooks/use-properties';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { chartColor } from "@/lib/chartPalette";
import { CHART_POS, CHART_WARN, CHART_NEG } from "@/lib/chart-colors";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import {
  Shield,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Info,
  Layers,
  BarChart2,
  Target,
} from 'lucide-react';
import { formatDate } from "@/lib/format";

const reassurance = "Your selection is unchanged — try again.";

function scoreTier(score: number): "excellent" | "very good" | "good" | "fair" | "poor" {
  if (score >= 740) return "excellent";
  if (score >= 670) return "very good";
  if (score >= 580) return "good";
  if (score >= 500) return "fair";
  return "poor";
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-acr-pos dark:text-acr-pos',
  'A': 'text-acr-pos dark:text-acr-pos',
  'B+': 'text-acr-pos dark:text-acr-pos',
  'B': 'text-lime-600 dark:text-lime-400',
  'C+': 'text-acr-warn dark:text-acr-warn',
  'C': 'text-acr-warn dark:text-acr-warn',
  'D': 'text-acr-neg dark:text-acr-neg',
  'F': 'text-acr-neg dark:text-acr-neg',
};

const RISK_BADGE: Record<string, string> = {
  excellent: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos',
  good: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos',
  fair: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  poor: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  high: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg',
};

const DIMENSION_LABELS: Record<string, string> = {
  location: 'Location',
  physical: 'Physical',
  legal: 'Legal',
  financial: 'Financial',
  environmental: 'Environmental',
  market: 'Market',
};

function ScoreGauge({ score }: { score: number }) {
  const pct = ((score - 300) / 550) * 100;
  const color = score >= 670 ? CHART_POS : score >= 500 ? CHART_WARN : CHART_NEG;
  const tier = scoreTier(score);

  return (
    <div
      className="flex flex-col items-center gap-2"
      role="img"
      aria-label={`Land credit score ${score} out of 850 (${tier} tier)`}
    >
      <div className="relative w-40 h-20 overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-center">
          <svg viewBox="0 0 200 100" className="w-full h-full" aria-hidden="true">
            <path
              d="M 10 100 A 90 90 0 0 1 190 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="18"
              className="text-muted/30"
              strokeLinecap="round"
            />
            <path
              d="M 10 100 A 90 90 0 0 1 190 100"
              fill="none"
              stroke={color}
              strokeWidth="18"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 283} 283`}
            />
          </svg>
        </div>
      </div>
      <div className="text-4xl font-bold tabular-nums" style={{ color }} aria-hidden="true">
        {score}
      </div>
      <div className="text-sm text-muted-foreground">300 – 850 scale</div>
    </div>
  );
}

function DimensionRadar({ factors }: { factors: Record<string, any> }) {
  const data = Object.entries(factors).map(([key, val]) => ({
    dimension: DIMENSION_LABELS[key] || key,
    score: val?.score ?? 0,
    fullMark: 100,
  }));

  return (
    <div
      role="img"
      aria-label={`Six-dimension radar chart: ${data.map(d => `${d.dimension} ${d.score} of 100`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data}>
          <PolarGrid className="stroke-muted" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: 'currentColor' }} />
          <Radar
            name="Score"
            dataKey="score"
            stroke={chartColor(0)}
            fill={chartColor(0)}
            fillOpacity={0.25}
          />
          <Tooltip
            formatter={(v: any) => [`${v}/100`, 'Score']}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

const INVESTOR_STRATEGIES = [
  { value: 'cash_flow', label: 'Cash flow' },
  { value: 'appreciation', label: 'Appreciation' },
  { value: 'flip', label: 'Flip' },
] as const;

type InvestorStrategy = 'cash_flow' | 'appreciation' | 'flip';

export default function LandCreditPage() {
  useDocumentTitle("Land Credit Score");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = (propertiesData as any)?.properties ?? [];

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [investorStrategy, setInvestorStrategy] = useState<InvestorStrategy>('cash_flow');
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const propertyId = useId();
  const strategyId = useId();

  const { data: featureImportanceData, isLoading: featuresLoading, error: featuresError, refetch: refetchFeatures } = useQuery({
    queryKey: ['land-credit', 'feature-importance'],
    queryFn: async () => {
      const res = await fetch('/api/land-credit/feature-importance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch feature importance');
      return res.json();
    },
  });

  const { data: historyData, isLoading: historyLoading, error: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['land-credit', 'history', selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/land-credit/property/${selectedPropertyId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch score history');
      return res.json();
    },
    enabled: !!selectedPropertyId,
  });

  const { data: portfolioData, isLoading: portfolioLoading, error: portfolioError, refetch: refetchPortfolio } = useQuery({
    queryKey: ['land-credit', 'portfolio'],
    queryFn: async () => {
      const res = await fetch('/api/land-credit/portfolio', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch portfolio distribution');
      return res.json();
    },
  });

  const scoreMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      const res = await fetch(`/api/land-credit/score/${propertyId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Scoring failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Score calculated', description: 'Land credit score updated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['land-credit'] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't calculate score", description: `${err.message}. ${reassurance}`, variant: 'destructive' });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/land-credit/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Bulk scoring failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bulk scoring started', description: 'Scores will update for all properties.' });
      queryClient.invalidateQueries({ queryKey: ['land-credit'] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start bulk scoring", description: `${err.message}. ${reassurance}`, variant: 'destructive' });
    },
  });

  const latestScore = historyData?.history?.[0];
  const factors = latestScore?.factors;
  const distribution = portfolioData?.distribution;
  const featureImportance: any[] = featureImportanceData?.features ?? [];

  // Personalized score
  const personalizedScore = latestScore
    ? (() => {
        const base = latestScore.score;
        const adj: Record<InvestorStrategy, number> = { cash_flow: 3, appreciation: 8, flip: 13 };
        return Math.min(850, Math.max(300, base + (adj[investorStrategy] || 0)));
      })()
    : null;

  // Historical score trend data
  const scoreTrend =
    historyData?.history
      ?.slice()
      .reverse()
      .map((h: any, i: number) => ({
        date: new Date(h.calculatedAt || h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: h.score,
      })) ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Standing disclaimer — the score is parcel analysis, not a consumer credit score */}
      <RequiredDisclaimer type="score" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="w-8 h-8 text-primary" aria-hidden="true" />
            Land Credit Score
          </h1>
          <p className="text-muted-foreground mt-1">
            Proprietary 300–850 intelligence score for every parcel — the FICO equivalent for land.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => bulkMutation.mutate()}
          disabled={bulkMutation.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${bulkMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
          Score all properties
        </Button>
      </div>

      <Tabs defaultValue="property">
        <TabsList>
          <TabsTrigger value="property">Property score</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio overview</TabsTrigger>
          <TabsTrigger value="features">Feature importance</TabsTrigger>
        </TabsList>

        {/* ── PROPERTY SCORE ── */}
        <TabsContent value="property" className="space-y-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor={propertyId} className="text-xs">Property</Label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger id={propertyId} className="w-80">
                  <SelectValue placeholder="Select a property to score…" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.address || `Parcel ${p.apn || p.id}`} — {p.county}, {p.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={strategyId} className="text-xs">Investor strategy</Label>
              <Select value={investorStrategy} onValueChange={(v) => setInvestorStrategy(v as InvestorStrategy)}>
                <SelectTrigger id={strategyId} className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVESTOR_STRATEGIES.map(s => (
                    <SelectItem key={s.value} value={s.value}>Optimize: {s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!selectedPropertyId || scoreMutation.isPending}
              onClick={() => scoreMutation.mutate(selectedPropertyId)}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${scoreMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
              {scoreMutation.isPending ? 'Calculating…' : 'Calculate score'}
            </Button>
            {latestScore && (
              <Dialog open={drillDownOpen} onOpenChange={setDrillDownOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Info className="w-4 h-4 mr-1" aria-hidden="true" /> Why this score?
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Score drill-down</DialogTitle>
                    <DialogDescription>Factor-level analysis with improvement suggestions</DialogDescription>
                  </DialogHeader>
                  <ul className="space-y-3 pt-2 list-none p-0 m-0" aria-label="Score factors">
                    {factors && Object.entries(factors).map(([key, val]: [string, any]) => {
                      const score = val?.score ?? 0;
                      const dim = DIMENSION_LABELS[key];
                      const trendIcon = score >= 65 ? "improving" : score >= 45 ? "neutral" : "declining";
                      return (
                        <li key={key} className="p-3 border rounded-card">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium capitalize">{dim}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm tabular-nums" aria-label={`${dim} score: ${score} of 100, trend ${trendIcon}`}>{score}/100</span>
                              {score >= 65
                                ? <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                                : score >= 45
                                ? <Minus className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                                : <TrendingDown className="w-4 h-4 text-acr-neg" aria-hidden="true" />}
                            </div>
                          </div>
                          <Progress
                            value={score}
                            className="h-1.5 mb-2"
                            role="progressbar"
                            aria-valuenow={score}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${dim} dimension score`}
                          />
                          <p className="text-xs text-muted-foreground">
                            {score < 60
                              ? `Improvement needed: focus on ${key} factors to increase score.`
                              : `This dimension is performing well.`}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {historyLoading && (
            <div role="status" aria-busy="true">
              <span className="sr-only">Loading score history…</span>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Skeleton announce={false} className="h-64 lg:col-span-1" />
                <Skeleton announce={false} className="h-64 lg:col-span-2" />
                <Skeleton announce={false} className="h-40" />
                <Skeleton announce={false} className="h-40 lg:col-span-2" />
              </div>
            </div>
          )}

          {historyError && !!selectedPropertyId && (
            <QueryErrorState
              error={historyError as Error}
              onRetry={() => refetchHistory()}
              testId="land-credit-history-error"
            />
          )}

          {selectedPropertyId && !historyLoading && !historyError && !latestScore && (
            <EmptyState
              icon={Shield}
              headline="No score for this property yet"
              subtitle="Calculate this parcel's AcreOS Credit Score to evaluate it across location, physical, legal, financial, environmental, and market dimensions."
              cta={{
                label: scoreMutation.isPending ? "Calculating…" : "Calculate score",
                onClick: () => scoreMutation.mutate(selectedPropertyId),
                "data-testid": "land-credit-empty-score-cta",
              }}
              actionIcon={RefreshCw}
              testId="land-credit-empty-score"
            />
          )}

          {latestScore && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Score card */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    AcreOS Credit Score™
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  <ScoreGauge score={latestScore.score} />
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-5xl font-bold ${GRADE_COLORS[latestScore.grade]}`}
                      aria-label={`Letter grade: ${latestScore.grade}`}
                    >
                      {latestScore.grade}
                    </span>
                    <Badge
                      className={RISK_BADGE[latestScore.riskLevel]}
                      aria-label={`Risk level: ${latestScore.riskLevel}`}
                    >
                      {latestScore.riskLevel?.charAt(0).toUpperCase() + latestScore.riskLevel?.slice(1)} risk
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last updated <time dateTime={latestScore.calculatedAt || latestScore.createdAt}>{formatDate(latestScore.calculatedAt || latestScore.createdAt)}</time>
                  </p>
                </CardContent>
              </Card>

              {/* Radar chart */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Six-dimension analysis</CardTitle>
                  <CardDescription>Weighted scoring across location, physical, legal, financial, environmental, and market factors</CardDescription>
                </CardHeader>
                <CardContent>
                  {factors && <DimensionRadar factors={factors} />}

                  <ul className="mt-4 space-y-3 list-none p-0 m-0" aria-label="Dimension scores with weights">
                    {factors && Object.entries(factors).map(([key, val]: [string, any]) => {
                      const score = val?.score ?? 0;
                      const dim = DIMENSION_LABELS[key];
                      return (
                        <li key={key} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{dim}</span>
                            <span className="text-muted-foreground tabular-nums">{score}/100 ({val?.weight}% weight)</span>
                          </div>
                          <Progress
                            value={score}
                            className="h-2"
                            role="progressbar"
                            aria-valuenow={score}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${dim}: ${score} of 100, ${val?.weight} percent weight`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>

              {/* Strengths */}
              {latestScore.strengths?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-acr-pos dark:text-acr-pos">
                      <CheckCircle className="w-4 h-4" aria-hidden="true" />
                      Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 list-none p-0 m-0" aria-label="Score strengths">
                      {latestScore.strengths.map((s: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <TrendingUp className="w-4 h-4 mt-0.5 text-acr-pos shrink-0" aria-hidden="true" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Weaknesses */}
              {latestScore.weaknesses?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-acr-warn dark:text-acr-warn">
                      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                      Weaknesses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 list-none p-0 m-0" aria-label="Score weaknesses">
                      {latestScore.weaknesses.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <TrendingDown className="w-4 h-4 mt-0.5 text-acr-warn shrink-0" aria-hidden="true" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Recommendations */}
              {latestScore.recommendations?.length > 0 && (
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                      Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 list-none p-0 m-0" aria-label="Recommendations to improve score">
                      {latestScore.recommendations.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Minus className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Personalized Score */}
              {personalizedScore && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Target className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                      Personalized for {INVESTOR_STRATEGIES.find(s => s.value === investorStrategy)?.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="flex items-center gap-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Base score</dt>
                        <dd className="text-2xl font-bold tabular-nums">{latestScore.score}</dd>
                      </div>
                      <div className="text-muted-foreground" aria-hidden="true">→</div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Adjusted score</dt>
                        <dd className="text-2xl font-bold text-acr-brand tabular-nums">{personalizedScore}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground mt-2">
                      Adjusted by weighting factors most relevant to {investorStrategy.replace(/_/g, ' ')} strategy.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Historical Score Trend */}
              {scoreTrend.length > 1 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Historical score trend</CardTitle>
                    <CardDescription>Credit score over time for this property</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      role="img"
                      aria-label={`Score history line chart over ${scoreTrend.length} data points; latest score ${scoreTrend[scoreTrend.length - 1]?.score}, earliest ${scoreTrend[0]?.score}`}
                    >
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={scoreTrend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis domain={[300, 850]} />
                          <Tooltip />
                          <Line type="monotone" dataKey="score" stroke={chartColor(0)} strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!selectedPropertyId && (
            <div className="text-center py-20 text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" aria-hidden="true" />
              <p className="text-lg font-medium">Select a property to view its AcreOS Credit Score</p>
              <p className="text-sm mt-1">Scores evaluate location, physical, legal, financial, environmental, and market dimensions</p>
            </div>
          )}
        </TabsContent>

        {/* ── PORTFOLIO OVERVIEW ── */}
        <TabsContent value="portfolio" className="space-y-6">
          {portfolioLoading && (
            <div role="status" aria-busy="true">
              <span className="sr-only">Loading portfolio distribution…</span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Skeleton announce={false} className="h-40" />
                <Skeleton announce={false} className="h-40 md:col-span-2" />
                <Skeleton announce={false} className="h-24 md:col-span-3" />
              </div>
            </div>
          )}

          {portfolioError && (
            <QueryErrorState
              error={portfolioError as Error}
              onRetry={() => refetchPortfolio()}
              testId="land-credit-portfolio-error"
            />
          )}

          {distribution && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Average score</CardTitle>
                  <CardDescription>Portfolio-wide credit score</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-5xl font-bold text-primary tabular-nums">
                    {Math.round(distribution.avgScore)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">300–850 scale</div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Grade distribution</CardTitle>
                  <CardDescription>Credit score grades across all properties</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 list-none p-0 m-0" aria-label="Grade distribution across portfolio">
                    {distribution.gradeDistribution?.map(({ grade, count }: any) => {
                      const maxCount = Math.max(...distribution.gradeDistribution.map((g: any) => g.count));
                      const pct = (count / maxCount) * 100;
                      return (
                        <li key={grade} className="flex items-center gap-3">
                          <span className={`w-8 text-lg font-bold ${GRADE_COLORS[grade] || ''}`}>{grade}</span>
                          <Progress
                            value={pct}
                            className="flex-1 h-3"
                            role="progressbar"
                            aria-valuenow={count}
                            aria-valuemin={0}
                            aria-valuemax={maxCount}
                            aria-label={`Grade ${grade}: ${count} ${count === 1 ? "property" : "properties"}`}
                          />
                          <span className="text-sm text-muted-foreground w-6 tabular-nums">{count}</span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>

              <Card className="md:col-span-3">
                <CardHeader>
                  <CardTitle>Risk level breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-wrap gap-3 list-none p-0 m-0" aria-label="Properties by risk level">
                    {distribution.riskDistribution?.map(({ risk, count }: any) => (
                      <li
                        key={risk}
                        className={`px-4 py-2 rounded-full text-sm font-medium ${RISK_BADGE[risk]}`}
                        aria-label={`${risk} risk: ${count} ${count === 1 ? "property" : "properties"}`}
                      >
                        {risk.charAt(0).toUpperCase() + risk.slice(1)}: <span className="tabular-nums">{count}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {!distribution && !portfolioLoading && !portfolioError && (
            <EmptyState
              icon={Layers}
              headline="No portfolio data yet"
              subtitle="Score your properties to see portfolio-level insights across every parcel you hold."
              cta={{
                label: bulkMutation.isPending ? "Scoring…" : "Score all properties",
                onClick: () => bulkMutation.mutate(),
                "data-testid": "land-credit-portfolio-empty-cta",
              }}
              actionIcon={RefreshCw}
              testId="land-credit-portfolio-empty"
            />
          )}
        </TabsContent>

        {/* ── FEATURE IMPORTANCE ── */}
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-primary" aria-hidden="true" />
                Scoring factor weights
              </CardTitle>
              <CardDescription>
                Which factors most influence the AcreOS Credit Score and by how much
              </CardDescription>
            </CardHeader>
            <CardContent>
              {featuresLoading && (
                <div role="status" aria-busy="true" className="space-y-4">
                  <span className="sr-only">Loading scoring factor weights…</span>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between">
                        <Skeleton announce={false} className="h-4 w-24" />
                        <Skeleton announce={false} className="h-4 w-16" />
                      </div>
                      <Skeleton announce={false} className="h-3 w-full" />
                      <Skeleton announce={false} className="h-3 w-3/4" />
                    </div>
                  ))}
                </div>
              )}

              {featuresError && !featuresLoading && (
                <QueryErrorState
                  error={featuresError as Error}
                  onRetry={() => refetchFeatures()}
                  compact
                  testId="land-credit-features-error"
                />
              )}

              {!featuresLoading && !featuresError && (
              <ul className="space-y-4 list-none p-0 m-0" aria-label="Scoring factors and their weights">
                {(featureImportance.length > 0 ? featureImportance : [
                  { factor: 'Location', weight: 25, description: 'Market strength, population growth, economic health, accessibility' },
                  { factor: 'Financial', weight: 20, description: 'Cash flow, appreciation, liquidity, tax burden, maintenance cost' },
                  { factor: 'Physical', weight: 20, description: 'Topography, soil quality, water access, utilities, road access' },
                  { factor: 'Legal', weight: 15, description: 'Zoning, restrictions, mineral rights, water rights, clear title' },
                  { factor: 'Environmental', weight: 10, description: 'Flood risk, wildfire, contamination, wetlands, endangered species' },
                  { factor: 'Market', weight: 10, description: 'Demand, supply, price history, days on market, comparables' },
                ]).map((f: any) => (
                  <li key={f.factor} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{f.factor}</span>
                      <span className="text-muted-foreground tabular-nums">{f.weight}% weight</span>
                    </div>
                    <Progress
                      value={f.weight * 4}
                      className="h-3"
                      role="progressbar"
                      aria-valuenow={f.weight}
                      aria-valuemin={0}
                      aria-valuemax={25}
                      aria-label={`${f.factor} factor weight: ${f.weight} percent`}
                    />
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </li>
                ))}
              </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
