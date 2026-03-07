import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useProperties } from '@/hooks/use-properties';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
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
} from 'lucide-react';

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-600 dark:text-emerald-400',
  'A': 'text-emerald-500 dark:text-emerald-400',
  'B+': 'text-green-600 dark:text-green-400',
  'B': 'text-lime-600 dark:text-lime-400',
  'C+': 'text-yellow-600 dark:text-yellow-400',
  'C': 'text-orange-600 dark:text-orange-400',
  'D': 'text-red-500 dark:text-red-400',
  'F': 'text-red-700 dark:text-red-500',
};

const RISK_BADGE: Record<string, string> = {
  excellent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  good: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  fair: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  poor: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
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
  const color = score >= 740 ? '#10b981' : score >= 670 ? '#22c55e' : score >= 580 ? '#f59e0b' : score >= 500 ? '#f97316' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-40 h-20 overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-center">
          <svg viewBox="0 0 200 100" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 10 100 A 90 90 0 0 1 190 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="18"
              className="text-muted/30"
              strokeLinecap="round"
            />
            {/* Score arc */}
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
      <div className="text-4xl font-bold tabular-nums" style={{ color }}>
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
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data}>
        <PolarGrid className="stroke-muted" />
        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: 'currentColor' }} />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#d97541"
          fill="#d97541"
          fillOpacity={0.25}
        />
        <Tooltip
          formatter={(v: any) => [`${v}/100`, 'Score']}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export default function LandCreditPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = (propertiesData as any)?.properties ?? [];

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');

  const { data: historyData, isLoading: historyLoading } = useQuery({
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

  const { data: portfolioData, isLoading: portfolioLoading } = useQuery({
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
      toast({ title: 'Scoring failed', description: err.message, variant: 'destructive' });
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
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const latestScore = historyData?.history?.[0];
  const factors = latestScore?.factors;
  const distribution = portfolioData?.distribution;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="w-8 h-8 text-primary" />
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
          <RefreshCw className={`w-4 h-4 mr-2 ${bulkMutation.isPending ? 'animate-spin' : ''}`} />
          Score All Properties
        </Button>
      </div>

      <Tabs defaultValue="property">
        <TabsList>
          <TabsTrigger value="property">Property Score</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio Overview</TabsTrigger>
        </TabsList>

        {/* ── PROPERTY SCORE ── */}
        <TabsContent value="property" className="space-y-6">
          <div className="flex items-center gap-4">
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger className="w-80">
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
            <Button
              disabled={!selectedPropertyId || scoreMutation.isPending}
              onClick={() => scoreMutation.mutate(selectedPropertyId)}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${scoreMutation.isPending ? 'animate-spin' : ''}`} />
              {scoreMutation.isPending ? 'Calculating…' : 'Calculate Score'}
            </Button>
          </div>

          {historyLoading && (
            <div className="text-center py-12 text-muted-foreground">Loading score history…</div>
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
                    <span className={`text-5xl font-bold ${GRADE_COLORS[latestScore.grade]}`}>
                      {latestScore.grade}
                    </span>
                    <Badge className={RISK_BADGE[latestScore.riskLevel]}>
                      {latestScore.riskLevel?.charAt(0).toUpperCase() + latestScore.riskLevel?.slice(1)} Risk
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last updated {new Date(latestScore.calculatedAt || latestScore.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>

              {/* Radar chart */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Six-Dimension Analysis</CardTitle>
                  <CardDescription>Weighted scoring across location, physical, legal, financial, environmental, and market factors</CardDescription>
                </CardHeader>
                <CardContent>
                  {factors && <DimensionRadar factors={factors} />}

                  {/* Dimension bars */}
                  <div className="mt-4 space-y-3">
                    {factors && Object.entries(factors).map(([key, val]: [string, any]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{DIMENSION_LABELS[key]}</span>
                          <span className="text-muted-foreground">{val?.score ?? 0}/100 ({val?.weight}% weight)</span>
                        </div>
                        <Progress value={val?.score ?? 0} className="h-2" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Strengths */}
              {latestScore.strengths?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="w-4 h-4" />
                      Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {latestScore.strengths.map((s: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <TrendingUp className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
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
                    <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                      <AlertTriangle className="w-4 h-4" />
                      Weaknesses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {latestScore.weaknesses.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <TrendingDown className="w-4 h-4 mt-0.5 text-orange-500 shrink-0" />
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
                      <Info className="w-4 h-4 text-blue-500" />
                      Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {latestScore.recommendations.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Minus className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!selectedPropertyId && (
            <div className="text-center py-20 text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Select a property to view its AcreOS Credit Score</p>
              <p className="text-sm mt-1">Scores evaluate location, physical, legal, financial, environmental, and market dimensions</p>
            </div>
          )}
        </TabsContent>

        {/* ── PORTFOLIO OVERVIEW ── */}
        <TabsContent value="portfolio" className="space-y-6">
          {portfolioLoading && (
            <div className="text-center py-12 text-muted-foreground">Loading portfolio distribution…</div>
          )}

          {distribution && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Average Score</CardTitle>
                  <CardDescription>Portfolio-wide credit score</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-5xl font-bold text-primary">
                    {Math.round(distribution.avgScore)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">300–850 scale</div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Grade Distribution</CardTitle>
                  <CardDescription>Credit score grades across all properties</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {distribution.gradeDistribution?.map(({ grade, count }: any) => (
                      <div key={grade} className="flex items-center gap-3">
                        <span className={`w-8 text-lg font-bold ${GRADE_COLORS[grade] || ''}`}>{grade}</span>
                        <Progress value={(count / Math.max(...distribution.gradeDistribution.map((g: any) => g.count))) * 100} className="flex-1 h-3" />
                        <span className="text-sm text-muted-foreground w-6">{count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-3">
                <CardHeader>
                  <CardTitle>Risk Level Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {distribution.riskDistribution?.map(({ risk, count }: any) => (
                      <div key={risk} className={`px-4 py-2 rounded-full text-sm font-medium ${RISK_BADGE[risk]}`}>
                        {risk.charAt(0).toUpperCase() + risk.slice(1)}: {count}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {!distribution && !portfolioLoading && (
            <div className="text-center py-20 text-muted-foreground">
              <Layers className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No portfolio data yet</p>
              <p className="text-sm mt-1">Score your properties to see portfolio-level insights</p>
              <Button className="mt-4" onClick={() => bulkMutation.mutate()} disabled={bulkMutation.isPending}>
                <RefreshCw className={`w-4 h-4 mr-2 ${bulkMutation.isPending ? 'animate-spin' : ''}`} />
                Score All Properties
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
