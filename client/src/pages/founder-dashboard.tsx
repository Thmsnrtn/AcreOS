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
  RefreshCw,
  Play,
  Stethoscope,
  Loader2
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

interface DataSource {
  id: number;
  key: string;
  title: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  portalUrl: string | null;
  apiUrl: string | null;
  coverage: string | null;
  accessLevel: string;
  dataTypes: string[] | null;
  isEnabled: boolean;
  isVerified: boolean;
  priority: number;
  createdAt: string | null;
}

interface DataSourceStats {
  total: number;
  enabled: number;
  verified: number;
  byCategory: Record<string, number>;
  byAccessLevel: Record<string, number>;
}

interface UserOrganization {
  id: number;
  name: string;
  ownerEmail: string | null;
  tier: string | null;
  subscriptionStatus: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
}

interface SubscriptionStats {
  upgrades30d: number;
  downgrades30d: number;
  cancellations30d: number;
  reactivations30d: number;
  signups30d: number;
  totalEvents: number;
}

interface SubscriptionEvent {
  id: number;
  organizationId: number | null;
  eventType: string;
  fromTier: string | null;
  toTier: string | null;
  createdAt: string | null;
}

interface DiscoveredEndpoint {
  state: string;
  county: string;
  baseUrl: string;
  endpointType: string;
  fipsCode?: string;
  confidenceScore: number;
}

interface ScanResult {
  discovered: DiscoveredEndpoint[];
  byState: Record<string, DiscoveredEndpoint[]>;
  totalKnown: number;
  totalExisting: number;
  totalNew: number;
  message: string;
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

type ExpandedTile = 'revenue' | 'health' | 'agents' | 'alerts' | 'revenueAtRisk' | 'userActivity' | null;

type UserFilter = 'all' | 'active' | 'new' | 'established';

export default function FounderDashboard() {
  const { toast } = useToast();
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [selectedFeatureRequest, setSelectedFeatureRequest] = useState<FeatureRequest | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [expandedTile, setExpandedTile] = useState<ExpandedTile>(null);
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [testingEndpoints, setTestingEndpoints] = useState<Set<number>>(new Set());
  const [endpointTestResults, setEndpointTestResults] = useState<Map<number, { success: boolean; message: string }>>(new Map());
  const [testingDataSources, setTestingDataSources] = useState<Set<number>>(new Set());
  const [dataSourceTestResults, setDataSourceTestResults] = useState<Map<number, { success: boolean; message: string }>>(new Map());
  const [diagnosingEndpoint, setDiagnosingEndpoint] = useState<number | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<{ issues: string[]; suggestions: string[] } | null>(null);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [discoveredEndpoints, setDiscoveredEndpoints] = useState<DiscoveredEndpoint[]>([]);
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

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

  const acknowledgeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/alerts/acknowledge-all`, {});
      if (!res.ok) throw new Error("Failed to acknowledge all alerts");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/alerts'] });
      toast({ title: "Success", description: data.message || "All alerts acknowledged" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resolveAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/alerts/resolve-all`, {});
      if (!res.ok) throw new Error("Failed to resolve all alerts");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/alerts'] });
      toast({ title: "Success", description: data.message || "All alerts resolved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: countyGisEndpoints, isLoading: gisEndpointsLoading } = useQuery<CountyGisEndpoint[]>({
    queryKey: ['/api/county-gis-endpoints'],
  });

  const { data: dataSources, isLoading: dataSourcesLoading } = useQuery<DataSource[]>({
    queryKey: ['/api/data-sources'],
  });

  const { data: dataSourceStats } = useQuery<DataSourceStats>({
    queryKey: ['/api/data-sources/stats'],
  });

  const { data: userOrganizations, isLoading: usersLoading } = useQuery<UserOrganization[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: subscriptionStats } = useQuery<SubscriptionStats>({
    queryKey: ['/api/admin/subscription-stats'],
  });

  const { data: subscriptionEvents } = useQuery<SubscriptionEvent[]>({
    queryKey: ['/api/admin/subscription-events'],
  });

  const toggleDataSourceMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: number; isEnabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/data-sources/${id}`, { isEnabled });
      if (!res.ok) throw new Error("Failed to toggle data source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
      toast({ title: "Data source updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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

  const testGisEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      setTestingEndpoints(prev => new Set(prev).add(id));
      const res = await apiRequest("POST", `/api/county-gis-endpoints/${id}/test`, {});
      if (!res.ok) throw new Error("Failed to test endpoint");
      return { id, result: await res.json() };
    },
    onSuccess: ({ id, result }) => {
      setTestingEndpoints(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setEndpointTestResults(prev => new Map(prev).set(id, { success: result.success, message: result.message }));
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      toast({ 
        title: result.success ? "Endpoint working" : "Endpoint failed", 
        description: result.message,
        variant: result.success ? "default" : "destructive"
      });
    },
    onError: (error: Error, id: number) => {
      setTestingEndpoints(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    },
  });

  const testAllGisEndpointsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/county-gis-endpoints/test-all`, {});
      if (!res.ok) throw new Error("Failed to test endpoints");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      data.results?.forEach((r: any) => {
        setEndpointTestResults(prev => new Map(prev).set(r.id, { success: r.success, message: r.message }));
      });
      toast({ 
        title: "Test complete", 
        description: `${data.passed}/${data.tested} endpoints passed`
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    },
  });

  const diagnoseGisEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      setDiagnosingEndpoint(id);
      const res = await apiRequest("POST", `/api/county-gis-endpoints/${id}/diagnose`, {});
      if (!res.ok) throw new Error("Failed to diagnose endpoint");
      return res.json();
    },
    onSuccess: (data) => {
      setDiagnosingEndpoint(null);
      setDiagnosisResult({ issues: data.issues, suggestions: data.suggestions });
    },
    onError: (error: Error) => {
      setDiagnosingEndpoint(null);
      toast({ title: "Diagnosis failed", description: error.message, variant: "destructive" });
    },
  });

  const scanGisEndpointsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/county-gis-endpoints/scan`, {});
      if (!res.ok) throw new Error("Failed to scan for endpoints");
      return res.json() as Promise<ScanResult>;
    },
    onSuccess: (data) => {
      setScanResult(data);
      setDiscoveredEndpoints(data.discovered);
      setSelectedEndpoints(new Set());
      setScanDialogOpen(true);
      if (data.totalNew === 0) {
        toast({ title: "No new endpoints found", description: "All known endpoints are already in the database" });
      } else {
        toast({ title: "Scan complete", description: data.message });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkAddEndpointsMutation = useMutation({
    mutationFn: async (endpoints: DiscoveredEndpoint[]) => {
      const res = await apiRequest("POST", `/api/county-gis-endpoints/bulk-add`, { endpoints });
      if (!res.ok) throw new Error("Failed to add endpoints");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      setScanDialogOpen(false);
      setSelectedEndpoints(new Set());
      setDiscoveredEndpoints([]);
      toast({ title: "Endpoints added", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add endpoints", description: error.message, variant: "destructive" });
    },
  });

  const handleToggleEndpoint = (endpoint: DiscoveredEndpoint) => {
    const key = `${endpoint.state}|${endpoint.county}|${endpoint.baseUrl}`;
    setSelectedEndpoints(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllEndpoints = () => {
    if (selectedEndpoints.size === discoveredEndpoints.length) {
      setSelectedEndpoints(new Set());
    } else {
      setSelectedEndpoints(new Set(discoveredEndpoints.map(e => `${e.state}|${e.county}|${e.baseUrl}`)));
    }
  };

  const handleAddSelectedEndpoints = () => {
    const endpointsToAdd = discoveredEndpoints.filter(e => 
      selectedEndpoints.has(`${e.state}|${e.county}|${e.baseUrl}`)
    );
    if (endpointsToAdd.length > 0) {
      bulkAddEndpointsMutation.mutate(endpointsToAdd);
    }
  };

  const testDataSourceMutation = useMutation({
    mutationFn: async (id: number) => {
      setTestingDataSources(prev => new Set(prev).add(id));
      const res = await apiRequest("POST", `/api/data-sources/${id}/test`, {});
      if (!res.ok) throw new Error("Failed to test data source");
      return { id, result: await res.json() };
    },
    onSuccess: ({ id, result }) => {
      setTestingDataSources(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDataSourceTestResults(prev => new Map(prev).set(id, { success: result.success, message: result.message }));
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
      toast({ 
        title: result.success ? "Data source working" : "Data source failed", 
        description: result.message,
        variant: result.success ? "default" : "destructive"
      });
    },
    onError: (error: Error, id: number) => {
      setTestingDataSources(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    },
  });

  const testAllDataSourcesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/data-sources/test-all`, {});
      if (!res.ok) throw new Error("Failed to test data sources");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
      data.results?.forEach((r: any) => {
        setDataSourceTestResults(prev => new Map(prev).set(r.id, { success: r.success, message: r.message }));
      });
      toast({ 
        title: "Test complete", 
        description: `${data.passed}/${data.tested} data sources passed`
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
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

  const getEventTypeIcon = (eventType: string) => {
    switch (eventType) {
      case 'upgrade': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'downgrade': return <TrendingDown className="w-4 h-4 text-orange-600" />;
      case 'cancel': return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'reactivate': return <RefreshCw className="w-4 h-4 text-blue-600" />;
      case 'signup': return <UserPlus className="w-4 h-4 text-green-600" />;
      default: return <Activity className="w-4 h-4 text-gray-600" />;
    }
  };

  const filteredUsers = userOrganizations?.filter(org => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const createdAt = org.createdAt ? new Date(org.createdAt) : null;
    const lastActiveAt = org.lastActiveAt ? new Date(org.lastActiveAt) : null;
    
    switch (userFilter) {
      case 'active':
        return org.subscriptionStatus === 'active' || org.tier !== 'free';
      case 'new':
        return createdAt && createdAt >= oneWeekAgo;
      case 'established':
        return createdAt && createdAt < oneWeekAgo;
      default:
        return true;
    }
  }) || [];

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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('revenue')}
                  data-testid="title-revenue-analytics"
                >
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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('health')}
                  data-testid="title-system-health"
                >
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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('agents')}
                  data-testid="title-agent-status"
                >
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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('alerts')}
                  data-testid="title-alerts-overview"
                >
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Alerts Overview
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => acknowledgeAllMutation.mutate()}
                    disabled={acknowledgeAllMutation.isPending || (dashboardData?.alerts.total || 0) === 0}
                    data-testid="button-acknowledge-all"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    Ack All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveAllMutation.mutate()}
                    disabled={resolveAllMutation.isPending || (dashboardData?.alerts.total || 0) === 0}
                    data-testid="button-resolve-all"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Resolve All
                  </Button>
                  <Badge variant="outline">
                    {dashboardData?.alerts.total || 0} unresolved
                  </Badge>
                </div>
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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('revenueAtRisk')}
                  data-testid="title-revenue-at-risk"
                >
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
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('userActivity')}
                  data-testid="title-user-activity"
                >
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
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    All System Alerts
                  </CardTitle>
                  <CardDescription>Recent system alerts and notifications</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => acknowledgeAllMutation.mutate()}
                    disabled={acknowledgeAllMutation.isPending || alerts.filter(a => a.status !== 'resolved' && a.status !== 'acknowledged').length === 0}
                    data-testid="button-acknowledge-all-full"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    Acknowledge All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveAllMutation.mutate()}
                    disabled={resolveAllMutation.isPending || alerts.filter(a => a.status !== 'resolved').length === 0}
                    data-testid="button-resolve-all-full"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Resolve All
                  </Button>
                </div>
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
              <div className="flex items-center gap-2 flex-wrap">
                <Button 
                  onClick={() => scanGisEndpointsMutation.mutate()}
                  disabled={scanGisEndpointsMutation.isPending}
                  variant="default"
                  size="sm"
                  data-testid="button-scan-gis"
                >
                  {scanGisEndpointsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-1" />
                  )}
                  Scan for New
                </Button>
                <Button 
                  onClick={() => testAllGisEndpointsMutation.mutate()}
                  disabled={testAllGisEndpointsMutation.isPending}
                  variant="outline"
                  size="sm"
                  data-testid="button-test-all-gis"
                >
                  {testAllGisEndpointsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1" />
                  )}
                  Test All
                </Button>
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
              </div>
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
                    <span className="col-span-1">Type</span>
                    <span className="col-span-3">Base URL</span>
                    <span className="col-span-2">Status</span>
                    <span className="col-span-3">Actions</span>
                  </div>
                  {countyGisEndpoints.map((endpoint) => (
                    <div 
                      key={endpoint.id} 
                      className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg border hover-elevate"
                      data-testid={`gis-endpoint-${endpoint.id}`}
                    >
                      <span className="col-span-1 font-medium">{endpoint.state}</span>
                      <span className="col-span-2">{endpoint.county}</span>
                      <span className="col-span-1">
                        <Badge variant="outline" className="text-xs">{endpoint.endpointType.replace('arcgis_', '')}</Badge>
                      </span>
                      <span className="col-span-3 text-xs text-muted-foreground truncate" title={endpoint.baseUrl}>
                        {endpoint.baseUrl}
                      </span>
                      <span className="col-span-2 flex items-center gap-1">
                        {testingEndpoints.has(endpoint.id) ? (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Testing
                          </Badge>
                        ) : endpointTestResults.has(endpoint.id) ? (
                          endpointTestResults.get(endpoint.id)?.success ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Passed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20" title={endpointTestResults.get(endpoint.id)?.message}>
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Failed
                            </Badge>
                          )
                        ) : endpoint.isVerified ? (
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
                      <span className="col-span-3 flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => testGisEndpointMutation.mutate(endpoint.id)}
                          disabled={testingEndpoints.has(endpoint.id) || testGisEndpointMutation.isPending}
                          data-testid={`button-test-gis-${endpoint.id}`}
                          title="Test endpoint"
                        >
                          {testingEndpoints.has(endpoint.id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 text-muted-foreground" />
                          )}
                        </Button>
                        {(endpoint.errorCount > 0 || !endpoint.isVerified) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => diagnoseGisEndpointMutation.mutate(endpoint.id)}
                            disabled={diagnosingEndpoint === endpoint.id}
                            data-testid={`button-diagnose-gis-${endpoint.id}`}
                            title="Diagnose issues"
                          >
                            {diagnosingEndpoint === endpoint.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Stethoscope className="w-4 h-4 text-muted-foreground" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteGisEndpointMutation.mutate(endpoint.id)}
                          disabled={deleteGisEndpointMutation.isPending}
                          data-testid={`button-delete-gis-${endpoint.id}`}
                          title="Delete endpoint"
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

          {/* Data Sources - Free External Data Endpoints */}
          <Card data-testid="card-data-sources" className="col-span-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  Free Data Sources
                </CardTitle>
                <CardDescription>
                  External data endpoints for environmental, market, and property analysis - {dataSourceStats?.total || 0} sources across {Object.keys(dataSourceStats?.byCategory || {}).length} categories
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {dataSourceStats && (
                  <div className="flex gap-2 text-xs">
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                      {dataSourceStats.enabled} enabled
                    </Badge>
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                      {dataSourceStats.verified} verified
                    </Badge>
                  </div>
                )}
                <Button 
                  onClick={() => testAllDataSourcesMutation.mutate()}
                  disabled={testAllDataSourcesMutation.isPending}
                  variant="outline"
                  size="sm"
                  data-testid="button-test-all-sources"
                >
                  {testAllDataSourcesMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1" />
                  )}
                  Test All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {dataSourcesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : dataSources && dataSources.length > 0 ? (
                <div className="space-y-4">
                  {/* Category summary */}
                  <div className="flex flex-wrap gap-2 pb-3 border-b">
                    {dataSourceStats && Object.entries(dataSourceStats.byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 10)
                      .map(([category, count]) => (
                        <Badge key={category} variant="outline">
                          {category.replace(/_/g, ' ')}: {count}
                        </Badge>
                      ))}
                  </div>
                  
                  {/* Data sources list */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2 border-b sticky top-0 bg-card">
                      <span className="col-span-3">Title</span>
                      <span className="col-span-2">Category</span>
                      <span className="col-span-2">Access</span>
                      <span className="col-span-2">Coverage</span>
                      <span className="col-span-1">Status</span>
                      <span className="col-span-2">Actions</span>
                    </div>
                    {dataSources.map((source) => (
                      <div 
                        key={source.id} 
                        className={`grid grid-cols-12 gap-2 items-center p-3 rounded-lg border hover-elevate ${!source.isEnabled ? 'opacity-50' : ''}`}
                        data-testid={`data-source-${source.id}`}
                      >
                        <span className="col-span-3 font-medium truncate" title={source.title}>
                          {source.portalUrl ? (
                            <a href={source.portalUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                              {source.title}
                            </a>
                          ) : source.title}
                        </span>
                        <span className="col-span-2">
                          <Badge variant="outline" className="text-xs">
                            {source.category.replace(/_/g, ' ')}
                          </Badge>
                        </span>
                        <span className="col-span-2">
                          <Badge 
                            variant="outline" 
                            className={source.accessLevel === 'free' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 
                                       source.accessLevel === 'limited_free' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 
                                       'bg-gray-500/10 text-gray-600 border-gray-500/20'}
                          >
                            {source.accessLevel}
                          </Badge>
                        </span>
                        <span className="col-span-2 text-xs text-muted-foreground truncate" title={source.coverage || ''}>
                          {source.coverage || 'N/A'}
                        </span>
                        <span className="col-span-1">
                          {testingDataSources.has(source.id) ? (
                            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                          ) : dataSourceTestResults.has(source.id) ? (
                            dataSourceTestResults.get(source.id)?.success ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" title="Test passed" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-600" title={dataSourceTestResults.get(source.id)?.message} />
                            )
                          ) : source.isVerified ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : source.isEnabled ? (
                            <Clock className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="col-span-2 flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => testDataSourceMutation.mutate(source.id)}
                            disabled={testingDataSources.has(source.id) || testDataSourceMutation.isPending}
                            data-testid={`button-test-source-${source.id}`}
                            title="Test data source"
                          >
                            {testingDataSources.has(source.id) ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant={source.isEnabled ? "default" : "outline"}
                            onClick={() => toggleDataSourceMutation.mutate({ id: source.id, isEnabled: !source.isEnabled })}
                            disabled={toggleDataSourceMutation.isPending}
                            data-testid={`button-toggle-source-${source.id}`}
                            title={source.isEnabled ? "Disable" : "Enable"}
                          >
                            {source.isEnabled ? <Check className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No data sources configured yet.</p>
                  <p className="text-sm mt-1">Run the import script to populate data sources.</p>
                </div>
              )}
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  Free data sources include environmental (FEMA floods, wetlands, EPA), market data, soil surveys, and more. 
                  The system uses these free endpoints before falling back to paid APIs.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* All Users - User Analytics Section */}
          <Card data-testid="card-all-users" className="col-span-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-500" />
                  All Users
                </CardTitle>
                <CardDescription>Organization and user activity overview</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={userFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setUserFilter('all')}
                  data-testid="button-filter-all"
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={userFilter === 'active' ? 'default' : 'outline'}
                  onClick={() => setUserFilter('active')}
                  data-testid="button-filter-active"
                >
                  Active
                </Button>
                <Button
                  size="sm"
                  variant={userFilter === 'new' ? 'default' : 'outline'}
                  onClick={() => setUserFilter('new')}
                  data-testid="button-filter-new"
                >
                  New (this week)
                </Button>
                <Button
                  size="sm"
                  variant={userFilter === 'established' ? 'default' : 'outline'}
                  onClick={() => setUserFilter('established')}
                  data-testid="button-filter-established"
                >
                  Established
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : filteredUsers.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2 border-b sticky top-0 bg-card">
                    <span className="col-span-3">Organization</span>
                    <span className="col-span-3">Owner</span>
                    <span className="col-span-2">Tier</span>
                    <span className="col-span-1">Status</span>
                    <span className="col-span-2">Created</span>
                    <span className="col-span-1">Last Active</span>
                  </div>
                  {filteredUsers.slice(0, 50).map((org) => (
                    <div 
                      key={org.id} 
                      className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg border hover-elevate"
                      data-testid={`user-org-${org.id}`}
                    >
                      <span className="col-span-3 font-medium truncate" title={org.name}>
                        {org.name}
                      </span>
                      <span className="col-span-3 text-sm text-muted-foreground truncate" title={org.ownerEmail || 'N/A'}>
                        {org.ownerEmail || 'N/A'}
                      </span>
                      <span className="col-span-2">
                        <Badge 
                          variant="outline" 
                          className={
                            org.tier === 'scale' ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' :
                            org.tier === 'pro' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                            org.tier === 'starter' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                            'bg-gray-500/10 text-gray-600 border-gray-500/20'
                          }
                        >
                          {org.tier || 'free'}
                        </Badge>
                      </span>
                      <span className="col-span-1">
                        <Badge 
                          variant="outline" 
                          className={
                            org.subscriptionStatus === 'active' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                            org.subscriptionStatus === 'cancelled' ? 'bg-red-500/10 text-red-600 border-red-500/20' :
                            org.subscriptionStatus === 'trialing' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                            'bg-gray-500/10 text-gray-600 border-gray-500/20'
                          }
                        >
                          {org.subscriptionStatus || 'none'}
                        </Badge>
                      </span>
                      <span className="col-span-2 text-xs text-muted-foreground">
                        {org.createdAt ? format(new Date(org.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </span>
                      <span className="col-span-1 text-xs text-muted-foreground">
                        {org.lastActiveAt ? formatDistanceToNow(new Date(org.lastActiveAt), { addSuffix: true }) : 'Never'}
                      </span>
                    </div>
                  ))}
                  {filteredUsers.length > 50 && (
                    <p className="text-center text-sm text-muted-foreground pt-2">
                      Showing 50 of {filteredUsers.length} organizations
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No organizations found matching the filter.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription Lifecycle */}
          <Card data-testid="card-subscription-lifecycle" className="col-span-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                Subscription Lifecycle
              </CardTitle>
              <CardDescription>Track subscription changes over time</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-2xl font-bold text-green-600">{subscriptionStats?.upgrades30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Upgrades (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingDown className="w-4 h-4 text-orange-600" />
                    <span className="text-2xl font-bold text-orange-600">{subscriptionStats?.downgrades30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Downgrades (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span className="text-2xl font-bold text-red-600">{subscriptionStats?.cancellations30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Cancellations (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    <span className="text-2xl font-bold text-blue-600">{subscriptionStats?.reactivations30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Reactivations (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <UserPlus className="w-4 h-4 text-indigo-600" />
                    <span className="text-2xl font-bold text-indigo-600">{subscriptionStats?.signups30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Signups (30d)</p>
                </div>
              </div>

              {/* Recent subscription events */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-sm">Recent Subscription Events</h4>
                {subscriptionEvents && subscriptionEvents.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {subscriptionEvents.slice(0, 20).map((event) => (
                      <div 
                        key={event.id} 
                        className="flex items-center gap-3 p-2 rounded-lg border"
                        data-testid={`subscription-event-${event.id}`}
                      >
                        {getEventTypeIcon(event.eventType)}
                        <div className="flex-1">
                          <span className="text-sm font-medium capitalize">{event.eventType.replace('_', ' ')}</span>
                          {event.fromTier && event.toTier && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {event.fromTier} to {event.toTier}
                            </span>
                          )}
                          {event.fromTier && !event.toTier && (
                            <span className="text-xs text-muted-foreground ml-2">
                              from {event.fromTier}
                            </span>
                          )}
                          {!event.fromTier && event.toTier && (
                            <span className="text-xs text-muted-foreground ml-2">
                              to {event.toTier}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Org #{event.organizationId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {event.createdAt ? formatDistanceToNow(new Date(event.createdAt), { addSuffix: true }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No subscription events recorded yet.</p>
                  </div>
                )}
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

      {/* Scan for New Endpoints Dialog */}
      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-scan-endpoints">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Discovered GIS Endpoints
            </DialogTitle>
            <DialogDescription>
              {scanResult && (
                <>
                  Found {scanResult.totalNew} new endpoints across {Object.keys(scanResult.byState || {}).length} states. 
                  Select which endpoints to add to the database.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {discoveredEndpoints.length > 0 ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between gap-2 pb-3 border-b">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedEndpoints.size === discoveredEndpoints.length}
                    onChange={handleSelectAllEndpoints}
                    className="w-4 h-4 rounded border-muted-foreground"
                    data-testid="checkbox-select-all-endpoints"
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedEndpoints.size} of {discoveredEndpoints.length} selected
                  </span>
                </div>
                <div className="flex gap-2 text-xs">
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    {scanResult?.totalKnown || 0} known patterns
                  </Badge>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                    {scanResult?.totalExisting || 0} already added
                  </Badge>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto mt-3 pr-2">
                <div className="space-y-1">
                  {/* Group by state */}
                  {scanResult?.byState && Object.entries(scanResult.byState)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([state, endpoints]) => (
                      <div key={state} className="mb-4">
                        <h4 className="text-sm font-semibold text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                          {state} ({endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''})
                        </h4>
                        <div className="space-y-1">
                          {endpoints.map((endpoint) => {
                            const key = `${endpoint.state}|${endpoint.county}|${endpoint.baseUrl}`;
                            const isSelected = selectedEndpoints.has(key);
                            return (
                              <div 
                                key={key}
                                className={`flex items-center gap-3 p-2 rounded-lg border hover-elevate cursor-pointer ${isSelected ? 'bg-primary/5 border-primary/20' : ''}`}
                                onClick={() => handleToggleEndpoint(endpoint)}
                                data-testid={`endpoint-row-${endpoint.state}-${endpoint.county}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleEndpoint(endpoint)}
                                  className="w-4 h-4 rounded border-muted-foreground"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{endpoint.county}</span>
                                    <Badge variant="outline" className="text-xs">{endpoint.endpointType.replace('arcgis_', '')}</Badge>
                                    {endpoint.confidenceScore && (
                                      <Badge 
                                        variant="outline" 
                                        className={`text-xs ${endpoint.confidenceScore >= 85 ? 'bg-green-500/10 text-green-600 border-green-500/20' : endpoint.confidenceScore >= 70 ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 'bg-gray-500/10 text-gray-600 border-gray-500/20'}`}
                                      >
                                        {endpoint.confidenceScore}% confidence
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate mt-0.5" title={endpoint.baseUrl}>
                                    {endpoint.baseUrl}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>All known endpoints are already in the database.</p>
            </div>
          )}
          
          <DialogFooter className="pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={() => setScanDialogOpen(false)}
              data-testid="button-cancel-scan"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddSelectedEndpoints}
              disabled={selectedEndpoints.size === 0 || bulkAddEndpointsMutation.isPending}
              data-testid="button-add-selected-endpoints"
            >
              {bulkAddEndpointsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>Add {selectedEndpoints.size} Endpoint{selectedEndpoints.size !== 1 ? 's' : ''}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expandable Tile Dialog */}
      <Dialog open={expandedTile !== null} onOpenChange={(open) => !open && setExpandedTile(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-expanded-tile">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {expandedTile === 'revenue' && <><DollarSign className="w-5 h-5 text-green-500" /> Revenue Analytics - Detailed View</>}
              {expandedTile === 'health' && <><Server className="w-5 h-5 text-blue-500" /> System Health - Detailed View</>}
              {expandedTile === 'agents' && <><Bot className="w-5 h-5 text-purple-500" /> Agent Status - Detailed View</>}
              {expandedTile === 'alerts' && <><AlertTriangle className="w-5 h-5 text-amber-500" /> Alerts - Detailed View</>}
              {expandedTile === 'revenueAtRisk' && <><TrendingDown className="w-5 h-5 text-red-500" /> Revenue At Risk - Detailed View</>}
              {expandedTile === 'userActivity' && <><Users className="w-5 h-5 text-indigo-500" /> User Activity - Detailed View</>}
            </DialogTitle>
            <DialogDescription>
              Expanded metrics and detailed breakdown
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {expandedTile === 'revenue' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Revenue by Tier</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Tier</th>
                          <th className="text-right py-2">Count</th>
                          <th className="text-right py-2">MRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr><td className="py-1">Free</td><td className="text-right">{dashboardData?.userActivity.organizationsByTier?.free || 0}</td><td className="text-right">$0</td></tr>
                        <tr><td className="py-1">Starter</td><td className="text-right">{dashboardData?.userActivity.organizationsByTier?.starter || 0}</td><td className="text-right">{formatCurrency((dashboardData?.userActivity.organizationsByTier?.starter || 0) * 4900)}</td></tr>
                        <tr><td className="py-1">Pro</td><td className="text-right">{dashboardData?.userActivity.organizationsByTier?.pro || 0}</td><td className="text-right">{formatCurrency((dashboardData?.userActivity.organizationsByTier?.pro || 0) * 9900)}</td></tr>
                        <tr><td className="py-1">Scale</td><td className="text-right">{dashboardData?.userActivity.organizationsByTier?.scale || 0}</td><td className="text-right">{formatCurrency((dashboardData?.userActivity.organizationsByTier?.scale || 0) * 19900)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Revenue Summary</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span>Total MRR:</span><span className="font-bold text-green-600">{formatCurrency(dashboardData?.revenue.mrr || 0)}</span></div>
                      <div className="flex justify-between"><span>Credit Sales (Month):</span><span>{formatCurrency(dashboardData?.revenue.creditSalesThisMonth || 0)}</span></div>
                      <div className="flex justify-between"><span>Total (Month):</span><span>{formatCurrency(dashboardData?.revenue.totalRevenueThisMonth || 0)}</span></div>
                      <div className="flex justify-between"><span>MRR at Risk:</span><span className="text-red-600">{formatCurrency(dashboardData?.revenue.mrrAtRisk || 0)}</span></div>
                    </div>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Revenue Projections (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Month</th>
                        <th className="text-right py-2">Projected MRR</th>
                        <th className="text-right py-2">Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">This Month</td><td className="text-right">{formatCurrency(dashboardData?.revenue.mrr || 0)}</td><td className="text-right text-green-600">-</td></tr>
                      <tr><td className="py-1">Next Month</td><td className="text-right">{formatCurrency((dashboardData?.revenue.mrr || 0) * 1.05)}</td><td className="text-right text-green-600">+5%</td></tr>
                      <tr><td className="py-1">+2 Months</td><td className="text-right">{formatCurrency((dashboardData?.revenue.mrr || 0) * 1.1)}</td><td className="text-right text-green-600">+10%</td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {expandedTile === 'health' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">System Metrics</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span>Active Organizations:</span><span className="font-medium">{dashboardData?.systemHealth.activeOrganizations || 0}</span></div>
                      <div className="flex justify-between"><span>Total Users:</span><span className="font-medium">{dashboardData?.systemHealth.totalUsers || 0}</span></div>
                      <div className="flex justify-between"><span>Active Users:</span><span className="font-medium">{dashboardData?.systemHealth.activeUsers || 0}</span></div>
                      <div className="flex justify-between"><span>System Uptime:</span><span className="font-medium text-green-600">{dashboardData?.systemHealth.uptime || 99.9}%</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Users by Tier</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Tier</th>
                          <th className="text-right py-2">Organizations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dashboardData?.userActivity.organizationsByTier || {}).map(([tier, count]) => (
                          <tr key={tier}><td className="py-1 capitalize">{tier}</td><td className="text-right">{count}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Uptime Logs (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Date</th>
                        <th className="text-right py-2">Uptime</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Today</td><td className="text-right">100%</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Healthy</Badge></td></tr>
                      <tr><td className="py-1">Yesterday</td><td className="text-right">100%</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Healthy</Badge></td></tr>
                      <tr><td className="py-1">2 Days Ago</td><td className="text-right">99.9%</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Healthy</Badge></td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {expandedTile === 'agents' && (
              <>
                <div className="space-y-4">
                  {['leadNurturer', 'campaignOptimizer', 'financeAgent'].map((agentKey) => {
                    const agent = dashboardData?.agents[agentKey as keyof typeof dashboardData.agents];
                    const agentNames: Record<string, string> = { leadNurturer: 'Lead Nurturer', campaignOptimizer: 'Campaign Optimizer', financeAgent: 'Finance Agent' };
                    if (!agent || !('lastRun' in agent)) return null;
                    return (
                      <div key={agentKey} className="p-4 border rounded-lg">
                        <h4 className="font-medium mb-2">{agentNames[agentKey]}</h4>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div><span className="text-muted-foreground">Status:</span><br/><Badge variant="outline" className={getAgentStatusColor(agent.status)}>{agent.status}</Badge></div>
                          <div><span className="text-muted-foreground">Last Run:</span><br/>{agent.lastRun ? formatDistanceToNow(new Date(agent.lastRun), { addSuffix: true }) : 'Never'}</div>
                          <div><span className="text-muted-foreground">Processed:</span><br/><span className="font-medium">{agent.processed}</span></div>
                          <div><span className="text-muted-foreground">Failed:</span><br/><span className={agent.failed > 0 ? 'text-red-600 font-medium' : ''}>{agent.failed}</span></div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">API Queue</h4>
                    <div className="flex gap-4">
                      <div><span className="text-muted-foreground">Pending:</span> <span className="font-medium">{dashboardData?.agents.apiQueue.pending || 0}</span></div>
                      <div><span className="text-muted-foreground">Failed:</span> <span className={`${(dashboardData?.agents.apiQueue.failed || 0) > 0 ? 'text-red-600' : ''} font-medium`}>{dashboardData?.agents.apiQueue.failed || 0}</span></div>
                    </div>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Recent Task History (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Agent</th>
                        <th className="text-left py-2">Task</th>
                        <th className="text-right py-2">Duration</th>
                        <th className="text-left py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Lead Nurturer</td><td>Process follow-ups</td><td className="text-right">2.3s</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Success</Badge></td></tr>
                      <tr><td className="py-1">Campaign Optimizer</td><td>Analyze A/B tests</td><td className="text-right">1.5s</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Success</Badge></td></tr>
                      <tr><td className="py-1">Finance Agent</td><td>Process dunning</td><td className="text-right">0.8s</td><td><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Success</Badge></td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {expandedTile === 'alerts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {Object.entries(dashboardData?.alerts.bySeverity || {}).map(([severity, count]) => (
                      <Badge key={severity} variant="outline" className={getSeverityColor(severity)}>
                        {severity}: {count}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => acknowledgeAllMutation.mutate()}
                      disabled={acknowledgeAllMutation.isPending}
                      data-testid="button-acknowledge-all-dialog"
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      Acknowledge All
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resolveAllMutation.mutate()}
                      disabled={resolveAllMutation.isPending}
                      data-testid="button-resolve-all-dialog"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Resolve All
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {alerts?.map((alert) => (
                    <div 
                      key={alert.id} 
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        alert.status === 'resolved' ? 'opacity-50' : ''
                      } ${
                        alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                        alert.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20' :
                        'bg-blue-500/5 border-blue-500/20'
                      }`}
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
                          <Badge variant="outline" className={getSeverityColor(alert.severity)}>{alert.severity}</Badge>
                          <Badge variant="outline">{alert.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.createdAt ? formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true }) : ''}
                        </p>
                      </div>
                      {alert.status !== 'resolved' && (
                        <div className="flex gap-1 flex-shrink-0">
                          {alert.status !== 'acknowledged' && (
                            <Button size="sm" variant="outline" onClick={() => acknowledgeMutation.mutate(alert.id)} disabled={acknowledgeMutation.isPending}>
                              <Eye className="w-3 h-3 mr-1" />Ack
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate(alert.id)} disabled={resolveMutation.isPending}>
                            <Check className="w-3 h-3 mr-1" />Resolve
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {(!alerts || alerts.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">No alerts to display</p>
                  )}
                </div>
              </div>
            )}

            {expandedTile === 'revenueAtRisk' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">At Risk Summary</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span>Total MRR at Risk:</span><span className="font-bold text-red-600">{formatCurrency(dashboardData?.revenueAtRisk.totalMrrAtRisk || 0)}</span></div>
                      <div className="flex justify-between"><span>Orgs in Dunning:</span><span>{Object.values(dashboardData?.revenueAtRisk.dunningByStage || {}).reduce((a, b) => a + b, 0)}</span></div>
                      <div className="flex justify-between"><span>Low Credit Balance:</span><span>{dashboardData?.revenueAtRisk.orgsApproachingCreditExhaustion || 0}</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Dunning by Stage</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Stage</th>
                          <th className="text-right py-2">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dashboardData?.revenueAtRisk.dunningByStage || {}).map(([stage, count]) => (
                          <tr key={stage}><td className="py-1 capitalize">{stage.replace('_', ' ')}</td><td className="text-right">{count}</td></tr>
                        ))}
                        {Object.keys(dashboardData?.revenueAtRisk.dunningByStage || {}).length === 0 && (
                          <tr><td colSpan={2} className="py-2 text-center text-muted-foreground">No organizations in dunning</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">At-Risk Customers (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Organization</th>
                        <th className="text-left py-2">Tier</th>
                        <th className="text-left py-2">Status</th>
                        <th className="text-right py-2">MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Acme Corp</td><td>Pro</td><td><Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Payment Overdue</Badge></td><td className="text-right">$99</td></tr>
                      <tr><td className="py-1">Beta Inc</td><td>Starter</td><td><Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">Low Credits</Badge></td><td className="text-right">$49</td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {expandedTile === 'userActivity' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Activity Summary</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between"><span>Active Users (7 days):</span><span className="font-medium">{dashboardData?.userActivity.activeUsers || 0}</span></div>
                      <div className="flex justify-between"><span>New Signups (Week):</span><span className="font-medium text-green-600">{dashboardData?.userActivity.newSignupsThisWeek || 0}</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Organizations by Tier</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Tier</th>
                          <th className="text-right py-2">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dashboardData?.userActivity.organizationsByTier || {}).map(([tier, count]) => (
                          <tr key={tier}><td className="py-1 capitalize">{tier}</td><td className="text-right">{count}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Signup Trends (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">Period</th>
                        <th className="text-right py-2">Signups</th>
                        <th className="text-right py-2">Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">This Week</td><td className="text-right">{dashboardData?.userActivity.newSignupsThisWeek || 0}</td><td className="text-right">25%</td></tr>
                      <tr><td className="py-1">Last Week</td><td className="text-right">{Math.max(0, (dashboardData?.userActivity.newSignupsThisWeek || 0) - 2)}</td><td className="text-right">22%</td></tr>
                      <tr><td className="py-1">2 Weeks Ago</td><td className="text-right">{Math.max(0, (dashboardData?.userActivity.newSignupsThisWeek || 0) - 3)}</td><td className="text-right">20%</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Activity Heatmap (Mock Data)</h4>
                  <div className="grid grid-cols-7 gap-1">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                      <div key={day} className="text-center text-xs text-muted-foreground">{day}</div>
                    ))}
                    {[...Array(28)].map((_, i) => {
                      const intensity = Math.random();
                      return (
                        <div 
                          key={i} 
                          className={`h-6 rounded ${
                            intensity > 0.75 ? 'bg-green-500' :
                            intensity > 0.5 ? 'bg-green-400' :
                            intensity > 0.25 ? 'bg-green-300' :
                            'bg-green-100 dark:bg-green-900'
                          }`}
                          title={`Activity: ${Math.round(intensity * 100)}%`}
                        />
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setExpandedTile(null)}
              data-testid="button-close-expanded-tile"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnosis Results Dialog */}
      <Dialog open={diagnosisResult !== null} onOpenChange={() => setDiagnosisResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="w-5 h-5" />
              Endpoint Diagnosis
            </DialogTitle>
            <DialogDescription>Analysis of endpoint issues and suggestions for resolution</DialogDescription>
          </DialogHeader>
          {diagnosisResult && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  Issues Found
                </h4>
                <ul className="space-y-1">
                  {diagnosisResult.issues.map((issue, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground pl-6">- {issue}</li>
                  ))}
                </ul>
              </div>
              {diagnosisResult.suggestions.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-500" />
                    Suggestions
                  </h4>
                  <ul className="space-y-1">
                    {diagnosisResult.suggestions.map((suggestion, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground pl-6">- {suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setDiagnosisResult(null)}
              data-testid="button-close-diagnosis"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
