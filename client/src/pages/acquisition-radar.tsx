import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
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
  undervalued: { label: 'Undervalued', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  motivated_seller: { label: 'Motivated Seller', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  market_shift: { label: 'Market Shift', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  off_market: { label: 'Off Market', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

const SCORE_COLOR = (score: number) => {
  if (score >= 80) return '#ef4444'; // hot
  if (score >= 60) return '#f97316'; // warm
  if (score >= 40) return '#eab308'; // moderate
  return '#6b7280'; // cold
};

function ScoreBadge({ score }: { score: number }) {
  const bg = score >= 80 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    : score >= 60 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    : score >= 40 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${bg}`}>
      {score >= 80 && <Flame className="w-3 h-3" />}
      {score}
    </span>
  );
}

function OpportunityCard({ opp, onView }: { opp: any; onView: (o: any) => void }) {
  const typeInfo = OPPORTUNITY_LABELS[opp.opportunityType] || { label: opp.opportunityType, color: 'bg-gray-100 text-gray-700' };

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView(opp)}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ScoreBadge score={opp.score} />
              <Badge className={typeInfo.color + ' text-xs'}>{typeInfo.label}</Badge>
            </div>
            <p className="font-medium text-sm truncate">
              {opp.apn ? `APN: ${opp.apn}` : `Parcel #${opp.id}`}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {opp.county}, {opp.state}
            </p>
            {opp.explanation && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{opp.explanation}</p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
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
        <span className="text-muted-foreground">{Math.round(factor.score)}/100 ({factor.weight > 0 ? '+' : ''}{factor.weight}% weight)</span>
      </div>
      <Progress value={Math.abs(factor.score)} className="h-2" />
      {factor.details?.explanation && (
        <p className="text-xs text-muted-foreground">{factor.details.explanation}</p>
      )}
    </div>
  );
}

export default function AcquisitionRadarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [stateFilter, setStateFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [minScore, setMinScore] = useState<string>('40');
  const [selectedOpp, setSelectedOpp] = useState<any>(null);

  const queryParams = new URLSearchParams({
    limit: '50',
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(typeFilter ? { opportunityType: typeFilter } : {}),
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
    onSuccess: () => {
      toast({ title: 'Status updated' });
      queryClient.invalidateQueries({ queryKey: ['radar'] });
      setSelectedOpp(null);
    },
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
            <Target className="w-8 h-8 text-primary" />
            Acquisition Radar
          </h1>
          <p className="text-muted-foreground mt-1">
            AI-scored deal opportunities ranked by acquisition potential across all markets.
          </p>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.totalOpportunities}</div>
              <div className="text-sm text-muted-foreground">Total Opportunities</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-500 flex items-center gap-1">
                <Flame className="w-5 h-5" />
                {stats.hotOpportunities}
              </div>
              <div className="text-sm text-muted-foreground">Hot (80+ score)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.avgScore ?? '—'}</div>
              <div className="text-sm text-muted-foreground">Avg Score</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">
                {stats.lastScanAt ? new Date(stats.lastScanAt).toLocaleDateString() : 'Never'}
              </div>
              <div className="text-sm text-muted-foreground">Last Scan</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">All Opportunities</TabsTrigger>
          <TabsTrigger value="markets">By Market</TabsTrigger>
        </TabsList>

        {/* ── ALL OPPORTUNITIES ── */}
        <TabsContent value="opportunities" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="State (e.g. TX)"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value.toUpperCase())}
              className="w-28"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Opportunity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Types</SelectItem>
                <SelectItem value="undervalued">Undervalued</SelectItem>
                <SelectItem value="motivated_seller">Motivated Seller</SelectItem>
                <SelectItem value="market_shift">Market Shift</SelectItem>
                <SelectItem value="off_market">Off Market</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Min score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="40">Min Score: 40</SelectItem>
                <SelectItem value="60">Min Score: 60</SelectItem>
                <SelectItem value="80">Hot Only (80+)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading && (
            <div className="text-center py-16 text-muted-foreground">Scanning for opportunities…</div>
          )}

          {!isLoading && opportunities.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No opportunities found</p>
              <p className="text-sm mt-1">Adjust filters or configure the radar to scan your target markets</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {opportunities.map((opp: any) => (
              <OpportunityCard key={opp.id} opp={opp} onView={setSelectedOpp} />
            ))}
          </div>
        </TabsContent>

        {/* ── BY MARKET ── */}
        <TabsContent value="markets" className="space-y-6">
          {marketChartData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Top Markets by Avg Opportunity Score</CardTitle>
                <CardDescription>Counties with highest-quality acquisition opportunities</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={marketChartData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis type="category" dataKey="market" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: any, name: string) => [name === 'avgScore' ? `${v}/100` : v, name === 'avgScore' ? 'Avg Score' : 'Count']}
                    />
                    <Bar dataKey="avgScore" name="Avg Score" radius={[0, 4, 4, 0]}>
                      {marketChartData.map((entry, i) => (
                        <Cell key={i} fill={SCORE_COLOR(entry.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No market data available yet</p>
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(byMarket).map(([market, opps]: [string, any]) => (
              <Card key={market}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    {market}
                    <Badge variant="secondary">{opps.length} opportunities</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    {opps.slice(0, 5).map((o: any) => (
                      <button
                        key={o.id}
                        onClick={() => setSelectedOpp(o)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
                      >
                        <ScoreBadge score={o.score} />
                        {o.apn || `#${o.id}`}
                      </button>
                    ))}
                    {opps.length > 5 && (
                      <span className="text-xs text-muted-foreground self-center">
                        +{opps.length - 5} more
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
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
                    <h3 className="font-semibold">Score Breakdown</h3>
                    <FactorBar label="Price vs Assessed Value" factor={selectedOpp.scoreFactors.priceVsAssessed} />
                    <FactorBar label="Days on Market" factor={selectedOpp.scoreFactors.daysOnMarket} />
                    <FactorBar label="Seller Motivation" factor={selectedOpp.scoreFactors.sellerMotivation} />
                    <FactorBar label="Market Velocity" factor={selectedOpp.scoreFactors.marketVelocity} />
                    <FactorBar label="Comparable Spreads" factor={selectedOpp.scoreFactors.comparableSpreads} />
                    <FactorBar label="Environmental Risk" factor={selectedOpp.scoreFactors.environmentalRisk} />
                    <FactorBar label="Owner Signals" factor={selectedOpp.scoreFactors.ownerSignals} />
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'pursuing' })}
                    disabled={statusMutation.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Pursue This Deal
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'reviewed' })}
                    disabled={statusMutation.isPending}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Mark Reviewed
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => statusMutation.mutate({ id: selectedOpp.id, status: 'dismissed' })}
                    disabled={statusMutation.isPending}
                  >
                    <CheckCheck className="w-4 h-4 mr-2" />
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
