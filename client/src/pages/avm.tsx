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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  MapPin,
  RefreshCw,
  Info,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  Activity,
  Database,
} from 'lucide-react';

function formatDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const color = confidence >= 70 ? 'text-emerald-600' : confidence >= 40 ? 'text-yellow-600' : 'text-red-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Model Confidence</span>
        <span className={`font-semibold ${color}`}>{confidence}%</span>
      </div>
      <Progress value={confidence} className="h-2" />
    </div>
  );
}

export default function AVMPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = (propertiesData as any)?.properties ?? [];

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');

  const { data: statsData } = useQuery({
    queryKey: ['avm', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/avm/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch AVM stats');
      return res.json();
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['avm', 'history', selectedPropertyId],
    queryFn: async () => {
      const res = await fetch(`/api/avm/history/${selectedPropertyId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch valuation history');
      return res.json();
    },
    enabled: !!selectedPropertyId,
  });

  const valuationMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      const res = await fetch(`/api/avm/property/${propertyId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Valuation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Valuation complete', description: 'AcreOS Valuation Model™ estimate ready.' });
      queryClient.invalidateQueries({ queryKey: ['avm', 'history', selectedPropertyId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Valuation failed', description: err.message, variant: 'destructive' });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/avm/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Bulk valuation failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bulk valuation started', description: 'All owned properties are being valued.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const stats = statsData?.stats;
  const history = historyData?.history ?? [];
  const latest = history[0];

  // Comparable bar chart data
  const compsData = latest?.comparables?.map((c: any, i: number) => ({
    label: `Comp ${i + 1}`,
    pricePerAcre: Math.round(c.pricePerAcre),
    similarity: c.similarity,
    distance: c.distance,
  })) ?? [];

  // Market adjustments data
  const adjustmentsData = latest?.marketAdjustments?.map((a: any) => ({
    factor: a.factor.length > 20 ? a.factor.substring(0, 18) + '…' : a.factor,
    adjustment: a.adjustment,
  })) ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="w-8 h-8 text-primary" />
            AcreOS Valuation Model™
          </h1>
          <p className="text-muted-foreground mt-1">
            Proprietary ML valuation model trained on land transactions — instant estimates with confidence intervals.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => bulkMutation.mutate()}
          disabled={bulkMutation.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${bulkMutation.isPending ? 'animate-spin' : ''}`} />
          Value All Properties
        </Button>
      </div>

      {/* Model Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.totalTransactions?.toLocaleString() ?? '—'}</div>
              <div className="text-sm text-muted-foreground">Training Transactions</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.avgDataQuality ?? '—'}/100</div>
              <div className="text-sm text-muted-foreground">Avg Data Quality</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.statesCovered ?? '—'}</div>
              <div className="text-sm text-muted-foreground">States Covered</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.avgPricePerAcre ? formatDollar(stats.avgPricePerAcre) : '—'}</div>
              <div className="text-sm text-muted-foreground">Avg Price / Acre</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Property selector */}
      <div className="flex items-center gap-4">
        <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select a property to value…" />
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
          disabled={!selectedPropertyId || valuationMutation.isPending}
          onClick={() => valuationMutation.mutate(selectedPropertyId)}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${valuationMutation.isPending ? 'animate-spin' : ''}`} />
          {valuationMutation.isPending ? 'Valuing…' : 'Generate Valuation'}
        </Button>
      </div>

      {historyLoading && (
        <div className="text-center py-16 text-muted-foreground">Loading valuation history…</div>
      )}

      {latest && (
        <Tabs defaultValue="estimate">
          <TabsList>
            <TabsTrigger value="estimate">Estimate</TabsTrigger>
            <TabsTrigger value="comparables">Comparable Sales ({latest.comparables?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="adjustments">Market Adjustments</TabsTrigger>
            {history.length > 1 && <TabsTrigger value="history">History ({history.length})</TabsTrigger>}
          </TabsList>

          {/* ── ESTIMATE ── */}
          <TabsContent value="estimate" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Main estimate */}
              <Card className="md:col-span-2 border-primary/30">
                <CardHeader>
                  <CardTitle>Estimated Value</CardTitle>
                  <CardDescription>{latest.methodology}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-baseline gap-4">
                    <span className="text-5xl font-bold text-primary">
                      {formatDollar(latest.estimatedValue)}
                    </span>
                    <span className="text-xl text-muted-foreground">
                      ({formatDollar(latest.pricePerAcre)}/acre)
                    </span>
                  </div>

                  {/* Confidence interval */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Low: {formatDollar(latest.confidenceInterval.low)}</span>
                      <span>High: {formatDollar(latest.confidenceInterval.high)}</span>
                    </div>
                    <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                      {/* Low-to-high range bar */}
                      <div
                        className="absolute top-0 h-full bg-primary/20 rounded-full"
                        style={{
                          left: '0%',
                          width: '100%',
                        }}
                      />
                      {/* Estimate marker */}
                      <div
                        className="absolute top-0 h-full w-1 bg-primary rounded-full"
                        style={{
                          left: `${((latest.estimatedValue - latest.confidenceInterval.low) / (latest.confidenceInterval.high - latest.confidenceInterval.low)) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Confidence range: {formatDollar(latest.confidenceInterval.low)} – {formatDollar(latest.confidenceInterval.high)}
                    </p>
                  </div>

                  <ConfidenceBar confidence={latest.confidence} />
                </CardContent>
              </Card>

              {/* Quick stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Valuation Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Comparables Used</span>
                    <span className="font-medium">{latest.comparables?.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Adjustments Applied</span>
                    <span className="font-medium">{latest.marketAdjustments?.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valuation Date</span>
                    <span className="font-medium">
                      {latest.createdAt ? new Date(latest.createdAt).toLocaleDateString() : 'Today'}
                    </span>
                  </div>
                  {latest.confidence >= 70 ? (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 pt-2">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-xs">High confidence estimate</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 pt-2">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs">
                        {latest.confidence < 40 ? 'Low' : 'Moderate'} confidence — limited comps
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── COMPARABLES ── */}
          <TabsContent value="comparables" className="space-y-6">
            {compsData.length > 0 ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Price Per Acre — Comparable Sales</CardTitle>
                    <CardDescription>Ranked by similarity score</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={compsData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip
                          formatter={(v: any, name: string) => [
                            name === 'pricePerAcre' ? `$${v.toLocaleString()}/acre` : `${v}%`,
                            name === 'pricePerAcre' ? 'Price/Acre' : 'Similarity',
                          ]}
                        />
                        <ReferenceLine y={latest.pricePerAcre} stroke="#d97541" strokeDasharray="5 5" label="Subject" />
                        <Bar dataKey="pricePerAcre" fill="#4f8ef7" radius={[4, 4, 0, 0]} name="pricePerAcre" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {latest.comparables.map((c: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-sm">Comparable #{i + 1}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" />
                              {c.distance.toFixed(1)} miles away
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">{formatDollar(c.salePrice)}</p>
                            <p className="text-sm text-muted-foreground">{formatDollar(c.pricePerAcre)}/acre</p>
                          </div>
                          <div className="text-right">
                            <Badge variant={c.similarity >= 70 ? 'default' : 'secondary'}>
                              {c.similarity}% similar
                            </Badge>
                          </div>
                        </div>
                        <Progress value={c.similarity} className="h-1 mt-3" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">No comparable sales data available</div>
            )}
          </TabsContent>

          {/* ── ADJUSTMENTS ── */}
          <TabsContent value="adjustments" className="space-y-4">
            {adjustmentsData.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Market Adjustments Applied</CardTitle>
                  <CardDescription>Factors that increased or decreased the baseline comparable value</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={adjustmentsData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`} />
                      <YAxis type="category" dataKey="factor" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}%`, 'Adjustment']} />
                      <ReferenceLine x={0} stroke="#888" />
                      <Bar
                        dataKey="adjustment"
                        radius={[0, 4, 4, 0]}
                        fill="#d97541"
                      />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="mt-4 space-y-3">
                    {latest.marketAdjustments.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span>{a.factor}</span>
                        <span className={`font-semibold ${a.adjustment > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {a.adjustment > 0 ? '+' : ''}{a.adjustment.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 text-muted-foreground">No adjustments data available</div>
            )}
          </TabsContent>

          {/* ── HISTORY ── */}
          {history.length > 1 && (
            <TabsContent value="history" className="space-y-4">
              <div className="space-y-3">
                {history.map((v: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold">{formatDollar(v.estimatedValue)}</p>
                          <p className="text-sm text-muted-foreground">
                            {v.pricePerAcre ? `${formatDollar(v.pricePerAcre)}/acre · ` : ''}
                            {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline">{v.confidence}% confidence</Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {v.comparables?.length ?? 0} comps
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}

      {!selectedPropertyId && (
        <div className="text-center py-20 text-muted-foreground">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Select a property to generate an AVM estimate</p>
          <p className="text-sm mt-1">
            The AcreOS Valuation Model™ uses comparable sales, market adjustments, and GPT-4 qualitative analysis
          </p>
        </div>
      )}
    </div>
  );
}
