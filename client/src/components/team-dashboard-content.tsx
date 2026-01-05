import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { 
  Users, 
  DollarSign, 
  Target, 
  Clock, 
  Trophy, 
  TrendingUp,
  CheckCircle,
  Phone
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend
} from "recharts";

interface MemberMetrics {
  leadsAssigned: number;
  leadsContacted: number;
  leadsConverted: number;
  conversionRate: number;
  dealsClosed: number;
  revenue: number;
  tasksCompleted: number;
  tasksPending: number;
  avgResponseTimeHours: number | null;
  avgDaysToClose: number | null;
}

interface ActivityTrend {
  period: string;
  activities: number;
  deals: number;
}

interface TeamMemberPerformance {
  id: number;
  userId: string;
  displayName: string;
  role: string;
  metrics: MemberMetrics;
  activityTrends: ActivityTrend[];
}

interface LeaderboardEntry extends TeamMemberPerformance {
  rank: number;
}

interface TeamPerformanceData {
  periodDays: number;
  teamTotals: {
    totalLeads: number;
    totalDeals: number;
    totalRevenue: number;
    totalTasksCompleted: number;
    avgConversionRate: number;
  };
  members: TeamMemberPerformance[];
  leaderboard: LeaderboardEntry[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getRankBadgeVariant(rank: number): "default" | "secondary" | "outline" {
  if (rank === 1) return "default";
  if (rank === 2) return "secondary";
  return "outline";
}

export function TeamDashboardContent() {
  const [period, setPeriod] = useState("30");

  const { data, isLoading, error } = useQuery<TeamPerformanceData>({
    queryKey: ["/api/team/performance", period],
    queryFn: async () => {
      const res = await fetch(`/api/team/performance?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team performance");
      return res.json();
    }
  });

  if (error) {
    return (
      <div className="text-center py-12" data-testid="team-dashboard-error">
        <p className="text-destructive">Failed to load team performance data</p>
      </div>
    );
  }

  const revenueChartData = data?.members.map(m => ({
    name: m.displayName.split(' ')[0],
    revenue: m.metrics.revenue,
    deals: m.metrics.dealsClosed
  })) || [];

  const conversionChartData = data?.members.map(m => ({
    name: m.displayName.split(' ')[0],
    rate: m.metrics.conversionRate,
    leads: m.metrics.leadsAssigned
  })) || [];

  return (
    <div className="space-y-6" data-testid="team-dashboard-content">
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
        <div>
          <h2 className="text-xl md:text-2xl font-bold" data-testid="text-team-subtitle">Team Performance</h2>
          <p className="text-muted-foreground mt-1">
            Performance metrics and analytics for your team
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod} data-testid="select-team-period">
          <SelectTrigger className="w-40" data-testid="select-trigger-team-period">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card data-testid="card-team-total-leads">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-team-total-leads">
                  {data.teamTotals.totalLeads}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-team-total-deals">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Deals Closed</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-team-total-deals">
                  {data.teamTotals.totalDeals}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-team-total-revenue">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-team-total-revenue">
                  {formatCurrency(data.teamTotals.totalRevenue)}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-team-avg-conversion">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Avg Conversion</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-team-avg-conversion">
                  {data.teamTotals.avgConversionRate.toFixed(1)}%
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="leaderboard" className="space-y-4">
            <TabsList data-testid="tabs-team-inner">
              <TabsTrigger value="leaderboard" data-testid="tab-team-leaderboard">Leaderboard</TabsTrigger>
              <TabsTrigger value="members" data-testid="tab-team-members">Team Members</TabsTrigger>
              <TabsTrigger value="charts" data-testid="tab-team-charts">Charts</TabsTrigger>
            </TabsList>

            <TabsContent value="leaderboard" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-amber-500" />
                    Revenue Leaderboard
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {data.leaderboard.map((member) => (
                      <div 
                        key={member.id} 
                        className="flex items-center justify-between p-4 rounded-lg bg-muted/50"
                        data-testid={`leaderboard-member-${member.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <Badge variant={getRankBadgeVariant(member.rank)} className="w-8 h-8 flex items-center justify-center rounded-full">
                            {member.rank}
                          </Badge>
                          <div>
                            <p className="font-medium" data-testid={`text-member-name-${member.id}`}>
                              {member.displayName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {member.metrics.dealsClosed} deals closed
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold" data-testid={`text-member-revenue-${member.id}`}>
                            {formatCurrency(member.metrics.revenue)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {member.metrics.conversionRate}% conversion
                          </p>
                        </div>
                      </div>
                    ))}
                    {data.leaderboard.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        No team members found
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.members.map((member) => (
                  <Card key={member.id} data-testid={`card-member-${member.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-lg">{member.displayName}</CardTitle>
                        <Badge variant="outline">{member.role}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Leads: {member.metrics.leadsAssigned}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Contacted: {member.metrics.leadsContacted}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Converted: {member.metrics.leadsConverted}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Rate: {member.metrics.conversionRate}%</span>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{formatCurrency(member.metrics.revenue)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">Tasks: {member.metrics.tasksCompleted}</span>
                          </div>
                          {member.metrics.avgResponseTimeHours !== null && (
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">Resp: {member.metrics.avgResponseTimeHours}h</span>
                            </div>
                          )}
                          {member.metrics.avgDaysToClose !== null && (
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">Close: {member.metrics.avgDaysToClose}d</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {data.members.length === 0 && (
                  <Card className="col-span-2">
                    <CardContent className="py-12 text-center text-muted-foreground">
                      No team members found
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="charts" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Revenue by Team Member</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]" data-testid="chart-team-revenue">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={revenueChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="name" className="text-xs" />
                          <YAxis 
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                            className="text-xs"
                          />
                          <Tooltip 
                            formatter={(value: number) => [formatCurrency(value), "Revenue"]}
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))',
                              borderColor: 'hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Conversion Rate by Team Member</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]" data-testid="chart-team-conversion">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={conversionChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="name" className="text-xs" />
                          <YAxis 
                            tickFormatter={(value) => `${value}%`}
                            className="text-xs"
                          />
                          <Tooltip 
                            formatter={(value: number, name: string) => [
                              name === 'rate' ? `${value}%` : value,
                              name === 'rate' ? 'Conversion Rate' : 'Total Leads'
                            ]}
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))',
                              borderColor: 'hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Bar dataKey="rate" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {data.members.length > 0 && data.members[0].activityTrends.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Activity Trends Over Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]" data-testid="chart-team-trends">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.members[0].activityTrends}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="period" className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))',
                              borderColor: 'hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="activities" 
                            stroke="hsl(var(--primary))" 
                            strokeWidth={2}
                            dot={{ fill: 'hsl(var(--primary))' }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="deals" 
                            stroke="hsl(var(--accent))" 
                            strokeWidth={2}
                            dot={{ fill: 'hsl(var(--accent))' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
