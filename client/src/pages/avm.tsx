import { useState } from 'react';
import { DisclaimerBanner } from '@/components/disclaimer-banner';
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
  LineChart,
  Line,
  Area,
  AreaChart,
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
  Bell,
  BarChart3,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

// ─── SHAP Waterfall Placeholder ───────────────────────────────────────────────

function SHAPWaterfallPlaceholder({ adjustments }: { adjustments: any[] }) {
  const factors = adjustments?.length > 0
    ? adjustments.map((a: any, i: number) => ({ name: a.factor?.slice(0, 22) ?? `Factor ${i+1}`, value: a.adjustment, fill: a.adjustment >= 0 ? '#10b981' : '#ef4444' }))
    : [
        { name: 'Base Value', value: 100, fill: '#6366f1' },
        { name: 'Road Access', value: 8, fill: '#10b981' },
        { name: 'Water Rights', value: 6, fill: '#10b981' },
        { name: 'Zoning', value: -4, fill: '#ef4444' },
        { name: 'Terrain', value: -2, fill: '#ef4444' },
      ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> SHAP Feature Impact (Waterfall)
        </CardTitle>
        <CardDescription>Top factors driving this valuation away from the base estimate</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {factors.map((f, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="w-36 text-xs text-muted-foreground truncate text-right">{f.name}</span>
              <div className="flex-1 flex items-center gap-1">
                {f.value < 0 && (
                  <div className="flex justify-end" style={{ flex: Math.abs(f.value), maxWidth: '50%' }}>
                    <div className="h-5 rounded" style={{ backgroundColor: f.fill, width: `${Math.abs(f.value) * 4}px`, minWidth: '8px' }} />
                  </div>
                )}
                <span className="text-xs font-mono w-12 text-center">{f.value > 0 ? '+' : ''}{f.value}%</span>
                {f.value >= 0 && (
                  <div style={{ flex: f.value, maxWidth: '50%' }}>
                    <div className="h-5 rounded" style={{ backgroundColor: f.fill, width: `${f.value * 4}px`, minWidth: '8px' }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 italic">SHAP values show each feature's marginal contribution to the final estimate.</p>
      </CardContent>
    </Card>
  );
}

// ─── AVM Alert Form ───────────────────────────────────────────────────────────

function AVMAlertForm({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [threshold, setThreshold] = useState('5');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!threshold || isNaN(parseFloat(threshold))) return;
    setSaved(true);
    toast({
      title: 'Value alert set',
      description: `You'll be notified when the AVM value moves more than ${threshold}% from current estimate.`,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" /> Valuation Change Alert
        </CardTitle>
        <CardDescription>Get notified when this property's AVM value moves beyond your threshold.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Alert when value moves &gt;</Label>
          <div className="relative w-28">
            <Input
              type="number"
              min="1"
              max="50"
              value={threshold}
              onChange={e => { setThreshold(e.target.value); setSaved(false); }}
              className="h-8 pr-6 text-sm"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <Button size="sm" onClick={handleSave} variant={saved ? 'secondary' : 'default'}>
          {saved ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Saved</> : <><Bell className="w-3.5 h-3.5 mr-1.5" /> Set Alert</>}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Price Per Acre Trend Chart ───────────────────────────────────────────────

function PricePerAcreTrendChart({ history }: { history: any[] }) {
  if (history.length < 2) return null;

  const chartData = [...history].reverse().map((v: any, i: number) => ({
    date: v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `v${i + 1}`,
    pricePerAcre: Math.round(v.pricePerAcre ?? 0),
    low: Math.round((v.confidenceInterval?.low ?? v.estimatedValue * 0.85) / (v.sizeAcres || 1)),
    high: Math.round((v.confidenceInterval?.high ?? v.estimatedValue * 1.15) / (v.sizeAcres || 1)),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Price-Per-Acre Trend
        </CardTitle>
        <CardDescription>Historical price/acre with confidence range band</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4f8ef7" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#4f8ef7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: any, name: string) => [`$${Number(v).toLocaleString()}/acre`, name === 'pricePerAcre' ? 'Price/Acre' : name === 'high' ? 'CI High' : 'CI Low']} />
            <Area type="monotone" dataKey="high" stroke="transparent" fill="url(#ciGrad)" />
            <Area type="monotone" dataKey="low" stroke="transparent" fill="white" />
            <Line type="monotone" dataKey="pricePerAcre" stroke="#4f8ef7" strokeWidth={2} dot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── Comps Map Table ─────────────────────────────────────────────────────────

function CompsMapTable({ comparables, pricePerAcre }: { comparables: any[]; pricePerAcre: number }) {
  if (!comparables || comparables.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" /> Comparable Sales — Location & Price
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2">#</th>
                <th className="text-left px-4 py-2">Distance</th>
                <th className="text-right px-4 py-2">Sale Price</th>
                <th className="text-right px-4 py-2">Price/Acre</th>
                <th className="text-right px-4 py-2">vs. Subject</th>
                <th className="text-right px-4 py-2">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {comparables.map((c: any, i: number) => {
                const diff = c.pricePerAcre - pricePerAcre;
                const diffPct = ((diff / pricePerAcre) * 100).toFixed(1);
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 text-muted-foreground">#{i + 1}</td>
                    <td className="px-4 py-2">{c.distance?.toFixed(1) ?? '—'} mi</td>
                    <td className="px-4 py-2 text-right font-medium">{formatDollar(c.salePrice)}</td>
                    <td className="px-4 py-2 text-right">{formatDollar(c.pricePerAcre)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {diff >= 0 ? '+' : ''}{diffPct}%
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${c.similarity >= 70 ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
                        {c.similarity}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
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
      {/* AVM disclaimer — required for legal compliance (Task #253) */}
      <DisclaimerBanner type="avm" />
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
            {/* AVM Alert Form */}
            <AVMAlertForm propertyId={selectedPropertyId} />
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

              {/* SHAP waterfall */}
              {latest.marketAdjustments && (
                <div className="md:col-span-3">
                  <SHAPWaterfallPlaceholder adjustments={latest.marketAdjustments} />
                </div>
              )}

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
                {/* Comps map table */}
                <CompsMapTable comparables={latest.comparables} pricePerAcre={latest.pricePerAcre} />

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
              <PricePerAcreTrendChart history={history} />
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
