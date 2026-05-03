import { useState, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Radar,
  Target,
  Zap,
  TrendingUp,
  MapPin,
  Filter,
  ChevronRight,
  Flame,
  Eye,
  CheckCheck,
} from 'lucide-react';

const OPPORTUNITY_LABELS: Record<string, { label: string; color: string }> = {
  undervalued: { label: 'Undervalued', color: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent' },
  motivated_seller: { label: 'Motivated seller', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn' },
  market_shift: { label: 'Market shift', color: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand' },
  off_market: { label: 'Off market', color: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos' },
};

const SCORE_COLOR = (score: number) => {
  if (score >= 80) return '#ef4444'; // hot
  if (score >= 60) return '#f97316'; // warm
  if (score >= 40) return '#eab308'; // moderate
  return '#6b7280'; // cold
};

function ScoreBadge({ score }: { score: number }) {
  const tier = score >= 80 ? 'hot' : score >= 60 ? 'warm' : score >= 40 ? 'moderate' : 'cold';
  const bg = score >= 80 ? 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg'
    : score >= 60 ? 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn'
    : score >= 40 ? 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn'
    : 'bg-muted text-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground';

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${bg}`}
      aria-label={`Score ${score} of 100, ${tier} tier`}
    >
      {score >= 80 && <Flame className="w-3 h-3" aria-hidden="true" />}
      {score}
    </span>
  );
}

function OpportunityCard({ opp, onView }: { opp: any; onView: (o: any) => void }) {
  const typeInfo = OPPORTUNITY_LABELS[opp.opportunityType] || { label: opp.opportunityType, color: 'bg-muted text-foreground' };
  const label = opp.apn ? `APN: ${opp.apn}` : `Parcel #${opp.id}`;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${label}, score ${opp.score}, ${typeInfo.label}, ${opp.county} ${opp.state}`}
      className="hover:shadow-md transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onView(opp)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView(opp);
        }
      }}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ScoreBadge score={opp.score} />
              <Badge className={typeInfo.color + ' text-xs'}>{typeInfo.label}</Badge>
            </div>
            <p className="font-medium text-sm truncate">{label}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {opp.county}, {opp.state}
            </p>
            {opp.explanation && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{opp.explanation}</p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function FactorBar({ label, factor }: { label: string; factor: any }) {
  if (!factor) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(factor.score)}/100 ({factor.weight > 0 ? '+' : ''}{factor.weight}% weight)
        </span>
      </div>
      <Progress
        value={Math.abs(factor.score)}
        className="h-2"
        role="progressbar"
        aria-valuenow={Math.round(Math.abs(factor.score))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(factor.score)} out of 100, ${factor.weight}% weight`}
      />
      {factor.details?.explanation && (
        <p className="text-xs text-muted-foreground">{factor.details.explanation}</p>
      )}
    </div>
  );
}

export default function AcquisitionRadarPage() {
  useDocumentTitle('Acquisition radar');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [stateFilter, setStateFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [minScore, setMinScore] = useState<string>('40');
  const [selectedOpp, setSelectedOpp] = useState<any>(null);
  const stateFilterId = useId();
  const typeFilterId = useId();
  const minScoreId = useId();

  const queryParams = new URLSearchParams({
    limit: '50',
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(typeFilter && typeFilter !== 'all' ? { opportunityType: typeFilter } : {}),
    minScore,
  }).toString();

  const { data: oppsData, isLoading } = useQuery({
    queryKey: ['radar', 'opportunities', stateFilter, typeFilter, minScore],
    queryFn: async () => {
      const res = await fetch(`/api/radar/opportunities?${queryParams}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch opportunities');
      return res.json();
    },
  });

  const { data: statsData } = useQuery({
    queryKey: ['radar', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/radar/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch radar stats');
      return res.json();
    },
  });

  const { data: byMarketData } = useQuery({
    queryKey: ['radar', 'by-market'],
    queryFn: async () => {
      const res = await fetch('/api/radar/opportunities/by-market', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch market breakdown');
      return res.json();
    },
  });

  const STATUS_TOAST: Record<string, string> = {
    pursuing: "Marked as pursuing — added to your active deal flow.",
    reviewed: "Marked as reviewed.",
    dismissed: "Dismissed — removed from your radar.",
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/radar/opportunities/${id}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: (_data, { status }) => {
      toast({ title: STATUS_TOAST[status] ?? "Status updated." });
      queryClient.invalidateQueries({ queryKey: ['radar'] });
      setSelectedOpp(null);
    },
    onError: () =>
      toast({
        title: "Couldn't update status",
        description: "The opportunity is still in its previous state. Try again in a moment.",
        variant: 'destructive',
      }),
  });

  const opportunities = oppsData?.opportunities ?? [];
  const stats = statsData?.stats;
  const byMarket = byMarketData?.byMarket ?? {};

  const marketChartData = Object.entries(byMarket)
    .map(([market, opps]: [string, any]) => ({
      market: market.length > 20 ? market.substring(0, 18) + '…' : market,
      count: opps.length,
      avgScore: Math.round(opps.reduce((s: number, o: any) => s + o.score, 0) / opps.length),
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 12);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Target className="w-8 h-8 text-primary" aria-hidden="true" />
            Acquisition radar
          </h1>
          <p className="text-muted-foreground mt-1">
            AI-scored deal opportunities ranked by acquisition potential across all markets.
          </p>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 flex flex-col-reverse">
              <dt className="text-sm text-muted-foreground">Total opportunities</dt>
              <dd className="text-2xl font-bold tabular-nums">{stats.totalOpportunities}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex flex-col-reverse">
              <dt className="text-sm text-muted-foreground">Hot (80+ score)</dt>
              <dd className="text-2xl font-bold text-acr-neg flex items-center gap-1 tabular-nums">
                <Flame className="w-5 h-5" aria-hidden="true" />
                {stats.hotOpportunities}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex flex-col-reverse">
              <dt className="text-sm text-muted-foreground">Average score</dt>
              <dd className="text-2xl font-bold tabular-nums">{stats.avgScore ?? '—'}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex flex-col-reverse">
              <dt className="text-sm text-muted-foreground">Last scan</dt>
              <dd className="text-2xl font-bold tabular-nums">
                {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleDateString() : 'Never'}
              </dd>
            </CardContent>
          </Card>
        </dl>
      )}

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">All opportunities</TabsTrigger>
          <TabsTrigger value="markets">By market</TabsTrigger>
        </TabsList>

        {/* ── ALL OPPORTUNITIES ── */}
        <TabsContent value="opportunities" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={stateFilterId} className="sr-only">Filter by state</Label>
            <Input
              id={stateFilterId}
              placeholder="State (e.g. TX)"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value.toUpperCase())}
              className="w-28 uppercase"
              maxLength={2}
              autoCapitalize="characters"
              autoComplete="address-level1"
              autoCorrect="off"
              spellCheck={false}
            />
            <Label htmlFor={typeFilterId} className="sr-only">Opportunity type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger id={typeFilterId} className="w-56">
                <SelectValue placeholder="Opportunity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="undervalued">Undervalued — price below comparable values</SelectItem>
                <SelectItem value="motivated_seller">Motivated seller — signals suggest urgency</SelectItem>
                <SelectItem value="market_shift">Market shift — recent trend change</SelectItem>
                <SelectItem value="off_market">Off market — not publicly listed</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor={minScoreId} className="sr-only">Minimum score</Label>
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger id={minScoreId} className="w-36">
                <SelectValue placeholder="Min score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="40">Min score: 40</SelectItem>
                <SelectItem value="60">Min score: 60</SelectItem>
                <SelectItem value="80">Hot only (80+)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading && (
            <div className="text-center py-16 text-muted-foreground" role="status" aria-live="polite">
              Scanning for opportunities…
            </div>
          )}

          {!isLoading && opportunities.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Target className="w-12 h-12 mx-auto mb-4 opacity-30" aria-hidden="true" />
              <p className="text-lg font-medium">No opportunities found.</p>
              <p className="text-sm mt-1">Adjust filters or configure the radar to scan your target markets.</p>
            </div>
          )}

          <ul
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            aria-label="Acquisition opportunities"
          >
            {opportunities.map((opp: any) => (
              <li key={opp.id}>
                <OpportunityCard opp={opp} onView={setSelectedOpp} />
              </li>
            ))}
          </ul>
        </TabsContent>

        {/* ── BY MARKET ── */}
        <TabsContent value="markets" className="space-y-6">
          {marketChartData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Top markets by avg opportunity score</CardTitle>
                <CardDescription>Counties with highest-quality acquisition opportunities.</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  role="img"
                  aria-label={`Top ${marketChartData.length} markets ranked by average opportunity score: ${marketChartData.map(m => `${m.market} ${m.avgScore} of 100`).join(', ')}`}
                >
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={marketChartData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis type="category" dataKey="market" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={((v: any, name: string) => [name === 'avgScore' ? `${v}/100` : v, name === 'avgScore' ? 'Average score' : 'Count']) as any}
                      />
                      <Bar dataKey="avgScore" name="Average score" radius={[0, 4, 4, 0]}>
                        {marketChartData.map((entry, i) => (
                          <Cell key={i} fill={SCORE_COLOR(entry.avgScore)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-30" aria-hidden="true" />
              <p>No market data available yet.</p>
            </div>
          )}

          <ul className="space-y-4" aria-label="Opportunities by market">
            {Object.entries(byMarket).map(([market, opps]: [string, any]) => (
              <li key={market}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
                      {market}
                      <Badge variant="secondary">
                        <span className="tabular-nums mr-1">{opps.length}</span> opportunities
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex gap-2 flex-wrap" aria-label={`Top opportunities in ${market}`}>
                      {opps.slice(0, 5).map((o: any) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedOpp(o)}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-muted transition-colors min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Open ${o.apn || `opportunity #${o.id}`}, score ${o.score}`}
                          >
                            <ScoreBadge score={o.score} />
                            {o.apn || `#${o.id}`}
                          </button>
                        </li>
                      ))}
                      {opps.length > 5 && (
                        <li className="text-xs text-muted-foreground self-center">
                          +<span className="tabular-nums">{opps.length - 5}</span> more
                        </li>
                      )}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {/* Opportunity Detail Dialog */}
      <Dialog open={!!selectedOpp} onOpenChange={() => setSelectedOpp(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedOpp && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ScoreBadge score={selectedOpp.score} />
                  {selectedOpp.apn ? `APN: ${selectedOpp.apn}` : `Opportunity #${selectedOpp.id}`}
                </DialogTitle>
                <DialogDescription>
                  {selectedOpp.county}, {selectedOpp.state} ·{' '}
                  <Badge className={OPPORTUNITY_LABELS[selectedOpp.opportunityType]?.color + ' text-xs'}>
                    {OPPORTUNITY_LABELS[selectedOpp.opportunityType]?.label || selectedOpp.opportunityType}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 pt-2">
                {/* Explanation */}
                {selectedOpp.explanation && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm">{selectedOpp.explanation}</p>
                  </div>
                )}

                {/* Factor breakdown */}
                {selectedOpp.scoreFactors && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">Score breakdown</h3>
                    <FactorBar label="Price vs. assessed value" factor={selectedOpp.scoreFactors.priceVsAssessed} />
                    <FactorBar label="Days on market" factor={selectedOpp.scoreFactors.daysOnMarket} />
                    <FactorBar label="Seller motivation" factor={selectedOpp.scoreFactors.sellerMotivation} />
                    <FactorBar label="Market velocity" factor={selectedOpp.scoreFactors.marketVelocity} />
                    <FactorBar label="Comparable spreads" factor={selectedOpp.scoreFactors.comparableSpreads} />
                    <FactorBar label="Environmental risk" factor={selectedOpp.scoreFactors.environmentalRisk} />
                    <FactorBar label="Owner signals" factor={selectedOpp.scoreFactors.ownerSignals} />
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    variant="default"
                    className="flex-1 min-h-11"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'pursuing' })}
                    disabled={statusMutation.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" aria-hidden="true" />
                    Pursue this deal
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'reviewed' })}
                    disabled={statusMutation.isPending}
                  >
                    <Eye className="w-4 h-4 mr-2" aria-hidden="true" />
                    Mark reviewed
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'dismissed' })}
                    disabled={statusMutation.isPending}
                  >
                    <CheckCheck className="w-4 h-4 mr-2" aria-hidden="true" />
                    Dismiss
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
