import { Sidebar } from "@/components/layout-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Users, 
  Building2, 
  Activity,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Bot,
  Clock,
  Server,
  CreditCard,
  UserPlus,
  Crown,
  Eye,
  Check,
  Zap,
  Mail,
  Map,
  MessageSquare
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AdminDashboardData {
  revenue: {
    mrr: number;
    creditSalesThisMonth: number;
    totalRevenueThisMonth: number;
    mrrAtRisk: number;
  };
  systemHealth: {
    activeOrganizations: number;
    totalUsers: number;
    activeUsers: number;
    uptime: number;
  };
  agents: {
    leadNurturer: {
      lastRun: string | null;
      processed: number;
      pending: number;
      failed: number;
      status: string;
    };
    campaignOptimizer: {
      lastRun: string | null;
      processed: number;
      pending: number;
      failed: number;
      status: string;
    };
    financeAgent: {
      lastRun: string | null;
      processed: number;
      pending: number;
      failed: number;
      status: string;
    };
    apiQueue: {
      pending: number;
      failed: number;
    };
  };
  alerts: {
    bySeverity: Record<string, number>;
    total: number;
    critical: Array<{
      id: number;
      title: string;
      message: string;
      severity: string;
      createdAt: string;
    }>;
  };
  revenueAtRisk: {
    dunningByStage: Record<string, number>;
    totalMrrAtRisk: number;
    orgsApproachingCreditExhaustion: number;
  };
  userActivity: {
    activeUsers: number;
    newSignupsThisWeek: number;
    organizationsByTier: Record<string, number>;
  };
}

interface SystemAlert {
  id: number;
  title: string;
  message: string;
  alertType: string;
  severity: string;
  status: string;
  createdAt: string;
  organizationId: number | null;
}

interface ApiUsageStats {
  totalCostCents: number;
  byService: {
    lob: { count: number; costCents: number };
    regrid: { count: number; costCents: number };
    openai: { count: number; costCents: number };
  };
  recentUsage: Array<{ date: string; costCents: number }>;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export default function FounderDashboard() {
  const { toast } = useToast();

  const { data: dashboardData, isLoading } = useQuery<AdminDashboardData>({
    queryKey: ['/api/admin/dashboard'],
  });

  const { data: alerts } = useQuery<SystemAlert[]>({
    queryKey: ['/api/admin/alerts'],
  });

  const { data: apiUsageData } = useQuery<ApiUsageStats>({
    queryKey: ['/api/founder/api-usage'],
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await apiRequest("PUT", `/api/admin/alerts/${alertId}/acknowledge`, {});
      if (!res.ok) throw new Error("Failed to acknowledge alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/alerts'] });
      toast({ title: "Alert acknowledged" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await apiRequest("PUT", `/api/admin/alerts/${alertId}/resolve`, {});
      if (!res.ok) throw new Error("Failed to resolve alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/alerts'] });
      toast({ title: "Alert resolved" });
    },
  });

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'busy': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      case 'warning': return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'warning': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      default: return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <Skeleton className="h-10 w-64" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-64" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2" data-testid="text-founder-dashboard-title">
                <Crown className="w-8 h-8 text-amber-500" />
                Founder Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">System-wide metrics and health overview</p>
            </div>
            <Badge variant="outline" className="self-start md:self-auto">
              <Activity className="w-3 h-3 mr-1" />
              Live Data
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card data-testid="card-revenue-analytics">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  Revenue Analytics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Monthly Recurring Revenue</span>
                    <span className="text-xl font-bold text-green-600" data-testid="text-mrr">
                      {formatCurrency(dashboardData?.revenue.mrr || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Credit Sales (This Month)</span>
                    <span className="font-medium" data-testid="text-credit-sales">
                      {formatCurrency(dashboardData?.revenue.creditSalesThisMonth || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Revenue (This Month)</span>
                    <span className="font-medium" data-testid="text-total-revenue">
                      {formatCurrency(dashboardData?.revenue.totalRevenueThisMonth || 0)}
                    </span>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2 text-sm">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-muted-foreground">Revenue trend positive</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-system-health">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-500" />
                  System Health
                </CardTitle>
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Online
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Active Organizations</span>
                  <span className="font-medium flex items-center gap-1" data-testid="text-active-orgs">
                    <Building2 className="w-4 h-4" />
                    {dashboardData?.systemHealth.activeOrganizations || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total Users</span>
                  <span className="font-medium flex items-center gap-1" data-testid="text-total-users">
                    <Users className="w-4 h-4" />
                    {dashboardData?.systemHealth.totalUsers || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Uptime</span>
                  <span className="font-medium text-green-600" data-testid="text-uptime">
                    {dashboardData?.systemHealth.uptime || 99.9}%
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-agent-status">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Bot className="w-5 h-5 text-purple-500" />
                  Agent Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Lead Nurturing</span>
                    <span className="text-xs text-muted-foreground">
                      {dashboardData?.agents.leadNurturer.lastRun 
                        ? formatDistanceToNow(new Date(dashboardData.agents.leadNurturer.lastRun), { addSuffix: true })
                        : 'Never run'}
                    </span>
                  </div>
                  <Badge variant="outline" className={getAgentStatusColor(dashboardData?.agents.leadNurturer.status || 'healthy')}>
                    {dashboardData?.agents.leadNurturer.processed || 0} processed
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Campaign Optimizer</span>
                    <span className="text-xs text-muted-foreground">
                      {dashboardData?.agents.campaignOptimizer.lastRun 
                        ? formatDistanceToNow(new Date(dashboardData.agents.campaignOptimizer.lastRun), { addSuffix: true })
                        : 'Never run'}
                    </span>
                  </div>
                  <Badge variant="outline" className={getAgentStatusColor(dashboardData?.agents.campaignOptimizer.status || 'healthy')}>
                    {dashboardData?.agents.campaignOptimizer.processed || 0} processed
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Finance Agent</span>
                    <span className="text-xs text-muted-foreground">
                      {dashboardData?.agents.financeAgent.lastRun 
                        ? formatDistanceToNow(new Date(dashboardData.agents.financeAgent.lastRun), { addSuffix: true })
                        : 'Never run'}
                    </span>
                  </div>
                  <Badge variant="outline" className={getAgentStatusColor(dashboardData?.agents.financeAgent.status || 'healthy')}>
                    {dashboardData?.agents.financeAgent.processed || 0} processed
                  </Badge>
                </div>
                <div className="pt-2 border-t flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">API Queue</span>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                      <Clock className="w-3 h-3 mr-1" />
                      {dashboardData?.agents.apiQueue.pending || 0} pending
                    </Badge>
                    {(dashboardData?.agents.apiQueue.failed || 0) > 0 && (
                      <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                        {dashboardData?.agents.apiQueue.failed} failed
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-alerts-overview">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Alerts Overview
                </CardTitle>
                <Badge variant="outline">
                  {dashboardData?.alerts.total || 0} unresolved
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(dashboardData?.alerts.bySeverity || {}).map(([severity, count]) => (
                    <Badge key={severity} variant="outline" className={getSeverityColor(severity)}>
                      {severity}: {count}
                    </Badge>
                  ))}
                  {Object.keys(dashboardData?.alerts.bySeverity || {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No active alerts</span>
                  )}
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {dashboardData?.alerts.critical.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-2 p-2 rounded-md bg-red-500/5 border border-red-500/20">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{alert.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{alert.message}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-6 w-6"
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          data-testid={`button-acknowledge-alert-${alert.id}`}
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-6 w-6"
                          onClick={() => resolveMutation.mutate(alert.id)}
                          data-testid={`button-resolve-alert-${alert.id}`}
                        >
                          <Check className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-revenue-at-risk">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  Revenue At Risk
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total MRR At Risk</span>
                  <span className="text-lg font-bold text-red-600" data-testid="text-mrr-at-risk">
                    {formatCurrency(dashboardData?.revenueAtRisk.totalMrrAtRisk || 0)}
                  </span>
                </div>
                <div className="space-y-2">
                  <span className="text-sm font-medium">Organizations in Dunning</span>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(dashboardData?.revenueAtRisk.dunningByStage || {}).map(([stage, count]) => (
                      <Badge key={stage} variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                        {stage.replace('_', ' ')}: {count}
                      </Badge>
                    ))}
                    {Object.keys(dashboardData?.revenueAtRisk.dunningByStage || {}).length === 0 && (
                      <span className="text-sm text-muted-foreground">No organizations in dunning</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Low Credit Balance</span>
                  <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                    <CreditCard className="w-3 h-3 mr-1" />
                    {dashboardData?.revenueAtRisk.orgsApproachingCreditExhaustion || 0} orgs
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-user-activity">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-500" />
                  User Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Active Users (7 days)</span>
                  <span className="font-medium" data-testid="text-active-users">
                    {dashboardData?.userActivity.activeUsers || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New Signups (This Week)</span>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                    <UserPlus className="w-3 h-3 mr-1" />
                    {dashboardData?.userActivity.newSignupsThisWeek || 0}
                  </Badge>
                </div>
                <div className="pt-2 border-t">
                  <span className="text-sm font-medium mb-2 block">Organizations by Tier</span>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(dashboardData?.userActivity.organizationsByTier || {}).map(([tier, count]) => (
                      <Badge key={tier} variant="outline">
                        {tier}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-api-usage">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="w-5 h-5 text-orange-500" />
                  API Usage & Costs
                </CardTitle>
                <Badge variant="outline" data-testid="text-api-total-cost">
                  {formatCurrency(apiUsageData?.totalCostCents || 0)} this month
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-blue-500" />
                      <span className="text-sm">Lob (Direct Mail)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground" data-testid="text-lob-count">
                        {apiUsageData?.byService.lob.count || 0} calls
                      </span>
                      <Badge variant="outline" data-testid="text-lob-cost">
                        {formatCurrency(apiUsageData?.byService.lob.costCents || 0)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Map className="w-4 h-4 text-green-500" />
                      <span className="text-sm">Regrid (Parcel Data)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground" data-testid="text-regrid-count">
                        {apiUsageData?.byService.regrid.count || 0} calls
                      </span>
                      <Badge variant="outline" data-testid="text-regrid-cost">
                        {formatCurrency(apiUsageData?.byService.regrid.costCents || 0)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-purple-500" />
                      <span className="text-sm">OpenAI (AI Features)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground" data-testid="text-openai-count">
                        {apiUsageData?.byService.openai.count || 0} calls
                      </span>
                      <Badge variant="outline" data-testid="text-openai-cost">
                        {formatCurrency(apiUsageData?.byService.openai.costCents || 0)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <span className="text-xs text-muted-foreground">Last 7 days usage</span>
                  <div className="flex items-end gap-1 h-12 mt-2">
                    {apiUsageData?.recentUsage.map((day, i) => {
                      const maxCost = Math.max(...(apiUsageData?.recentUsage.map(d => d.costCents) || [1]));
                      const height = maxCost > 0 ? (day.costCents / maxCost) * 100 : 0;
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-orange-500/20 rounded-t-sm hover:bg-orange-500/40 transition-colors"
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${day.date}: ${formatCurrency(day.costCents)}`}
                          data-testid={`bar-usage-${i}`}
                        />
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {alerts && alerts.length > 0 && (
            <Card data-testid="card-all-alerts">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  All System Alerts
                </CardTitle>
                <CardDescription>Recent system alerts and notifications</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {alerts.map((alert) => (
                    <div 
                      key={alert.id} 
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        alert.status === 'resolved' ? 'opacity-50' : ''
                      } ${
                        alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                        alert.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20' :
                        'bg-blue-500/5 border-blue-500/20'
                      }`}
                      data-testid={`alert-item-${alert.id}`}
                    >
                      {alert.severity === 'critical' ? (
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      ) : alert.severity === 'warning' ? (
                        <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                      ) : (
                        <Activity className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{alert.title}</span>
                          <Badge variant="outline" size="sm" className={getSeverityColor(alert.severity)}>
                            {alert.severity}
                          </Badge>
                          <Badge variant="outline" size="sm">
                            {alert.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.createdAt ? formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true }) : ''}
                        </p>
                      </div>
                      {alert.status !== 'resolved' && (
                        <div className="flex gap-1 flex-shrink-0">
                          {alert.status !== 'acknowledged' && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => acknowledgeMutation.mutate(alert.id)}
                              disabled={acknowledgeMutation.isPending}
                              data-testid={`button-ack-${alert.id}`}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Acknowledge
                            </Button>
                          )}
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => resolveMutation.mutate(alert.id)}
                            disabled={resolveMutation.isPending}
                            data-testid={`button-resolve-${alert.id}`}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            Resolve
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
