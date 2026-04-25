import { useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  Phone,
  PhoneCall,
  Clock,
  TrendingUp,
  Search,
  Activity,
  BarChart2,
} from 'lucide-react';

const OUTCOME_COLORS: Record<string, string> = {
  interested: '#10b981',
  'not-interested': '#ef4444',
  callback: '#f59e0b',
  voicemail: '#6366f1',
};

const PIE_COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6366f1', '#d97541'];

function MetricCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-bold mt-0.5 tabular-nums">{value}</dd>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground" aria-hidden="true">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

export default function VoiceAnalyticsPage() {
  useDocumentTitle("Voice analytics");
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchId = useId();

  const { data: analyticsData } = useQuery({
    queryKey: ['voice', 'analytics'],
    queryFn: async () => {
      const res = await fetch('/api/voice/analytics', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
  });

  const { data: callsData } = useQuery({
    queryKey: ['voice', 'calls'],
    queryFn: async () => {
      const res = await fetch('/api/voice/calls?limit=100', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch calls');
      return res.json();
    },
  });

  const analytics = analyticsData?.analytics;
  const calls: any[] = callsData?.calls ?? [];

  const volumeByDay = (() => {
    const map: Record<string, number> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      map[key] = 0;
    }
    for (const call of calls) {
      const d = new Date(call.createdAt);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (key in map) map[key]++;
    }
    return Object.entries(map).map(([date, count]) => ({ date, count }));
  })();

  const sentimentTrend = (() => {
    const map: Record<string, { total: number; count: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      map[key] = { total: 0, count: 0 };
    }
    for (const call of calls) {
      const d = new Date(call.createdAt);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (key in map) {
        const score = call.sentiment === 'positive' ? 1 : call.sentiment === 'negative' ? -1 : 0;
        map[key].total += score;
        map[key].count++;
      }
    }
    return Object.entries(map).map(([date, v]) => ({
      date,
      sentiment: v.count > 0 ? parseFloat((v.total / v.count).toFixed(2)) : 0,
    }));
  })();

  const outcomeDistribution = (() => {
    const map: Record<string, number> = {};
    for (const call of calls) {
      const outcome = (call as any).outcome || 'untagged';
      map[outcome] = (map[outcome] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  const taggedCalls = calls.filter(c => (c as any).outcome);
  const interestedCalls = calls.filter(c => (c as any).outcome === 'interested');
  const conversionRate =
    taggedCalls.length > 0
      ? ((interestedCalls.length / taggedCalls.length) * 100).toFixed(1)
      : '0.0';

  const completedCalls = calls.filter(c => c.duration > 0);
  const avgDuration =
    completedCalls.length > 0
      ? Math.round(completedCalls.reduce((s, c) => s + c.duration, 0) / completedCalls.length)
      : 0;
  const longestCalls = [...completedCalls].sort((a, b) => b.duration - a.duration).slice(0, 5);

  const activeCalls = calls.filter(c => ['active', 'initiated'].includes(c.status));

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/voice/transcripts/search?q=${encodeURIComponent(searchQuery)}&limit=20`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Search request failed');
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch (err: any) {
      toast({
        title: "Couldn't search transcripts",
        description: `${err.message ?? 'Network error'}. Your query is still on this device — try again.`,
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSearch();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart2 className="w-8 h-8 text-primary" aria-hidden="true" />
            Voice analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Call volume, sentiment trends, conversion rates, and transcript search.
          </p>
        </div>
        {activeCalls.length > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg"
            role="status"
            aria-label={`${activeCalls.length} active call${activeCalls.length === 1 ? '' : 's'} right now`}
          >
            <span className="relative flex h-3 w-3" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">
              {activeCalls.length} active call{activeCalls.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total calls"
          value={analytics?.totalCalls ?? calls.length}
          sub={`${analytics?.inboundVsOutbound?.inbound ?? 0} in / ${analytics?.inboundVsOutbound?.outbound ?? 0} out`}
          icon={<Phone className="w-5 h-5" />}
        />
        <MetricCard
          label="Average duration"
          value={formatSeconds(analytics?.averageDuration ?? avgDuration)}
          sub="Per completed call"
          icon={<Clock className="w-5 h-5" />}
        />
        <MetricCard
          label="Call-to-conversion"
          value={`${conversionRate}%`}
          sub={`${interestedCalls.length} of ${taggedCalls.length} tagged calls`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <MetricCard
          label="Active right now"
          value={activeCalls.length}
          sub="Live calls in progress"
          icon={<Activity className="w-5 h-5" />}
        />
      </dl>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Call volume (last 14 days)</CardTitle>
            <CardDescription>Total calls per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="img"
              aria-label={`Daily call volume over 14 days, ${volumeByDay.reduce((s, d) => s + d.count, 0)} total`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#d97541" radius={[4, 4, 0, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sentiment trend</CardTitle>
            <CardDescription>Average sentiment score over time (-1 to +1)</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="img"
              aria-label={`Sentiment trend across 14 days; latest average ${sentimentTrend[sentimentTrend.length - 1]?.sentiment ?? 0}`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={sentimentTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis domain={[-1, 1]} />
                  <Tooltip formatter={(v: any) => [v.toFixed(2), 'Average sentiment']} />
                  <Line
                    type="monotone"
                    dataKey="sentiment"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Call outcome distribution</CardTitle>
            <CardDescription>Interested / not interested / callback / voicemail</CardDescription>
          </CardHeader>
          <CardContent>
            {outcomeDistribution.length > 0 ? (
              <div
                role="img"
                aria-label={`Call outcomes: ${outcomeDistribution.map(o => `${o.name} ${o.value}`).join(', ')}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={outcomeDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, value }: any) => `${name}: ${value}`}
                    >
                      {outcomeDistribution.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={OUTCOME_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
                <PhoneCall className="w-10 h-10 mb-2 opacity-30" aria-hidden="true" />
                <p className="text-sm">No outcome data yet. Tag calls with outcomes.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Talk time analytics</CardTitle>
            <CardDescription>Longest calls in your history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <p className="text-sm text-muted-foreground">Average call duration</p>
              <p className="text-2xl font-bold tabular-nums">{formatSeconds(avgDuration)}</p>
            </div>
            {longestCalls.length > 0 ? (
              <ol className="space-y-2 list-none p-0 m-0" aria-label="Top five longest calls">
                {longestCalls.map((call, i) => (
                  <li key={call.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground w-4 tabular-nums">{i + 1}.</span>
                      <a
                        href={`tel:${call.phoneNumber}`}
                        className="truncate max-w-[180px] hover:underline"
                        aria-label={`Call ${call.phoneNumber}`}
                      >
                        {call.phoneNumber}
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" aria-label={`Direction: ${call.direction}`}>{call.direction}</Badge>
                      <span className="font-mono text-xs tabular-nums">{formatSeconds(call.duration)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No completed calls yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {analytics?.sentimentBreakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Sentiment breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex gap-6 list-none p-0 m-0 flex-wrap" aria-label="Sentiment breakdown across all calls">
              {Object.entries(analytics.sentimentBreakdown).map(([label, count]: [string, any]) => (
                <li key={label} className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      label === 'positive'
                        ? 'bg-emerald-500'
                        : label === 'negative'
                        ? 'bg-red-500'
                        : 'bg-gray-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="capitalize text-sm">{label}</span>
                  <span className="text-sm font-bold tabular-nums" aria-label={`${count} ${label} calls`}>{count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Transcript Search Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-4 h-4" aria-hidden="true" />
            Transcript search
          </CardTitle>
          <CardDescription>Search across all call transcripts for keywords or phrases</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearchSubmit} className="flex gap-3 mb-4">
            <div className="flex-1">
              <Label htmlFor={searchId} className="sr-only">Search transcripts</Label>
              <Input
                id={searchId}
                type="search"
                placeholder="Search transcripts… e.g. 'price', 'interested', 'callback'"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="search"
              />
            </div>
            <Button type="submit" disabled={isSearching || !searchQuery.trim()}>
              <Search className="w-4 h-4 mr-2" aria-hidden="true" />
              {isSearching ? 'Searching…' : 'Search'}
            </Button>
          </form>

          {searchResults.length > 0 ? (
            <ul className="space-y-3 list-none p-0 m-0" aria-label={`${searchResults.length} transcript matches for "${searchQuery}"`}>
              {searchResults.map((result, i) => (
                <li key={i} className="p-3 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">Call #{result.callId}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(result.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm font-mono text-muted-foreground">
                    …
                    {result.snippet
                      .split(new RegExp(`(${searchQuery})`, 'gi'))
                      .map((part: string, j: number) =>
                        part.toLowerCase() === searchQuery.toLowerCase() ? (
                          <mark key={j} className="bg-yellow-200 dark:bg-yellow-800 text-foreground">
                            {part}
                          </mark>
                        ) : (
                          part
                        )
                      )}
                    …
                  </p>
                </li>
              ))}
            </ul>
          ) : searchQuery && !isSearching ? (
            <p className="text-sm text-muted-foreground" role="status">No results found for "{searchQuery}".</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
