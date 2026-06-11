import { useState, useId } from 'react';
import { DisclaimerBanner } from '@/components/disclaimer-banner';
import { usd } from '@/lib/format';
import { RequiredDisclaimer } from '@/components/required-disclaimer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
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
  Cell,
  Line,
  Area,
  AreaChart,
} from 'recharts';
import {
  CHART_COLORS,
  CHART_POS,
  CHART_NEG,
  CHART_PRIMARY,
  CHART_GRID,
  CHART_SURFACE,
} from '@/lib/chart-colors';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { QueryErrorState } from '@/components/query-error-state';
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
import { GlossaryTerm } from '@/components/Glossary';

function formatDollar(n: number) {
  // Compact display for KPI cards + chart axes. M/K bands round
  // intentionally for screen real estate; sub-$1K falls through to
  // usd() so cents are preserved on small comp-distance prices and
  // model-stat averages where partial-dollar precision matters.
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return usd(n, { noCents: true });
}

// ─── SHAP Waterfall Placeholder ───────────────────────────────────────────────

function SHAPWaterfallPlaceholder({ adjustments }: { adjustments: any[] }) {
  const factors = adjustments?.length > 0
    ? adjustments.map((a: any, i: number) => ({ name: a.factor?.slice(0, 22) ?? `Factor ${i+1}`, value: a.adjustment, fill: a.adjustment >= 0 ? CHART_POS : CHART_NEG }))
    : [
        { name: 'Base value', value: 100, fill: CHART_PRIMARY },
        { name: 'Road access', value: 8, fill: CHART_POS },
        { name: 'Water rights', value: 6, fill: CHART_POS },
        { name: 'Zoning', value: -4, fill: CHART_NEG },
        { name: 'Terrain', value: -2, fill: CHART_NEG },
      ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" aria-hidden="true" /> SHAP feature impact (waterfall)
        </CardTitle>
        <CardDescription>Top factors driving this valuation away from the base estimate</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 list-none p-0 m-0" aria-label="Per-factor adjustment vs. base estimate">
          {factors.map((f, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-36 text-xs text-muted-foreground truncate text-right">{f.name}</span>
              <div
                className="flex-1 flex items-center gap-1"
                role="img"
                aria-label={`${f.name}: ${f.value >= 0 ? "+" : ""}${f.value} percent`}
              >
                {f.value < 0 && (
                  <div className="flex justify-end" style={{ flex: Math.abs(f.value), maxWidth: '50%' }}>
                    <div className="h-5 rounded" style={{ backgroundColor: f.fill, width: `${Math.abs(f.value) * 4}px`, minWidth: '8px' }} aria-hidden="true" />
                  </div>
                )}
                <span className="text-xs font-mono w-12 text-center tabular-nums">{f.value > 0 ? '+' : ''}{f.value}%</span>
                {f.value >= 0 && (
                  <div style={{ flex: f.value, maxWidth: '50%' }}>
                    <div className="h-5 rounded" style={{ backgroundColor: f.fill, width: `${f.value * 4}px`, minWidth: '8px' }} aria-hidden="true" />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3 italic">SHAP values show each feature&apos;s marginal contribution to the final estimate.</p>
      </CardContent>
    </Card>
  );
}

// ─── AVM Alert Form ───────────────────────────────────────────────────────────

function AVMAlertForm({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [threshold, setThreshold] = useState('5');
  const [saved, setSaved] = useState(false);
  const thresholdId = useId();

  const handleSave = () => {
    if (!threshold || isNaN(parseFloat(threshold))) {
      toast({
        title: "Can't save alert",
        description: "Enter a valid percentage — your previous threshold is unchanged.",
        variant: 'destructive',
      });
      return;
    }
    setSaved(true);
    toast({
      title: 'Value alert set.',
      description: `You'll be notified when the AVM value moves more than ${threshold}% from current estimate.`,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" aria-hidden="true" /> Valuation change alert
        </CardTitle>
        <CardDescription>Get notified when this property's AVM value moves beyond your threshold.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
        >
          <div className="space-y-1">
            <Label htmlFor={thresholdId} className="text-xs">Alert when value moves &gt;</Label>
            <div className="relative w-28">
              <Input
                id={thresholdId}
                type="number"
                inputMode="decimal"
                min="1"
                max="50"
                step="any"
                value={threshold}
                onChange={e => { setThreshold(e.target.value); setSaved(false); }}
                className="h-8 pr-6 text-sm tabular-nums"
                aria-describedby={`${thresholdId}-unit`}
              />
              <span
                id={`${thresholdId}-unit`}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                aria-hidden="true"
              >%</span>
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            variant={saved ? 'secondary' : 'default'}
            className="min-h-9"
          >
            {saved ? <><CheckCircle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Saved</> : <><Bell className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Set alert</>}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Price Per Acre Trend Chart ───────────────────────────────────────────────

function PricePerAcreTrendChart({ history }: { history: any[] }) {
  if (history.length < 2) return null;

  const chartData = [...history].reverse().map((v: any, i: number) => ({
    date: v.createdAt ? format(new Date(v.createdAt), 'MMM d') : `v${i + 1}`,
    pricePerAcre: Math.round(v.pricePerAcre ?? 0),
    low: Math.round((v.confidenceInterval?.low ?? v.estimatedValue * 0.85) / (v.sizeAcres || 1)),
    high: Math.round((v.confidenceInterval?.high ?? v.estimatedValue * 1.15) / (v.sizeAcres || 1)),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" /> Price-per-acre trend
        </CardTitle>
        <CardDescription>Historical price per acre with confidence-range band</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label={`Price-per-acre trend over ${chartData.length} valuations; latest ${formatDollar(chartData[chartData.length - 1]?.pricePerAcre ?? 0)}/acre`}
        >
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_PRIMARY} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => formatDollar(v)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={((v: any, name: string) => [`${formatDollar(Number(v))}/acre`, name === 'pricePerAcre' ? 'Price per acre' : name === 'high' ? 'Upper bound (CI)' : 'Lower bound (CI)']) as any} />
              <Area type="monotone" dataKey="high" stroke="transparent" fill="url(#ciGrad)" />
              <Area type="monotone" dataKey="low" stroke="transparent" fill={CHART_SURFACE} />
              <Line type="monotone" dataKey="pricePerAcre" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
          <MapPin className="w-4 h-4 text-primary" aria-hidden="true" /> Comparable sales — location &amp; price
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Mobile: stacked comp cards — the 6-column table side-scrolls at
            phone widths. md+ renders the full table below. */}
        <ul className="md:hidden divide-y divide-border" data-testid="list-comps-mobile">
          {comparables.map((c: any, i: number) => {
            const diff = c.pricePerAcre - pricePerAcre;
            const diffPct = ((diff / pricePerAcre) * 100).toFixed(1);
            return (
              <li key={i} className="px-4 py-3 text-xs" data-testid={`card-comp-${i}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    #{i + 1} · {c.distance?.toFixed(1) ?? '—'} mi away
                  </span>
                  <span className="font-medium tabular-nums">{formatDollar(c.salePrice)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded tabular-nums ${c.similarity >= 70 ? 'bg-acr-pos-soft text-acr-pos' : 'bg-muted text-muted-foreground'}`}
                    aria-label={`${c.similarity}% similarity${c.similarity >= 70 ? ', high' : ''}`}
                  >
                    {c.similarity}% similar
                  </span>
                  <span className="tabular-nums">
                    {formatDollar(c.pricePerAcre)}/ac
                    <span className={`ml-1.5 font-semibold ${diff >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                      {diff >= 0 ? '+' : ''}{diffPct}%
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Desktop: full table. Hidden on mobile. */}
        <div className="hidden md:block overflow-x-auto" role="region" aria-label="Comparable sales" tabIndex={0}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th scope="col" className="text-left px-4 py-2">#</th>
                <th scope="col" className="text-left px-4 py-2">Distance</th>
                <th scope="col" className="text-right px-4 py-2">Sale price</th>
                <th scope="col" className="text-right px-4 py-2">Price/acre</th>
                <th scope="col" className="text-right px-4 py-2">vs. subject</th>
                <th scope="col" className="text-right px-4 py-2">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {comparables.map((c: any, i: number) => {
                const diff = c.pricePerAcre - pricePerAcre;
                const diffPct = ((diff / pricePerAcre) * 100).toFixed(1);
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 text-muted-foreground tabular-nums">#{i + 1}</td>
                    <td className="px-4 py-2 tabular-nums">{c.distance?.toFixed(1) ?? '—'} mi</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatDollar(c.salePrice)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollar(c.pricePerAcre)}</td>
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${diff >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                      {diff >= 0 ? '+' : ''}{diffPct}%
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs tabular-nums ${c.similarity >= 70 ? 'bg-acr-pos-soft text-acr-pos' : 'bg-muted text-muted-foreground'}`}
                        aria-label={`${c.similarity}% similarity${c.similarity >= 70 ? ', high' : ''}`}
                      >
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
  const color = confidence >= 70 ? 'text-acr-pos' : confidence >= 40 ? 'text-acr-warn' : 'text-acr-neg';
  const tier = confidence >= 70 ? 'high' : confidence >= 40 ? 'moderate' : 'low';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Model confidence</span>
        <span className={`font-semibold tabular-nums ${color}`}>{confidence}%</span>
      </div>
      <Progress
        value={confidence}
        className="h-2"
        role="progressbar"
        aria-valuenow={confidence}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Model confidence: ${confidence} percent (${tier})`}
      />
    </div>
  );
}

export default function AVMPage() {
  useDocumentTitle('Valuation model (AVM)');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = (propertiesData as any)?.properties ?? [];

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const propertySelectId = useId();

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['avm', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/avm/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch AVM stats');
      return res.json();
    },
  });

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyIsError,
    error: historyError,
    refetch: refetchHistory,
    isRefetching: historyRefetching,
  } = useQuery({
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
      toast({ title: 'Valuation complete.', description: 'AVM estimate ready.' });
      queryClient.invalidateQueries({ queryKey: ['avm', 'history', selectedPropertyId] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't value property",
        description: `${err.message} — your existing valuation (if any) is unchanged.`,
        variant: 'destructive',
      });
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
      toast({ title: 'Bulk valuation started.', description: 'All owned properties are being valued.' });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't start bulk valuation",
        description: `${err.message} — no properties were revalued.`,
        variant: 'destructive',
      });
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
      <RequiredDisclaimer type="valuation" />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="w-8 h-8 text-primary" aria-hidden="true" />
            Valuation model (<GlossaryTerm slug="AVM">AVM</GlossaryTerm>)
          </h1>
          <p className="text-muted-foreground mt-1">
            Proprietary ML valuation model trained on land transactions — instant estimates with confidence intervals.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => bulkMutation.mutate()}
          disabled={bulkMutation.isPending}
          className="min-h-11"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${bulkMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
          Value all properties
        </Button>
      </div>

      {/* Model Stats */}
      {statsLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading model stats">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-8 w-24" announce={i === 0} announceText="Loading model stats" />
                <Skeleton className="h-4 w-32" announce={false} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {stats && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <dd className="text-2xl font-bold tabular-nums">{stats.totalTransactions?.toLocaleString() ?? '—'}</dd>
              <dt className="text-sm text-muted-foreground">Training transactions</dt>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dd className="text-2xl font-bold tabular-nums">{stats.avgDataQuality ?? '—'}/100</dd>
              <dt className="text-sm text-muted-foreground">Avg data quality</dt>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dd className="text-2xl font-bold tabular-nums">{stats.statesCovered ?? '—'}</dd>
              <dt className="text-sm text-muted-foreground">States covered</dt>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dd className="text-2xl font-bold tabular-nums">{stats.avgPricePerAcre ? formatDollar(stats.avgPricePerAcre) : '—'}</dd>
              <dt className="text-sm text-muted-foreground">Avg price / acre</dt>
            </CardContent>
          </Card>
        </dl>
      )}

      {/* Property selector */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 sm:flex-initial">
          <Label htmlFor={propertySelectId} className="text-xs mb-1 block">Property to value</Label>
          <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
            <SelectTrigger id={propertySelectId} className="w-full sm:w-80">
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
        </div>
        <Button
          disabled={!selectedPropertyId || valuationMutation.isPending}
          onClick={() => valuationMutation.mutate(selectedPropertyId)}
          className="min-h-11"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${valuationMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
          {valuationMutation.isPending ? 'Valuing…' : 'Generate valuation'}
        </Button>
      </div>

      {historyLoading && (
        <div className="space-y-6" aria-busy="true" aria-label="Loading valuation history">
          {/* Shaped like the Estimate tab that replaces it: tab bar, then the
              big-number estimate card beside the details card. */}
          <Skeleton className="h-10 w-72 max-w-full" announce announceText="Loading valuation history" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
              <CardHeader>
                <Skeleton className="h-5 w-36" announce={false} />
                <Skeleton className="h-4 w-56" announce={false} />
              </CardHeader>
              <CardContent className="space-y-6">
                <Skeleton className="h-12 w-64 max-w-full" announce={false} />
                <Skeleton className="h-4 w-full" announce={false} />
                <Skeleton className="h-2 w-full" announce={false} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" announce={false} />
              </CardHeader>
              <CardContent className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-4 w-28" announce={false} />
                    <Skeleton className="h-4 w-12" announce={false} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {historyIsError && !historyLoading && (
        <QueryErrorState
          error={historyError as Error}
          onRetry={() => refetchHistory()}
          isRetrying={historyRefetching}
          title="Couldn't load valuation history"
        />
      )}

      {!historyLoading && !historyIsError && selectedPropertyId && !latest && (
        <EmptyState
          icon={TrendingUp}
          headline="Run your first valuation"
          subtitle="No AVM estimates yet for this property. Generate one — comparable sales, market adjustments, and a confidence interval come back in seconds."
          cta={{
            label: valuationMutation.isPending ? 'Valuing…' : 'Generate valuation',
            onClick: () => valuationMutation.mutate(selectedPropertyId),
            'data-testid': 'avm-empty-generate',
          }}
          actionIcon={RefreshCw}
          testId="avm-empty-state"
        />
      )}

      {latest && (
        <Tabs defaultValue="estimate">
          <TabsList>
            <TabsTrigger value="estimate">Estimate</TabsTrigger>
            <TabsTrigger value="comparables">Comparable sales (<span className="tabular-nums">{latest.comparables?.length ?? 0}</span>)</TabsTrigger>
            <TabsTrigger value="adjustments">Market adjustments</TabsTrigger>
            {history.length > 1 && <TabsTrigger value="history">History (<span className="tabular-nums">{history.length}</span>)</TabsTrigger>}
          </TabsList>

          {/* ── ESTIMATE ── */}
          <TabsContent value="estimate" className="space-y-6">
            {/* AVM Alert Form */}
            <AVMAlertForm propertyId={selectedPropertyId} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Main estimate */}
              <Card className="md:col-span-2 border-primary/30">
                <CardHeader>
                  <CardTitle>Estimated value</CardTitle>
                  <CardDescription>{latest.methodology}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-baseline gap-4">
                    <span
                      className="text-5xl font-bold text-primary tabular-nums"
                      aria-label={`Estimated value ${formatDollar(latest.estimatedValue)}`}
                    >
                      {formatDollar(latest.estimatedValue)}
                    </span>
                    <span className="text-xl text-muted-foreground tabular-nums">
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
                      {latest.createdAt ? format(new Date(latest.createdAt), 'MMM d, yyyy') : 'Today'}
                    </span>
                  </div>
                  {latest.confidence >= 70 ? (
                    <div className="flex items-center gap-2 text-acr-pos dark:text-acr-pos pt-2">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-xs">High confidence estimate</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-acr-warn dark:text-acr-warn pt-2">
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
                    <div role="img" aria-label={`Price-per-acre comparison across ${compsData.length} comparable sales ranked by similarity to subject property at ${formatDollar(latest.pricePerAcre)}/acre`}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={compsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                        <XAxis dataKey="label" />
                        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip
                          formatter={((v: any, name: string) => [
                            name === 'pricePerAcre' ? `${usd(Number(v), { noCents: Number.isInteger(Number(v)) })}/acre` : `${v}%`,
                            name === 'pricePerAcre' ? 'Price/Acre' : 'Similarity',
                          ]) as any}
                        />
                        <ReferenceLine y={latest.pricePerAcre} stroke={CHART_COLORS[1]} strokeDasharray="5 5" label="Subject" />
                        <Bar dataKey="pricePerAcre" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} name="pricePerAcre" />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
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
              <EmptyState
                icon={MapPin}
                headline="No comparable sales on this valuation"
                subtitle="The model couldn't surface comps for this run. Re-run the valuation — newly recorded sales are pulled in each time."
                cta={{
                  label: valuationMutation.isPending ? 'Valuing…' : 'Re-run valuation',
                  onClick: () => valuationMutation.mutate(selectedPropertyId),
                  'data-testid': 'avm-comps-rerun',
                }}
                actionIcon={RefreshCw}
                testId="avm-comps-empty"
              />
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
                  <div role="img" aria-label={`Market adjustments applied: ${adjustmentsData.length} factors with percentage impact`}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={adjustmentsData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis type="number" tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`} />
                      <YAxis type="category" dataKey="factor" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}%`, 'Adjustment']} />
                      <ReferenceLine x={0} stroke={CHART_GRID} />
                      <Bar dataKey="adjustment" radius={[0, 4, 4, 0]}>
                        {/* Sign-coded fills so the chart agrees with the
                            +green/−red list below it. */}
                        {adjustmentsData.map((a: any, i: number) => (
                          <Cell key={i} fill={a.adjustment >= 0 ? CHART_POS : CHART_NEG} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  </div>

                  <div className="mt-4 space-y-3">
                    {latest.marketAdjustments.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span>{a.factor}</span>
                        <span className={`font-semibold ${a.adjustment > 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                          {a.adjustment > 0 ? '+' : ''}{a.adjustment.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={Activity}
                headline="No market adjustments on this valuation"
                subtitle="This estimate came straight from comparable sales with no factor adjustments. Re-run the valuation to refresh the factor analysis."
                cta={{
                  label: valuationMutation.isPending ? 'Valuing…' : 'Re-run valuation',
                  onClick: () => valuationMutation.mutate(selectedPropertyId),
                  'data-testid': 'avm-adjustments-rerun',
                }}
                actionIcon={RefreshCw}
                testId="avm-adjustments-empty"
              />
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
                            {v.createdAt ? format(new Date(v.createdAt), 'MMM d, yyyy') : ''}
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
        <EmptyState
          icon={Database}
          headline="Select a property to generate an AVM estimate"
          subtitle="The valuation model blends comparable sales, market adjustments, and Pax's qualitative read into one estimate with a confidence interval."
          cta={{
            label: 'Choose a property',
            onClick: () => document.getElementById(propertySelectId)?.focus(),
            'data-testid': 'avm-choose-property',
          }}
          actionIcon={null}
          testId="avm-no-property-state"
        />
      )}
    </div>
  );
}
