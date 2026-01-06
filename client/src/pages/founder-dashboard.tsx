import { useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  MessageSquare,
  Lightbulb,
  FileText,
  MapPin,
  Database,
  Trash2,
  RefreshCw
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

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

interface FeatureRequest {
  id: number;
  organizationId: number | null;
  userId: string;
  title: string;
  description: string;
  category: string;
  priority: string | null;
  status: string | null;
  founderNotes: string | null;
  upvotes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  organizationName?: string;
}

interface CountyGisEndpoint {
  id: number;
  state: string;
  county: string;
  fipsCode: string | null;
  endpointType: string;
  baseUrl: string;
  isVerified: boolean;
  isActive: boolean;
  errorCount: number;
  lastVerified: string | null;
  createdAt: string | null;
}

const FEATURE_STATUS_OPTIONS = [
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

const FEATURE_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const FEATURE_CATEGORY_LABELS: Record<string, string> = {
  enhancement: "Enhancement",
  new_feature: "New Feature",
  integration: "Integration",
  ux: "UX",
};

function getStatusBadgeColor(status: string | null) {
  switch (status) {
    case 'submitted': return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    case 'under_review': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'planned': return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'in_progress': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'completed': return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'declined': return 'bg-red-500/10 text-red-600 border-red-500/20';
    default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

function getPriorityBadgeColor(priority: string | null) {
  switch (priority) {
    case 'high': return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'medium': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'low': return 'bg-green-500/10 text-green-600 border-green-500/20';
    default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
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
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [selectedFeatureRequest, setSelectedFeatureRequest] = useState<FeatureRequest | null>(null);
  const [notesValue, setNotesValue] = useState("");

  const { data: dashboardData, isLoading } = useQuery<AdminDashboardData>({
    queryKey: ['/api/admin/dashboard'],
  });

  const { data: alerts } = useQuery<SystemAlert[]>({
    queryKey: ['/api/admin/alerts'],
  });

  const { data: apiUsageData } = useQuery<ApiUsageStats>({
    queryKey: ['/api/founder/api-usage'],
  });

  const { data: featureRequests, isLoading: featureRequestsLoading } = useQuery<FeatureRequest[]>({
    queryKey: ['/api/founder/feature-requests'],
  });

  const updateFeatureRequestMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<{ status: string; priority: string; founderNotes: string }> }) => {
      const res = await apiRequest("PATCH", `/api/founder/feature-requests/${id}`, updates);
      if (!res.ok) throw new Error("Failed to update feature request");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/founder/feature-requests'] });
      toast({ title: "Feature request updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleStatusChange = (id: number, status: string) => {
    updateFeatureRequestMutation.mutate({ id, updates: { status } });
  };

  const handlePriorityChange = (id: number, priority: string) => {
    updateFeatureRequestMutation.mutate({ id, updates: { priority } });
  };

  const handleOpenNotesModal = (request: FeatureRequest) => {
    setSelectedFeatureRequest(request);
    setNotesValue(request.founderNotes || "");
    setNotesModalOpen(true);
  };

  const handleSaveNotes = () => {
    if (selectedFeatureRequest) {
      updateFeatureRequestMutation.mutate({ 
        id: selectedFeatureRequest.id, 
        updates: { founderNotes: notesValue } 
      });
      setNotesModalOpen(false);
      setSelectedFeatureRequest(null);
    }
  };

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

  const { data: countyGisEndpoints, isLoading: gisEndpointsLoading } = useQuery<CountyGisEndpoint[]>({
    queryKey: ['/api/county-gis-endpoints'],
  });

  const seedGisEndpointsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/county-gis-endpoints/seed`, {});
      if (!res.ok) throw new Error("Failed to seed endpoints");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      toast({ title: "Success", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteGisEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/county-gis-endpoints/${id}`, {});
      if (!res.ok) throw new Error("Failed to delete endpoint");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      toast({ title: "Endpoint deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

          {/* Feature Requests Section */}
          <Card data-testid="card-feature-requests">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Feature Requests
              </CardTitle>
              <CardDescription>Review and manage feature requests from users</CardDescription>
            </CardHeader>
            <CardContent>
              {featureRequestsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : featureRequests && featureRequests.length > 0 ? (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {featureRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 p-4 rounded-lg border bg-card"
                      data-testid={`feature-request-${request.id}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate" data-testid={`text-feature-title-${request.id}`}>
                            {request.title}
                          </h4>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {request.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <Badge variant="outline" data-testid={`badge-category-${request.id}`}>
                              {FEATURE_CATEGORY_LABELS[request.category] || request.category}
                            </Badge>
                            {request.organizationName && (
                              <span className="text-xs text-muted-foreground" data-testid={`text-org-${request.id}`}>
                                {request.organizationName}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground" data-testid={`text-date-${request.id}`}>
                              {request.createdAt ? format(new Date(request.createdAt), "MMM d, yyyy") : "N/A"}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={getStatusBadgeColor(request.status)} data-testid={`badge-status-${request.id}`}>
                            {FEATURE_STATUS_OPTIONS.find(s => s.value === request.status)?.label || request.status}
                          </Badge>
                          <Badge variant="outline" className={getPriorityBadgeColor(request.priority)} data-testid={`badge-priority-${request.id}`}>
                            {FEATURE_PRIORITY_OPTIONS.find(p => p.value === request.priority)?.label || request.priority}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col md:flex-row md:items-center gap-2 pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Status:</span>
                          <Select
                            value={request.status || "submitted"}
                            onValueChange={(value) => handleStatusChange(request.id, value)}
                          >
                            <SelectTrigger className="w-[140px]" data-testid={`select-status-${request.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FEATURE_STATUS_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Priority:</span>
                          <Select
                            value={request.priority || "medium"}
                            onValueChange={(value) => handlePriorityChange(request.id, value)}
                          >
                            <SelectTrigger className="w-[100px]" data-testid={`select-priority-${request.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FEATURE_PRIORITY_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenNotesModal(request)}
                          data-testid={`button-notes-${request.id}`}
                        >
                          <FileText className="w-3 h-3 mr-1" />
                          {request.founderNotes ? "Edit Notes" : "Add Notes"}
                        </Button>
                      </div>
                      {request.founderNotes && (
                        <div className="text-sm bg-muted/50 p-2 rounded" data-testid={`text-notes-${request.id}`}>
                          <span className="font-medium">Notes: </span>
                          {request.founderNotes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No feature requests yet.</p>
              )}
            </CardContent>
          </Card>

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
                          <Badge variant="outline" className={getSeverityColor(alert.severity)}>
                            {alert.severity}
                          </Badge>
                          <Badge variant="outline">
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

          {/* County GIS Endpoints - Free Parcel Data Sources */}
          <Card data-testid="card-county-gis-endpoints" className="col-span-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  County GIS Endpoints
                </CardTitle>
                <CardDescription>Free parcel data sources - saves API costs by using county GIS directly</CardDescription>
              </div>
              <Button 
                onClick={() => seedGisEndpointsMutation.mutate()}
                disabled={seedGisEndpointsMutation.isPending}
                variant="outline"
                size="sm"
                data-testid="button-seed-gis"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${seedGisEndpointsMutation.isPending ? 'animate-spin' : ''}`} />
                Seed Default Endpoints
              </Button>
            </CardHeader>
            <CardContent>
              {gisEndpointsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : countyGisEndpoints && countyGisEndpoints.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2 border-b">
                    <span className="col-span-1">State</span>
                    <span className="col-span-2">County</span>
                    <span className="col-span-2">Type</span>
                    <span className="col-span-4">Base URL</span>
                    <span className="col-span-2">Status</span>
                    <span className="col-span-1">Actions</span>
                  </div>
                  {countyGisEndpoints.map((endpoint) => (
                    <div 
                      key={endpoint.id} 
                      className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg border hover-elevate"
                      data-testid={`gis-endpoint-${endpoint.id}`}
                    >
                      <span className="col-span-1 font-medium">{endpoint.state}</span>
                      <span className="col-span-2">{endpoint.county}</span>
                      <span className="col-span-2">
                        <Badge variant="outline">{endpoint.endpointType}</Badge>
                      </span>
                      <span className="col-span-4 text-xs text-muted-foreground truncate" title={endpoint.baseUrl}>
                        {endpoint.baseUrl}
                      </span>
                      <span className="col-span-2 flex items-center gap-1">
                        {endpoint.isVerified ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Verified
                          </Badge>
                        ) : endpoint.errorCount > 0 ? (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            {endpoint.errorCount} errors
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-500/20">
                            Pending
                          </Badge>
                        )}
                      </span>
                      <span className="col-span-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteGisEndpointMutation.mutate(endpoint.id)}
                          disabled={deleteGisEndpointMutation.isPending}
                          data-testid={`button-delete-gis-${endpoint.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No county GIS endpoints configured yet.</p>
                  <p className="text-sm mt-1">Click "Seed Default Endpoints" to add endpoints for major counties.</p>
                </div>
              )}
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  County GIS endpoints allow free parcel lookups without using Regrid API credits. 
                  The system tries county endpoints first, then falls back to Regrid if needed.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Notes Modal */}
      <Dialog open={notesModalOpen} onOpenChange={setNotesModalOpen}>
        <DialogContent data-testid="dialog-feature-notes">
          <DialogHeader>
            <DialogTitle>Founder Notes</DialogTitle>
            <DialogDescription>
              {selectedFeatureRequest && (
                <>Add internal notes for "{selectedFeatureRequest.title}"</>
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            placeholder="Enter internal notes about this feature request..."
            className="min-h-[120px]"
            data-testid="textarea-founder-notes"
          />
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setNotesModalOpen(false)}
              data-testid="button-cancel-notes"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveNotes}
              disabled={updateFeatureRequestMutation.isPending}
              data-testid="button-save-notes"
            >
              {updateFeatureRequestMutation.isPending ? "Saving..." : "Save Notes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
