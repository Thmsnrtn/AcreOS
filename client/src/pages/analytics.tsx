import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout-sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Users, 
  FileText,
  Download,
  BarChart3,
  PieChart,
  Activity,
  Clock,
  Target,
  ArrowRight
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RechartsPie,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Funnel,
  FunnelChart,
  LabelList,
} from "recharts";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  loading?: boolean;
}

function KPICard({ title, value, change, icon, loading }: KPICardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-3 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`kpi-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="h-4 w-4 text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change !== undefined && (
          <div className={`text-xs flex items-center gap-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {change >= 0 ? '+' : ''}{formatPercent(change)} from last period
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState("30d");

  const { data: executive, isLoading: loadingExecutive } = useQuery<{
    totalRevenue: number;
    revenueChange: number;
    activeNotesValue: number;
    notesValueChange: number;
    dealsInPipeline: number;
    dealsChange: number;
    leadConversionRate: number;
    conversionChange: number;
  }>({
    queryKey: ['/api/analytics/executive', dateRange],
  });

  const { data: revenue, isLoading: loadingRevenue } = useQuery<{
    revenueOverTime: { date: string; revenue: number }[];
    totalRevenue: number;
    avgDealSize: number;
    projectedRevenue: number;
  }>({
    queryKey: ['/api/analytics/revenue', dateRange],
  });

  const { data: leads, isLoading: loadingLeads } = useQuery<{
    totalLeads: number;
    newLeads: number;
    convertedLeads: number;
    conversionRate: number;
    leadsBySource: { source: string; count: number }[];
    leadsByStatus: { status: string; count: number }[];
  }>({
    queryKey: ['/api/analytics/leads', dateRange],
  });

  const { data: deals, isLoading: loadingDeals } = useQuery<{
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    winRate: number;
    dealsByStage: { stage: string; count: number; value: number }[];
    avgDealValue: number;
  }>({
    queryKey: ['/api/analytics/deals', dateRange],
  });

  const { data: campaigns, isLoading: loadingCampaigns } = useQuery<{
    campaigns: { id: number; name: string; sent: number; responses: number; responseRate: number; roi: number }[];
    totalSent: number;
    totalResponses: number;
    avgResponseRate: number;
  }>({
    queryKey: ['/api/analytics/campaigns', dateRange],
  });

  const { data: pipeline, isLoading: loadingPipeline } = useQuery<{
    stageValues: { stage: string; value: number; count: number }[];
    totalValue: number;
  }>({
    queryKey: ['/api/analytics/pipeline'],
  });

  const { data: velocity, isLoading: loadingVelocity } = useQuery<{
    avgDaysPerStage: { stage: string; avgDays: number }[];
    avgTotalDays: number;
    bottleneckStage: string | null;
  }>({
    queryKey: ['/api/analytics/velocity', dateRange],
  });

  const { data: conversions, isLoading: loadingConversions } = useQuery<{
    stageConversions: { fromStage: string; toStage: string; rate: number }[];
    overallWinRate: number;
    lossReasons: { reason: string; count: number }[];
  }>({
    queryKey: ['/api/analytics/conversions', dateRange],
  });

  const handleExportReport = () => {
    window.open('/api/export/report?type=executive&format=pdf', '_blank');
  };

  const leadSourceData = leads?.leadsBySource?.map((s, i) => ({
    ...s,
    fill: COLORS[i % COLORS.length],
  })) || [];

  const stageLabels: Record<string, string> = {
    lead: 'Lead',
    negotiation: 'Negotiation',
    due_diligence: 'Due Diligence',
    under_contract: 'Under Contract',
    closed: 'Closed',
    pending: 'Pending',
    dead: 'Lost',
    cancelled: 'Cancelled',
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-analytics-title">Analytics</h1>
              <p className="text-muted-foreground text-sm md:text-base">Track your business performance and insights</p>
            </div>
            <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <Select value={dateRange} onValueChange={setDateRange} data-testid="select-date-range">
                <SelectTrigger className="w-28 md:w-32 min-h-[44px]">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="1y">Last year</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleExportReport} data-testid="button-export-report" className="min-h-[44px]">
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Export Report</span>
                <span className="sm:hidden">Export</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <KPICard
              title="Total Revenue"
              value={formatCurrency(executive?.totalRevenue || 0)}
              change={executive?.revenueChange}
              icon={<DollarSign className="h-4 w-4" />}
              loading={loadingExecutive}
            />
            <KPICard
              title="Active Notes Value"
              value={formatCurrency(executive?.activeNotesValue || 0)}
              change={executive?.notesValueChange}
              icon={<FileText className="h-4 w-4" />}
              loading={loadingExecutive}
            />
            <KPICard
              title="Deals in Pipeline"
              value={executive?.dealsInPipeline || 0}
              change={executive?.dealsChange}
              icon={<BarChart3 className="h-4 w-4" />}
              loading={loadingExecutive}
            />
            <KPICard
              title="Lead Conversion Rate"
              value={formatPercent(executive?.leadConversionRate || 0)}
              change={executive?.conversionChange}
              icon={<Target className="h-4 w-4" />}
              loading={loadingExecutive}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Revenue Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingRevenue ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenue?.revenueOverTime || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" fontSize={12} />
                      <YAxis tickFormatter={(v) => formatCurrency(v)} fontSize={12} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Line 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#0088FE" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5" />
                  Lead Sources
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingLeads ? (
                  <Skeleton className="h-64 w-full" />
                ) : leadSourceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsPie>
                      <Pie
                        data={leadSourceData}
                        dataKey="count"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ source, count }) => `${source}: ${count}`}
                      >
                        {leadSourceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </RechartsPie>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No lead data available
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Deal Pipeline by Stage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingDeals ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={deals?.dealsByStage?.map(d => ({
                      ...d,
                      stageName: stageLabels[d.stage] || d.stage,
                    })) || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stageName" fontSize={12} />
                      <YAxis tickFormatter={(v) => formatCurrency(v)} fontSize={12} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="value" fill="#00C49F" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Average Days per Stage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingVelocity ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="space-y-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart 
                        layout="vertical" 
                        data={velocity?.avgDaysPerStage?.map(d => ({
                          ...d,
                          stageName: stageLabels[d.stage] || d.stage,
                          isBottleneck: d.stage === velocity?.bottleneckStage,
                        })) || []}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" fontSize={12} />
                        <YAxis dataKey="stageName" type="category" fontSize={12} width={100} />
                        <Tooltip />
                        <Bar 
                          dataKey="avgDays" 
                          fill="#8884d8"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    {velocity?.bottleneckStage && (
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="destructive">Bottleneck</Badge>
                        <span className="text-muted-foreground">
                          {stageLabels[velocity.bottleneckStage] || velocity.bottleneckStage} takes longest ({velocity.avgDaysPerStage.find(s => s.stage === velocity.bottleneckStage)?.avgDays || 0} days)
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Stage Conversion Rates
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingConversions ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <div className="space-y-4">
                    {conversions?.stageConversions?.map((conv, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Badge variant="outline" className="min-w-24 justify-center">
                          {stageLabels[conv.fromStage] || conv.fromStage}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="outline" className="min-w-24 justify-center">
                          {stageLabels[conv.toStage] || conv.toStage}
                        </Badge>
                        <div className="flex-1 bg-secondary rounded-full h-3 overflow-hidden">
                          <div 
                            className="bg-primary h-full rounded-full transition-all"
                            style={{ width: `${conv.rate}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium min-w-12 text-right">
                          {formatPercent(conv.rate)}
                        </span>
                      </div>
                    ))}
                    <div className="pt-4 border-t flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Overall Win Rate</span>
                      <span className="text-lg font-bold text-green-600">
                        {formatPercent(conversions?.overallWinRate || 0)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pipeline Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingPipeline ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <div className="space-y-4">
                    <div className="text-center pb-4 border-b">
                      <div className="text-3xl font-bold text-primary">
                        {formatCurrency(pipeline?.totalValue || 0)}
                      </div>
                      <p className="text-sm text-muted-foreground">Total Pipeline Value</p>
                    </div>
                    {pipeline?.stageValues?.map((stage, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          <span className="text-sm">{stageLabels[stage.stage] || stage.stage}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-medium">{formatCurrency(stage.value)}</span>
                          <span className="text-xs text-muted-foreground ml-2">({stage.count} deals)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Campaign Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCampaigns ? (
                <Skeleton className="h-32 w-full" />
              ) : campaigns?.campaigns && campaigns.campaigns.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">Campaign</th>
                        <th className="text-right py-2 px-3">Sent</th>
                        <th className="text-right py-2 px-3">Responses</th>
                        <th className="text-right py-2 px-3">Response Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.campaigns.slice(0, 5).map((campaign) => (
                        <tr key={campaign.id} className="border-b last:border-b-0">
                          <td className="py-2 px-3 font-medium">{campaign.name}</td>
                          <td className="text-right py-2 px-3">{campaign.sent.toLocaleString()}</td>
                          <td className="text-right py-2 px-3">{campaign.responses.toLocaleString()}</td>
                          <td className="text-right py-2 px-3">
                            <Badge variant={campaign.responseRate > 10 ? "default" : "secondary"}>
                              {formatPercent(campaign.responseRate)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/50">
                      <tr>
                        <td className="py-2 px-3 font-bold">Total</td>
                        <td className="text-right py-2 px-3 font-bold">{campaigns.totalSent.toLocaleString()}</td>
                        <td className="text-right py-2 px-3 font-bold">{campaigns.totalResponses.toLocaleString()}</td>
                        <td className="text-right py-2 px-3">
                          <Badge>{formatPercent(campaigns.avgResponseRate)}</Badge>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No campaign data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{leads?.totalLeads || 0}</div>
                  <p className="text-sm text-muted-foreground">Total Leads</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{deals?.wonDeals || 0}</div>
                  <p className="text-sm text-muted-foreground">Won Deals</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{formatCurrency(deals?.avgDealValue || 0)}</div>
                  <p className="text-sm text-muted-foreground">Avg Deal Value</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">{velocity?.avgTotalDays || 0}</div>
                  <p className="text-sm text-muted-foreground">Avg Days to Close</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
