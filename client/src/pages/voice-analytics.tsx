import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
  Users,
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

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

export default function VoiceAnalyticsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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

  // Build call volume by day (last 14 days)
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

  // Sentiment trend (avg per day)
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

  // Call outcome distribution
  const outcomeDistribution = (() => {
    const map: Record<string, number> = {};
    for (const call of calls) {
      const outcome = (call as any).outcome || 'untagged';
      map[outcome] = (map[outcome] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  // Conversion rate (interested / total calls that have outcomes)
  const taggedCalls = calls.filter(c => (c as any).outcome);
  const interestedCalls = calls.filter(c => (c as any).outcome === 'interested');
  const conversionRate =
    taggedCalls.length > 0
      ? ((interestedCalls.length / taggedCalls.length) * 100).toFixed(1)
      : '0.0';

  // Talk time analytics
  const completedCalls = calls.filter(c => c.duration > 0);
  const avgDuration =
    completedCalls.length > 0
      ? Math.round(completedCalls.reduce((s, c) => s + c.duration, 0) / completedCalls.length)
      : 0;
  const longestCalls = [...completedCalls].sort((a, b) => b.duration - a.duration).slice(0, 5);

  // Active calls count (status = active or initiated)
  const activeCalls = calls.filter(c => ['active', 'initiated'].includes(c.status));

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/voice/transcripts/search?q=${encodeURIComponent(searchQuery)}&limit=20`,
        { credentials: 'include' }
      );
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart2 className="w-8 h-8 text-primary" />
            Voice Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Call volume, sentiment trends, conversion rates, and transcript search.
          </p>
        </div>
        {activeCalls.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {activeCalls.length} Active Call{activeCalls.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Calls"
          value={analytics?.totalCalls ?? calls.length}
          sub={`${analytics?.inboundVsOutbound?.inbound ?? 0} in / ${analytics?.inboundVsOutbound?.outbound ?? 0} out`}
          icon={<Phone className="w-5 h-5" />}
        />
        <MetricCard
          label="Avg Duration"
          value={formatSeconds(analytics?.averageDuration ?? avgDuration)}
          sub="Per completed call"
          icon={<Clock className="w-5 h-5" />}
        />
        <MetricCard
          label="Call-to-Conversion"
          value={`${conversionRate}%`}
          sub={`${interestedCalls.length} of ${taggedCalls.length} tagged calls`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <MetricCard
          label="Active Right Now"
          value={activeCalls.length}
          sub="Live calls in progress"
          icon={<Activity className="w-5 h-5" />}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Call Volume by Day */}
        <Card>
          <CardHeader>
            <CardTitle>Call Volume (Last 14 Days)</CardTitle>
            <CardDescription>Total calls per day</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volumeByDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#d97541" radius={[4, 4, 0, 0]} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Sentiment Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Sentiment Trend</CardTitle>
            <CardDescription>Average sentiment score over time (-1 to +1)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={sentimentTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
                <YAxis domain={[-1, 1]} />
                <Tooltip formatter={(v: any) => [v.toFixed(2), 'Avg Sentiment']} />
                <Line
                  type="monotone"
                  dataKey="sentiment"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Outcome Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Call Outcome Distribution</CardTitle>
            <CardDescription>Interested / Not Interested / Callback / Voicemail</CardDescription>
          </CardHeader>
          <CardContent>
            {outcomeDistribution.length > 0 ? (
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
            ) : (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
                <PhoneCall className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No outcome data yet. Tag calls with outcomes.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Talk Time Analytics */}
        <Card>
          <CardHeader>
            <CardTitle>Talk Time Analytics</CardTitle>
            <CardDescription>Longest calls in your history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <p className="text-sm text-muted-foreground">Average call duration</p>
              <p className="text-2xl font-bold">{formatSeconds(avgDuration)}</p>
            </div>
            <div className="space-y-2">
              {longestCalls.length > 0 ? (
                longestCalls.map((call, i) => (
                  <div key={call.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-4">{i + 1}.</span>
                      <span className="truncate max-w-[180px]">{call.phoneNumber}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{call.direction}</Badge>
                      <span className="font-mono text-xs">{formatSeconds(call.duration)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No completed calls yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sentiment breakdown from analytics */}
      {analytics?.sentimentBreakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Sentiment Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {Object.entries(analytics.sentimentBreakdown).map(([label, count]: [string, any]) => (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      label === 'positive'
                        ? 'bg-emerald-500'
                        : label === 'negative'
                        ? 'bg-red-500'
                        : 'bg-gray-400'
                    }`}
                  />
                  <span className="capitalize text-sm">{label}</span>
                  <span className="text-sm font-bold">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transcript Search Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            Transcript Search
          </CardTitle>
          <CardDescription>Search across all call transcripts for keywords or phrases</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 mb-4">
            <Input
              placeholder="Search transcripts… e.g. 'price', 'interested', 'callback'"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={isSearching}>
              <Search className="w-4 h-4 mr-2" />
              {isSearching ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {searchResults.length > 0 ? (
            <div className="space-y-3">
              {searchResults.map((result, i) => (
                <div key={i} className="p-3 border rounded-lg bg-muted/30">
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
                </div>
              ))}
            </div>
          ) : searchQuery && !isSearching ? (
            <p className="text-sm text-muted-foreground">No results found for "{searchQuery}".</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
