import React, { useState, useEffect, useRef } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { SystemHealth } from "@/components/system-health";
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
  Map as MapIcon,
  MessageSquare,
  Lightbulb,
  FileText,
  MapPin,
  Database,
  Trash2,
  RefreshCw,
  Play,
  Stethoscope,
  Loader2,
  Globe,
  X,
  Copy,
  Clipboard,
  ExternalLink,
  HandHelping,
  Key,
  Search,
  ToggleLeft,
  ToggleRight,
  Tag,
  Percent,
  Radio,
  Megaphone,
  MousePointerClick,
  BarChart,
  Pause,
  Target,
  TrendingUp as TrendingUpIcon,
  ChevronRight,
  Rocket,
  AlertOctagon,
  Sparkles,
  ArrowRight,
  CircleDot,
  Navigation,
  ListChecks,
  Bell,
  Wand2,
  ImageIcon,
  PencilLine,
  Send,
  ChevronLeft,
  RotateCcw,
  Layers,
  Flame,
  Heart,
  Users2,
  HelpCircle,
  ShieldAlert,
  Cpu,
  ScrollText,
  BrainCircuit,
  CircleCheck,
  CircleX,
  CircleDot as CircleDotIcon,
  Minus,
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

interface LiveDiscoveredEndpoint {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  endpointType: string;
  serviceName: string | null;
  discoverySource: string;
  discoveryDate: string;
  lastChecked: string | null;
  status: string;
  healthCheckPassed: boolean | null;
  healthCheckMessage: string | null;
  confidenceScore: number | null;
  metadata: Record<string, any> | null;
}

interface EscalatedTicket {
  id: number;
  organizationId: number;
  userId: string;
  subject: string;
  description: string;
  category: string | null;
  priority: string | null;
  status: string;
  createdAt: string | null;
  organizationName: string;
  messages: Array<{
    id: number;
    role: string;
    content: string;
    agentName: string | null;
    createdAt: string | null;
  }>;
  rootCauseAnalysis: {
    rootCause: string | null;
    confidence: number | null;
    affectedLayers: string[];
    suggestedFix: string | null;
  } | null;
  solutionsTried: Array<{
    action: string;
    wasSuccessful: boolean;
    timestamp: string | null;
  }>;
  relatedAlerts: Array<{
    id: number;
    title: string;
    severity: string;
    message: string;
    createdAt: string | null;
  }>;
  escalationBundle: any | null;
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
    case 'submitted': return 'bg-muted text-muted-foreground border-border';
    case 'under_review': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'planned': return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'in_progress': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'completed': return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'declined': return 'bg-red-500/10 text-red-600 border-red-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function getPriorityBadgeColor(priority: string | null) {
  switch (priority) {
    case 'high': return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'medium': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'low': return 'bg-green-500/10 text-green-600 border-green-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
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

// ─────────────────────────────────────────────
// AUTONOMOUS OBSERVATORY COMPONENTS
// ─────────────────────────────────────────────

const JOB_COLORS: Record<string, string> = {
  finance_agent:       "bg-blue-500",
  campaign_optimizer:  "bg-purple-500",
  lead_nurturing:      "bg-green-500",
  support_brain:       "bg-cyan-500",
  dunning:             "bg-red-500",
  external_monitor:    "bg-orange-500",
  sophie:              "bg-violet-500",
  churn_engine:        "bg-rose-500",
  founder_briefing:    "bg-emerald-500",
  default:             "bg-zinc-400",
};

function jobColor(jobName: string) {
  return JOB_COLORS[jobName] ?? JOB_COLORS.default;
}

function JobStatusDot({ status }: { status: string }) {
  if (status === "healthy")  return <CircleCheck className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "degraded") return <CircleDotIcon className="w-4 h-4 text-yellow-500 shrink-0" />;
  if (status === "failed")   return <CircleX className="w-4 h-4 text-red-500 shrink-0" />;
  return <Minus className="w-4 h-4 text-zinc-400 shrink-0" />;
}

/** Live System Activity Stream */
function SystemActivityPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/system-activity"],
    queryFn: () => apiRequest("GET", "/api/admin/system-activity?hours=48&limit=80").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const rows: any[] = data?.rows ?? [];

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-emerald-500" />
            System Activity Stream
          </CardTitle>
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">Last 48h · auto-refreshes every 30s</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && rows.length === 0 ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No autonomous actions recorded yet. Actions will appear here as the system works.</p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
            {rows.map((row: any) => (
              <div key={row.id} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${jobColor(row.jobName)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug truncate">{row.summary}</p>
                  {row.orgName && <p className="text-xs text-muted-foreground">{row.orgName}</p>}
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="outline" className="text-xs font-mono py-0">{row.jobName.replace(/_/g, " ")}</Badge>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3 text-right">{rows.length} action{rows.length !== 1 ? "s" : ""} logged</p>
      </CardContent>
    </Card>
  );
}

/** Job Health Supervisor Panel */
function JobHealthPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/job-health"],
    queryFn: () => apiRequest("GET", "/api/admin/job-health").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const jobs: any[] = data?.jobs ?? [];
  const summary = data?.summary ?? { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
  const hasIssues = summary.failed > 0 || summary.degraded > 0;

  return (
    <Card className={hasIssues ? "border-red-300 dark:border-red-800" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-500" />
            Background Job Health
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasIssues && <Badge variant="destructive" className="text-xs">Issues Detected</Badge>}
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="text-green-600 font-medium">{summary.healthy} healthy</span>
          {summary.degraded > 0 && <span className="text-yellow-600 font-medium">{summary.degraded} degraded</span>}
          {summary.failed > 0 && <span className="text-red-600 font-medium">{summary.failed} failed</span>}
          {summary.unknown > 0 && <span>{summary.unknown} not yet run</span>}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {jobs.map((job: any) => (
              <div key={job.name} className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
                <JobStatusDot status={job.status} />
                <span className="text-sm font-mono flex-1 truncate">{job.name.replace(/_/g, " ")}</span>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {job.lastRunAt ? (
                    <span>{formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}</span>
                  ) : (
                    <span className="italic">not yet run</span>
                  )}
                  {job.consecutiveFailures > 0 && (
                    <span className="ml-2 text-red-500 font-medium">{job.consecutiveFailures} fails</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** At-Risk Orgs (Churn Engine) Panel */
function ChurnRiskPanel() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/churn-risk"],
    queryFn: () => apiRequest("GET", "/api/admin/churn-risk?minScore=40").then(r => r.json()),
    refetchInterval: 5 * 60_000,
  });

  const orgs: any[] = data?.orgs ?? [];

  const triggerRescue = async (orgId: number, orgName: string) => {
    try {
      await apiRequest("POST", `/api/admin/churn-risk/${orgId}/rescue`);
      toast({ title: "Rescue triggered", description: `Sophie will reach out to ${orgName}` });
      refetch();
    } catch {
      toast({ title: "Error", description: "Failed to trigger rescue", variant: "destructive" });
    }
  };

  const riskColor = (score: number) =>
    score >= 80 ? "text-red-600 font-bold" :
    score >= 60 ? "text-yellow-600 font-semibold" :
    "text-muted-foreground";

  return (
    <Card className="col-span-full md:col-span-1">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-500" />
          Churn Risk Radar
        </CardTitle>
        <CardDescription className="text-xs">Paying orgs with elevated churn risk — Sophie auto-rescues at 85+</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center py-6 gap-1">
            <CircleCheck className="w-8 h-8 text-green-500" />
            <p className="text-sm text-muted-foreground">No orgs at elevated churn risk</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {orgs.map((org: any) => (
              <div key={org.id} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{org.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-xs py-0">{org.subscriptionTier}</Badge>
                    {org.churnRescueSentAt && (
                      <span className="text-xs text-violet-600 flex items-center gap-1">
                        <BrainCircuit className="w-3 h-3" /> Sophie intervened
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-lg font-mono ${riskColor(org.churnRiskScore)}`}>
                    {org.churnRiskScore}
                  </span>
                  {!org.churnRescueSentAt && org.churnRiskScore >= 60 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => triggerRescue(org.id, org.name)}
                    >
                      Rescue
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Sophie's Eyes — observations and cross-org learnings */
function SophieEyesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/sophie-observations"],
    queryFn: () => apiRequest("GET", "/api/admin/sophie-observations?limit=25").then(r => r.json()),
    refetchInterval: 2 * 60_000,
  });

  const observations: any[] = data?.observations ?? [];
  const learnings: any[] = data?.learnings ?? [];

  const confidenceBadge = (score: number) => {
    if (score >= 0.8) return <Badge className="text-xs bg-green-100 text-green-800 border-green-200">High</Badge>;
    if (score >= 0.5) return <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-200">Medium</Badge>;
    return <Badge className="text-xs bg-zinc-100 text-zinc-600 border-zinc-200">Low</Badge>;
  };

  return (
    <Card className="col-span-full md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-violet-500" />
          Sophie's Eyes
        </CardTitle>
        <CardDescription className="text-xs">What Sophie has observed and learned across all organizations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Observations */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent Observations</p>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : observations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No observations yet</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {observations.map((obs: any) => (
                <div key={obs.id} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <Eye className="w-3.5 h-3.5 mt-1 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug line-clamp-2">{obs.content}</p>
                    {obs.orgName && <p className="text-xs text-muted-foreground">{obs.orgName}</p>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {obs.confidence != null && confidenceBadge(Number(obs.confidence))}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(obs.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cross-org learnings */}
        {learnings.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cross-Org Learnings</p>
            <div className="space-y-1.5">
              {learnings.slice(0, 4).map((l: any) => (
                <div key={l.id} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <Sparkles className="w-3.5 h-3.5 mt-1 text-amber-400 shrink-0" />
                  <p className="text-sm leading-snug">{l.insight ?? l.pattern ?? l.title ?? JSON.stringify(l).slice(0, 100)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Manual trigger button for founder briefing */
function FounderBriefingTrigger() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const sendNow = async () => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/founder-briefing/send");
      toast({ title: "Briefing sent", description: "Check your inbox for the founder briefing email." });
    } catch {
      toast({ title: "Error", description: "Failed to send briefing", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={sendNow} disabled={loading} className="gap-2">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
      Send Daily Briefing Now
    </Button>
  );
}

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
  const [liveDiscoveryTab, setLiveDiscoveryTab] = useState<"patterns" | "live">("patterns");
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [discoveryStateFilter, setDiscoveryStateFilter] = useState<string>("all");
  const [scanTargetStates, setScanTargetStates] = useState<string>("");
  const [selectedEscalations, setSelectedEscalations] = useState<Set<number>>(new Set());
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [generatingPromptFor, setGeneratingPromptFor] = useState<number | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportJson, setBulkImportJson] = useState("");
  const [dataSourceFilter, setDataSourceFilter] = useState("");

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

  const { data: supportAnalytics } = useQuery<{
    totalTickets: number;
    openTickets: number;
    aiResolvedTickets: number;
    aiResolutionRate: number | string;
    averageRating: number | null;
    recentTickets?: Array<{
      id: number;
      subject: string;
      status: string;
      category: string;
      priority: string;
      aiHandled: boolean;
      organizationName?: string;
      createdAt: string;
    }>;
  }>({
    queryKey: ['/api/founder/support/analytics'],
  });

  const { data: escalations, isLoading: escalationsLoading } = useQuery<EscalatedTicket[]>({
    queryKey: ['/api/founder/escalations'],
  });

  const generatePromptMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      setGeneratingPromptFor(ticketId);
      const res = await apiRequest("POST", `/api/founder/escalations/${ticketId}/generate-prompt`, {});
      if (!res.ok) throw new Error("Failed to generate prompt");
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedPrompt(data.prompt);
      setPromptDialogOpen(true);
      setGeneratingPromptFor(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setGeneratingPromptFor(null);
    },
  });

  const generateBatchPromptMutation = useMutation({
    mutationFn: async (ticketIds: number[]) => {
      const res = await apiRequest("POST", `/api/founder/escalations/batch-prompt`, { ticketIds });
      if (!res.ok) throw new Error("Failed to generate batch prompt");
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedPrompt(data.prompt);
      setPromptDialogOpen(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resolveEscalationMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      const res = await apiRequest("POST", `/api/founder/escalations/${ticketId}/resolve`, {});
      if (!res.ok) throw new Error("Failed to resolve escalation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/founder/escalations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/founder/support/analytics'] });
      setPromptDialogOpen(false);
      setGeneratedPrompt("");
      toast({ title: "Escalation marked as resolved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleEscalationSelect = (ticketId: number, checked: boolean) => {
    setSelectedEscalations(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(ticketId);
      } else {
        next.delete(ticketId);
      }
      return next;
    });
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

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

  const { data: liveDiscoveredEndpoints, refetch: refetchLiveDiscovered } = useQuery<LiveDiscoveredEndpoint[]>({
    queryKey: ['/api/discovery/all', discoveryStateFilter],
    queryFn: async () => {
      const params = discoveryStateFilter !== "all" ? `?state=${discoveryStateFilter}` : "";
      const res = await fetch(`/api/discovery/all${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch discovered endpoints");
      return res.json();
    },
    enabled: scanDialogOpen && liveDiscoveryTab === "live",
  });

  const scanArcGISMutation = useMutation({
    mutationFn: async () => {
      const targetStates = scanTargetStates.trim() 
        ? scanTargetStates.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length === 2)
        : undefined;
      const res = await apiRequest("POST", `/api/discovery/scan-arcgis`, { 
        maxResults: 100,
        targetStates 
      });
      if (!res.ok) throw new Error("Failed to scan ArcGIS Online");
      return res.json();
    },
    onSuccess: (data) => {
      refetchLiveDiscovered();
      toast({ 
        title: "ArcGIS Scan Complete", 
        description: `Found ${data.validEndpoints} endpoints, added ${data.added} new (${data.skipped} duplicates)` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const validateLiveEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/discovery/${id}/validate`, {});
      if (!res.ok) throw new Error("Failed to validate endpoint");
      return res.json();
    },
    onSuccess: () => {
      refetchLiveDiscovered();
      toast({ title: "Validation complete" });
    },
    onError: (error: Error) => {
      toast({ title: "Validation failed", description: error.message, variant: "destructive" });
    },
  });

  const approveLiveEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/discovery/${id}/approve`, {});
      if (!res.ok) throw new Error("Failed to approve endpoint");
      return res.json();
    },
    onSuccess: (data) => {
      refetchLiveDiscovered();
      queryClient.invalidateQueries({ queryKey: ['/api/county-gis-endpoints'] });
      toast({ title: data.success ? "Endpoint approved" : "Could not approve", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
    },
  });

  const rejectLiveEndpointMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/discovery/${id}/reject`, {});
      if (!res.ok) throw new Error("Failed to reject endpoint");
      return res.json();
    },
    onSuccess: () => {
      refetchLiveDiscovered();
      toast({ title: "Endpoint rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Reject failed", description: error.message, variant: "destructive" });
    },
  });

  const batchValidateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/discovery/validate-all`, {});
      if (!res.ok) throw new Error("Failed to validate endpoints");
      return res.json();
    },
    onSuccess: (data) => {
      refetchLiveDiscovered();
      toast({ 
        title: "Batch validation complete", 
        description: `${data.validated} passed, ${data.failed} failed (processed ${data.processed}/${data.total})` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Batch validation failed", description: error.message, variant: "destructive" });
    },
  });

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

  const { data: validationStatus, refetch: refetchValidationStatus } = useQuery<{
    isRunning: boolean;
    progress: { completed: number; total: number; currentBatch: number };
  }>({
    queryKey: ['/api/data-sources/validation-status'],
    refetchInterval: (query) => query.state.data?.isRunning ? 3000 : false,
  });

  const prevValidationRunning = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevValidationRunning.current === true && validationStatus?.isRunning === false) {
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
      toast({ title: "Validation complete", description: "Data sources have been validated" });
    }
    prevValidationRunning.current = validationStatus?.isRunning;
  }, [validationStatus?.isRunning]);

  const testAllDataSourcesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/data-sources/test-all`, { limit: 1000 });
      if (!res.ok) throw new Error("Failed to start validation");
      return res.json();
    },
    onSuccess: (data) => {
      refetchValidationStatus();
      if (data.isRunning) {
        toast({ 
          title: "Validation started", 
          description: data.message || "Background validation in progress..."
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
        queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
        toast({ 
          title: "Validation complete", 
          description: `Tested data sources`
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Validation failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (sources: object[]) => {
      const res = await apiRequest("POST", "/api/data-sources/bulk-import", { sources });
      if (!res.ok) throw new Error("Import failed");
      return res.json() as Promise<{ imported: number; skipped: number; errors: string[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-sources/stats"] });
      setBulkImportOpen(false);
      setBulkImportJson("");
      toast({
        title: `Imported ${data.imported} sources`,
        description: data.skipped > 0 ? `${data.skipped} skipped (duplicates or errors)` : "All sources imported successfully",
      });
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'busy': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      case 'warning': return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
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
      default: return <Activity className="w-4 h-4 text-muted-foreground" />;
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
      <PageShell>
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
          {/* ── Header ── */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2" data-testid="text-founder-dashboard-title">
                <Crown className="w-8 h-8 text-amber-500" />
                Founder Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">Command center for launching and operating AcreOS</p>
            </div>
            <Badge variant="outline" className="self-start md:self-auto">
              <Activity className="w-3 h-3 mr-1" />
              Live Data
            </Badge>
          </div>

          {/* ── Sticky nav ── */}
          <FounderNavBar />

          {/* ── AI Briefing ── */}
          <div id="section-briefing">
            <TodaysBriefing />
          </div>

          {/* ── Action Queue ── */}
          <div id="section-actions">
            <ActionQueuePanel />
          </div>

          {/* ── Autonomous Observatory ── */}
          <div id="section-observatory" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-blue-500" />
                  Autonomous Observatory
                </h2>
                <p className="text-sm text-muted-foreground">Watch the system work in real time</p>
              </div>
              <FounderBriefingTrigger />
            </div>
            {/* Activity stream spans full width */}
            <SystemActivityPanel />
            {/* Job health + churn risk + Sophie in a responsive grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <JobHealthPanel />
              <ChurnRiskPanel />
              <SophieEyesPanel />
            </div>
          </div>

          {/* ── Launch Readiness Onboarding ── */}
          <div id="section-readiness">
            <LaunchReadinessSection />
          </div>

          {/* ── New subscriber live feed ── */}
          <NewSubscriberFeed alerts={alerts} />

          {/* ── Overview ── */}
          <div id="section-overview" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                      <MapIcon className="w-4 h-4 text-green-500" />
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

          {/* External Services Health */}
          <SystemHealth />

          {/* Feature Requests Section */}
          <div id="section-users" className="scroll-mt-16" />
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

          {/* Support Analytics Section */}
          <Card data-testid="card-support-analytics">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-purple-500" />
                Support Analytics (Sophie AI)
              </CardTitle>
              <CardDescription>AI-powered customer support metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{supportAnalytics?.totalTickets || 0}</p>
                  <p className="text-xs text-muted-foreground">Total Tickets</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{supportAnalytics?.openTickets || 0}</p>
                  <p className="text-xs text-muted-foreground">Open</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{supportAnalytics?.aiResolutionRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">AI Resolution Rate</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{supportAnalytics?.averageRating ? `${supportAnalytics.averageRating}/5` : '-'}</p>
                  <p className="text-xs text-muted-foreground">Avg Rating</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Escalation Queue Section */}
          <Card data-testid="card-escalation-queue">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HandHelping className="w-5 h-5 text-orange-500" />
                  Escalation Queue
                  {escalations && escalations.length > 0 && (
                    <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                      {escalations.length} needs attention
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Escalated tickets requiring manual review</CardDescription>
              </div>
              {selectedEscalations.size > 1 && (
                <Button
                  size="sm"
                  onClick={() => generateBatchPromptMutation.mutate(Array.from(selectedEscalations))}
                  disabled={generateBatchPromptMutation.isPending}
                  data-testid="button-batch-prompt"
                >
                  {generateBatchPromptMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Clipboard className="w-3 h-3 mr-1" />
                  )}
                  Generate Batch Prompt ({selectedEscalations.size})
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {escalationsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : escalations && escalations.length > 0 ? (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {escalations.map((ticket) => (
                    <div 
                      key={ticket.id} 
                      className={`flex items-start gap-3 p-4 rounded-lg border ${
                        ticket.priority === 'urgent' ? 'bg-red-500/5 border-red-500/20' :
                        ticket.priority === 'high' ? 'bg-orange-500/5 border-orange-500/20' :
                        'bg-muted/50 border-border'
                      }`}
                      data-testid={`escalation-item-${ticket.id}`}
                    >
                      <Checkbox
                        checked={selectedEscalations.has(ticket.id)}
                        onCheckedChange={(checked) => handleEscalationSelect(ticket.id, !!checked)}
                        data-testid={`checkbox-escalation-${ticket.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate" data-testid={`text-subject-${ticket.id}`}>
                              #{ticket.id}: {ticket.subject}
                            </h4>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <Badge variant="outline" className="text-xs">
                                {ticket.category || 'General'}
                              </Badge>
                              {ticket.priority && (
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getPriorityBadgeColor(ticket.priority)}`}
                                >
                                  {ticket.priority}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {ticket.organizationName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {ticket.createdAt ? formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true }) : ''}
                              </span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generatePromptMutation.mutate(ticket.id)}
                            disabled={generatingPromptFor === ticket.id}
                            data-testid={`button-prompt-${ticket.id}`}
                          >
                            {generatingPromptFor === ticket.id ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <ExternalLink className="w-3 h-3 mr-1" />
                            )}
                            Generate Prompt
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2" data-testid={`text-description-${ticket.id}`}>
                          {ticket.description}
                        </p>
                        {ticket.rootCauseAnalysis && (
                          <div className="text-xs text-muted-foreground mt-2 p-2 bg-background rounded border">
                            <span className="font-medium">Root Cause: </span>
                            {ticket.rootCauseAnalysis.rootCause || 'Analysis inconclusive'}
                            {ticket.rootCauseAnalysis.confidence && (
                              <span className="ml-2 text-orange-600">
                                ({Math.round(ticket.rootCauseAnalysis.confidence * 100)}% confidence)
                              </span>
                            )}
                          </div>
                        )}
                        {ticket.solutionsTried.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            <span className="font-medium">Attempted fixes: </span>
                            {ticket.solutionsTried.length} solution(s) tried
                          </div>
                        )}
                        {ticket.relatedAlerts.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3 text-yellow-500" />
                            <span className="text-xs text-yellow-600">
                              {ticket.relatedAlerts.length} related alert(s)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500" />
                  <p className="text-sm">No escalations pending</p>
                  <p className="text-xs">Sophie is handling all support requests</p>
                </div>
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
                          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
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
                {validationStatus?.isRunning && validationStatus?.progress && (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    {validationStatus.progress.completed || 0}/{validationStatus.progress.total || 0}
                  </Badge>
                )}
                <Button
                  onClick={() => setBulkImportOpen(true)}
                  variant="outline"
                  size="sm"
                  data-testid="button-bulk-import-sources"
                >
                  <Database className="w-4 h-4 mr-1" />
                  Bulk Import
                </Button>
                <Button
                  onClick={() => testAllDataSourcesMutation.mutate()}
                  disabled={testAllDataSourcesMutation.isPending || validationStatus?.isRunning}
                  variant="outline"
                  size="sm"
                  data-testid="button-test-all-sources"
                >
                  {testAllDataSourcesMutation.isPending || validationStatus?.isRunning ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1" />
                  )}
                  {validationStatus?.isRunning ? "Validating..." : "Validate All"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Bulk Import Dialog */}
              <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5" />
                      Bulk Import Data Sources
                    </DialogTitle>
                    <DialogDescription>
                      Paste a JSON array of data source objects. Required fields: <code className="text-xs bg-muted px-1 rounded">key</code>, <code className="text-xs bg-muted px-1 rounded">title</code>, <code className="text-xs bg-muted px-1 rounded">category</code>.
                      Optional: subcategory, description, portalUrl, apiUrl, coverage, accessLevel, dataTypes[].
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Textarea
                      placeholder={'[\n  {\n    "key": "usgs_topo",\n    "title": "USGS Topographic Maps",\n    "category": "topography",\n    "portalUrl": "https://ngmdb.usgs.gov/topoview/"\n  }\n]'}
                      value={bulkImportJson}
                      onChange={(e) => setBulkImportJson(e.target.value)}
                      className="font-mono text-xs h-64"
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBulkImportOpen(false)}>Cancel</Button>
                    <Button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(bulkImportJson);
                          if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
                          bulkImportMutation.mutate(parsed);
                        } catch (e: any) {
                          toast({ title: "Invalid JSON", description: e.message, variant: "destructive" });
                        }
                      }}
                      disabled={bulkImportMutation.isPending || !bulkImportJson.trim()}
                    >
                      {bulkImportMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Import Sources
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {dataSourcesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : dataSources && dataSources.length > 0 ? (
                <div className="space-y-4">
                  {/* Search filter */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by title, category, or coverage…"
                      value={dataSourceFilter}
                      onChange={(e) => setDataSourceFilter(e.target.value)}
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
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
                    {dataSources.filter((source) => {
                      if (!dataSourceFilter) return true;
                      const q = dataSourceFilter.toLowerCase();
                      return source.title?.toLowerCase().includes(q) ||
                        source.category?.toLowerCase().includes(q) ||
                        source.coverage?.toLowerCase().includes(q) ||
                        source.description?.toLowerCase().includes(q);
                    }).map((source) => (
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
                                       'bg-muted text-muted-foreground border-border'}
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
                              <span title="Test passed"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>
                            ) : (
                              <span title={dataSourceTestResults.get(source.id)?.message}><AlertCircle className="w-4 h-4 text-red-600" /></span>
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
                            'bg-muted text-muted-foreground border-border'
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
                            'bg-muted text-muted-foreground border-border'
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
          <div id="section-revenue" className="scroll-mt-16 col-span-full" />
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
              GIS Endpoint Discovery
            </DialogTitle>
            <DialogDescription>
              Discover and add new county GIS endpoints to the database
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex gap-2 border-b pb-2">
            <Button 
              variant={liveDiscoveryTab === "patterns" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setLiveDiscoveryTab("patterns")}
              data-testid="tab-known-patterns"
            >
              Known Patterns
            </Button>
            <Button 
              variant={liveDiscoveryTab === "live" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setLiveDiscoveryTab("live")}
              data-testid="tab-live-discovery"
            >
              Live Discovery
            </Button>
          </div>

          {liveDiscoveryTab === "patterns" ? (
            <>
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
                                            className={`text-xs ${endpoint.confidenceScore >= 85 ? 'bg-green-500/10 text-green-600 border-green-500/20' : endpoint.confidenceScore >= 70 ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 'bg-muted text-muted-foreground border-border'}`}
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
                  <p>Click "Scan for New" to discover endpoints from known patterns.</p>
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
            </>
          ) : (
            <>
              <div className="space-y-3 pb-3 border-b">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">
                    Scan ArcGIS Online to discover new parcel/property services
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => batchValidateMutation.mutate()}
                      disabled={batchValidateMutation.isPending}
                      data-testid="button-batch-validate"
                    >
                      {batchValidateMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                      )}
                      Validate Pending
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => scanArcGISMutation.mutate()}
                      disabled={scanArcGISMutation.isPending}
                      data-testid="button-scan-arcgis"
                    >
                      {scanArcGISMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Globe className="w-4 h-4 mr-1" />
                      )}
                      Scan ArcGIS Online
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground">Filter by state:</label>
                    <Select 
                      value={discoveryStateFilter} 
                      onValueChange={setDiscoveryStateFilter}
                    >
                      <SelectTrigger className="w-32" data-testid="select-discovery-state-filter">
                        <SelectValue placeholder="All states" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All States</SelectItem>
                        <SelectItem value="AL">AL</SelectItem>
                        <SelectItem value="AZ">AZ</SelectItem>
                        <SelectItem value="AR">AR</SelectItem>
                        <SelectItem value="CA">CA</SelectItem>
                        <SelectItem value="CO">CO</SelectItem>
                        <SelectItem value="CT">CT</SelectItem>
                        <SelectItem value="DE">DE</SelectItem>
                        <SelectItem value="FL">FL</SelectItem>
                        <SelectItem value="GA">GA</SelectItem>
                        <SelectItem value="ID">ID</SelectItem>
                        <SelectItem value="IL">IL</SelectItem>
                        <SelectItem value="IN">IN</SelectItem>
                        <SelectItem value="IA">IA</SelectItem>
                        <SelectItem value="KS">KS</SelectItem>
                        <SelectItem value="KY">KY</SelectItem>
                        <SelectItem value="LA">LA</SelectItem>
                        <SelectItem value="ME">ME</SelectItem>
                        <SelectItem value="MD">MD</SelectItem>
                        <SelectItem value="MA">MA</SelectItem>
                        <SelectItem value="MI">MI</SelectItem>
                        <SelectItem value="MN">MN</SelectItem>
                        <SelectItem value="MS">MS</SelectItem>
                        <SelectItem value="MO">MO</SelectItem>
                        <SelectItem value="MT">MT</SelectItem>
                        <SelectItem value="NE">NE</SelectItem>
                        <SelectItem value="NV">NV</SelectItem>
                        <SelectItem value="NH">NH</SelectItem>
                        <SelectItem value="NJ">NJ</SelectItem>
                        <SelectItem value="NM">NM</SelectItem>
                        <SelectItem value="NY">NY</SelectItem>
                        <SelectItem value="NC">NC</SelectItem>
                        <SelectItem value="ND">ND</SelectItem>
                        <SelectItem value="OH">OH</SelectItem>
                        <SelectItem value="OK">OK</SelectItem>
                        <SelectItem value="OR">OR</SelectItem>
                        <SelectItem value="PA">PA</SelectItem>
                        <SelectItem value="RI">RI</SelectItem>
                        <SelectItem value="SC">SC</SelectItem>
                        <SelectItem value="SD">SD</SelectItem>
                        <SelectItem value="TN">TN</SelectItem>
                        <SelectItem value="TX">TX</SelectItem>
                        <SelectItem value="UT">UT</SelectItem>
                        <SelectItem value="VT">VT</SelectItem>
                        <SelectItem value="VA">VA</SelectItem>
                        <SelectItem value="WA">WA</SelectItem>
                        <SelectItem value="WV">WV</SelectItem>
                        <SelectItem value="WI">WI</SelectItem>
                        <SelectItem value="WY">WY</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground">Scan target states:</label>
                    <input
                      type="text"
                      placeholder="e.g., TX, AZ, NM"
                      value={scanTargetStates}
                      onChange={(e) => setScanTargetStates(e.target.value)}
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      data-testid="input-scan-target-states"
                    />
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {liveDiscoveredEndpoints && liveDiscoveredEndpoints.length > 0 ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2 border-b sticky top-0 bg-background">
                      <span className="col-span-1">State</span>
                      <span className="col-span-2">County</span>
                      <span className="col-span-1">Type</span>
                      <span className="col-span-2">Status</span>
                      <span className="col-span-2">Confidence</span>
                      <span className="col-span-4">Actions</span>
                    </div>
                    {liveDiscoveredEndpoints.map((endpoint) => (
                      <div 
                        key={endpoint.id} 
                        className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg border hover-elevate"
                        data-testid={`live-endpoint-${endpoint.id}`}
                      >
                        <span className="col-span-1 font-medium">{endpoint.state}</span>
                        <span className="col-span-2">{endpoint.county}</span>
                        <span className="col-span-1">
                          <Badge variant="outline" className="text-xs">{endpoint.endpointType.replace('arcgis_', '')}</Badge>
                        </span>
                        <span className="col-span-2">
                          {endpoint.status === "pending" && (
                            <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Pending</Badge>
                          )}
                          {endpoint.status === "validated" && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Validated</Badge>
                          )}
                          {endpoint.status === "rejected" && (
                            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Rejected</Badge>
                          )}
                          {endpoint.status === "added" && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Added</Badge>
                          )}
                        </span>
                        <span className="col-span-2">
                          {endpoint.confidenceScore && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${endpoint.confidenceScore >= 80 ? 'bg-green-500/10 text-green-600 border-green-500/20' : endpoint.confidenceScore >= 60 ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 'bg-muted text-muted-foreground border-border'}`}
                            >
                              {endpoint.confidenceScore}%
                            </Badge>
                          )}
                        </span>
                        <span className="col-span-4 flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => validateLiveEndpointMutation.mutate(endpoint.id)}
                            disabled={validateLiveEndpointMutation.isPending || endpoint.status === "added"}
                            data-testid={`button-validate-live-${endpoint.id}`}
                            title="Validate endpoint"
                          >
                            <Play className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => approveLiveEndpointMutation.mutate(endpoint.id)}
                            disabled={approveLiveEndpointMutation.isPending || endpoint.status === "added" || endpoint.status === "rejected"}
                            data-testid={`button-approve-live-${endpoint.id}`}
                            title="Approve and add to database"
                          >
                            <Check className="w-4 h-4 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => rejectLiveEndpointMutation.mutate(endpoint.id)}
                            disabled={rejectLiveEndpointMutation.isPending || endpoint.status === "added" || endpoint.status === "rejected"}
                            data-testid={`button-reject-live-${endpoint.id}`}
                            title="Reject endpoint"
                          >
                            <X className="w-4 h-4 text-red-600" />
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No discovered endpoints yet.</p>
                    <p className="text-sm mt-1">Click "Scan ArcGIS Online" to search for new GIS services.</p>
                  </div>
                )}
              </div>

              <DialogFooter className="pt-4 border-t">
                <Button 
                  variant="outline" 
                  onClick={() => setScanDialogOpen(false)}
                  data-testid="button-close-discovery"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
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

      {/* Generated Prompt Dialog */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-generated-prompt">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clipboard className="w-5 h-5 text-blue-500" />
              Generated Prompt for Replit Agent
            </DialogTitle>
            <DialogDescription>
              Copy this prompt and use it with Replit Agent to address the escalated issue
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <Textarea
              value={generatedPrompt}
              readOnly
              className="h-[50vh] font-mono text-sm resize-none"
              data-testid="textarea-generated-prompt"
            />
          </div>
          <DialogFooter className="flex flex-row justify-between items-center gap-2 pt-4 border-t">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCopyPrompt}
                data-testid="button-copy-prompt"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy to Clipboard
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPromptDialogOpen(false);
                  setGeneratedPrompt("");
                }}
                data-testid="button-close-prompt"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  const selected = Array.from(selectedEscalations);
                  if (selected.length > 0) {
                    selected.forEach(id => resolveEscalationMutation.mutate(id));
                    setSelectedEscalations(new Set());
                  }
                }}
                disabled={selectedEscalations.size === 0 || resolveEscalationMutation.isPending}
                data-testid="button-resolve-escalation"
              >
                {resolveEscalationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Mark as Resolved
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature Flags Control */}
      <div id="section-features" className="scroll-mt-16"><FeatureFlagsSection /></div>

      {/* Pricing & Promotions */}
      <div id="section-pricing" className="scroll-mt-16"><PricingSection /></div>

      {/* Growth & Ad Campaigns */}
      <div id="section-growth" className="scroll-mt-16"><GrowthSection /></div>

      {/* Org Health Monitor */}
      <div id="section-org-health" className="scroll-mt-16"><OrgHealthMonitor /></div>

      {/* AI Models + System API Keys = Config */}
      <AIModelsSection />
      <SystemApiKeysSection />

      {/* Autopilot Status Bar — fixed at bottom */}
      <AutopilotStatusBar />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AI Models Management section
// ─────────────────────────────────────────────────────────────────────
function AIModelsSection() {
  const { data: models = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/admin/ai-models"],
  });
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PUT", `/api/admin/ai-models/${id}`, { enabled }),
    onSuccess: () => { refetch(); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const updateWeightMutation = useMutation({
    mutationFn: async ({ id, weight }: { id: number; weight: number }) =>
      apiRequest("PUT", `/api/admin/ai-models/${id}`, { weight }),
    onSuccess: () => { refetch(); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  return (
    <div id="section-config" className="mt-8 p-6 border rounded-xl bg-card space-y-4 scroll-mt-16" data-testid="section-ai-models">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          AI Model Configuration
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          All models route through OpenRouter. Adjust weights to control model selection by complexity tier.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-24 rounded-lg bg-muted/50" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 pr-4 font-medium">Model</th>
                <th className="text-right py-2 pr-4 font-medium">Input $/M</th>
                <th className="text-right py-2 pr-4 font-medium">Output $/M</th>
                <th className="text-right py-2 pr-4 font-medium">Weight</th>
                <th className="text-center py-2 pr-4 font-medium">Enabled</th>
                <th className="text-left py-2 font-medium">Task Types</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m: any) => (
                <tr key={m.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{m.modelId}</div>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">
                    ${parseFloat(m.costPerMillionInput || "0").toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">
                    ${parseFloat(m.costPerMillionOutput || "0").toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={m.weight ?? 50}
                      onBlur={(e) => updateWeightMutation.mutate({ id: m.id, weight: parseInt(e.target.value) })}
                      className="w-14 text-right border rounded px-1 py-0.5 text-xs bg-background"
                    />
                  </td>
                  <td className="py-2 pr-4 text-center">
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: m.id, enabled: v })}
                    />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {(m.taskTypes || []).slice(0, 4).map((t: string) => (
                        <Badge key={t} variant="secondary" className="text-xs px-1 py-0">{t}</Badge>
                      ))}
                      {(m.taskTypes || []).length > 4 && (
                        <Badge variant="outline" className="text-xs px-1 py-0">+{(m.taskTypes || []).length - 4}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// System API Keys section
// ─────────────────────────────────────────────────────────────────────
function SystemApiKeysSection() {
  const { data: keys = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/admin/system-api-keys"],
  });
  const { toast } = useToast();
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const updateMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      apiRequest("PUT", `/api/admin/system-api-keys/${provider}`, { apiKey }),
    onSuccess: () => {
      refetch();
      setEditProvider(null);
      setNewKey("");
      toast({ title: "API key saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  return (
    <div className="mt-6 mb-8 p-6 border rounded-xl bg-card space-y-4 scroll-mt-16" data-testid="section-system-api-keys">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Key className="w-5 h-5 text-primary" />
          System API Keys
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Platform-wide API keys. Users' BYOK keys override these for their own usage.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-20 rounded-lg bg-muted/50" />
      ) : (
        <div className="space-y-2">
          {(keys as any[]).map((key) => (
            <div key={key.id} className="flex items-center gap-3 p-3 border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{key.displayName}</span>
                  <Badge variant={key.hasKey ? "default" : "outline"} className="text-xs">
                    {key.hasKey ? "Configured" : "Not set"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground font-mono">{key.provider}</div>
              </div>
              {editProvider === key.provider ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder="Enter API key…"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="h-8 w-48 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => updateMutation.mutate({ provider: key.provider, apiKey: newKey })}
                    disabled={updateMutation.isPending || !newKey}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditProvider(null); setNewKey(""); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs shrink-0"
                  onClick={() => setEditProvider(key.provider)}
                >
                  {key.hasKey ? "Update Key" : "Set Key"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE FLAGS SECTION
// ─────────────────────────────────────────────────────────────────────
interface FeatureFlag {
  id: number;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  controlledRoutes: string[];
}

function FeatureFlagsSection() {
  const { toast } = useToast();

  const { data: flags, isLoading, refetch } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/founder/feature-flags"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiRequest("PUT", `/api/founder/feature-flags/${key}`, { enabled }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/config/features"] });
    },
    onError: () => toast({ title: "Failed to update flag", variant: "destructive" }),
  });

  return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ToggleRight className="w-5 h-5 text-primary" />
          Feature Flags
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Control which features are live for all users. Disabled features are hidden from the sidebar and return 404.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-40 rounded-lg bg-muted/50" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(flags || []).map((flag) => (
            <div key={flag.key} className="flex items-start gap-3 p-3 border rounded-lg">
              <Switch
                checked={flag.enabled}
                onCheckedChange={(enabled) => toggleMutation.mutate({ key: flag.key, enabled })}
                disabled={toggleMutation.isPending}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{flag.label}</span>
                  <Badge variant={flag.enabled ? "default" : "outline"} className="text-xs">
                    {flag.enabled ? "Live" : "Hidden"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{flag.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PRICING SECTION
// ─────────────────────────────────────────────────────────────────────
interface PricingConfigRow {
  id: number;
  tier: string;
  displayPriceMonthly: number;
  displayPriceYearly: number;
  promoLabel: string | null;
  promoDiscountPercent: number | null;
  promoEndsAt: string | null;
  stripeCouponId: string | null;
  allowPromoCodes: boolean;
}

function PricingSection() {
  const { toast } = useToast();
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [draftPrices, setDraftPrices] = useState<{ monthly: string; yearly: string }>({ monthly: "", yearly: "" });
  const [promoForm, setPromoForm] = useState<{ tier: string; label: string; discount: string; endsAt: string } | null>(null);

  const { data: configs, isLoading, refetch } = useQuery<PricingConfigRow[]>({
    queryKey: ["/api/founder/pricing"],
  });

  const updatePriceMutation = useMutation({
    mutationFn: async ({ tier, monthly, yearly }: { tier: string; monthly: number; yearly: number }) =>
      apiRequest("PUT", `/api/founder/pricing/${tier}`, {
        displayPriceMonthly: monthly,
        displayPriceYearly: yearly,
      }),
    onSuccess: () => { refetch(); setEditingTier(null); toast({ title: "Prices updated" }); },
    onError: () => toast({ title: "Failed to update prices", variant: "destructive" }),
  });

  const createPromoMutation = useMutation({
    mutationFn: async ({ tier, label, discount, endsAt }: { tier: string; label: string; discount: number; endsAt: string }) =>
      apiRequest("POST", `/api/founder/pricing/${tier}/promo`, {
        promoLabel: label,
        promoDiscountPercent: discount,
        promoEndsAt: endsAt,
      }),
    onSuccess: () => { refetch(); setPromoForm(null); toast({ title: "Promotion activated" }); },
    onError: () => toast({ title: "Failed to create promotion", variant: "destructive" }),
  });

  const clearPromoMutation = useMutation({
    mutationFn: async (tier: string) => apiRequest("DELETE", `/api/founder/pricing/${tier}/promo`),
    onSuccess: () => { refetch(); toast({ title: "Promotion cleared" }); },
    onError: () => toast({ title: "Failed to clear promotion", variant: "destructive" }),
  });

  const togglePromoCodesMutation = useMutation({
    mutationFn: async ({ tier, allow }: { tier: string; allow: boolean }) =>
      apiRequest("PUT", `/api/founder/pricing/${tier}`, { allowPromoCodes: allow }),
    onSuccess: () => refetch(),
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const tierLabels: Record<string, string> = {
    starter: "Starter",
    pro: "Pro",
    growth: "Growth",
    enterprise: "Enterprise",
  };

  return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary" />
          Pricing & Promotions
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Adjust display pricing, run flash sales, and manage Stripe promo codes.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-40 rounded-lg bg-muted/50" />
      ) : (
        <div className="space-y-3">
          {(configs || []).map((cfg) => {
            const isExpired = cfg.promoEndsAt && new Date(cfg.promoEndsAt) < new Date();
            const hasActivePromo = cfg.promoLabel && !isExpired;
            return (
              <div key={cfg.tier} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium">{tierLabels[cfg.tier] || cfg.tier}</span>
                    {hasActivePromo && (
                      <Badge className="ml-2 bg-green-500/10 text-green-700 border-green-500/20">
                        <Percent className="w-3 h-3 mr-1" />
                        {cfg.promoDiscountPercent}% off — {cfg.promoLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingTier === cfg.tier ? (
                      <>
                        <Input
                          type="number"
                          className="h-8 w-24 text-sm"
                          placeholder="Monthly ¢"
                          value={draftPrices.monthly}
                          onChange={(e) => setDraftPrices((p) => ({ ...p, monthly: e.target.value }))}
                        />
                        <Input
                          type="number"
                          className="h-8 w-24 text-sm"
                          placeholder="Yearly ¢"
                          value={draftPrices.yearly}
                          onChange={(e) => setDraftPrices((p) => ({ ...p, yearly: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => updatePriceMutation.mutate({ tier: cfg.tier, monthly: parseInt(draftPrices.monthly), yearly: parseInt(draftPrices.yearly) })}
                          disabled={updatePriceMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingTier(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground font-mono">
                          ${(cfg.displayPriceMonthly / 100).toFixed(0)}/mo · ${(cfg.displayPriceYearly / 100).toFixed(0)}/mo yearly
                        </span>
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => { setEditingTier(cfg.tier); setDraftPrices({ monthly: String(cfg.displayPriceMonthly), yearly: String(cfg.displayPriceYearly) }); }}>
                          Edit Prices
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {hasActivePromo ? (
                    <Button size="sm" variant="destructive" className="h-7 text-xs"
                      onClick={() => clearPromoMutation.mutate(cfg.tier)}
                      disabled={clearPromoMutation.isPending}>
                      End Promotion
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setPromoForm({ tier: cfg.tier, label: "", discount: "", endsAt: "" })}>
                      <Percent className="w-3 h-3 mr-1" />
                      Flash Sale
                    </Button>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={cfg.allowPromoCodes}
                      onCheckedChange={(allow) => togglePromoCodesMutation.mutate({ tier: cfg.tier, allow })}
                      className="scale-75"
                    />
                    <span className="text-xs text-muted-foreground">User promo codes at checkout</span>
                  </div>
                  {cfg.promoEndsAt && !isExpired && (
                    <span className="text-xs text-muted-foreground">
                      Ends {new Date(cfg.promoEndsAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {promoForm?.tier === cfg.tier && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Label (e.g. Spring Sale)" className="h-8 text-sm"
                        value={promoForm.label} onChange={(e) => setPromoForm((p) => p ? { ...p, label: e.target.value } : null)} />
                      <Input type="number" min="1" max="99" placeholder="Discount %" className="h-8 text-sm"
                        value={promoForm.discount} onChange={(e) => setPromoForm((p) => p ? { ...p, discount: e.target.value } : null)} />
                      <Input type="datetime-local" className="h-8 text-sm col-span-2"
                        value={promoForm.endsAt} onChange={(e) => setPromoForm((p) => p ? { ...p, endsAt: e.target.value } : null)} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-8"
                        onClick={() => createPromoMutation.mutate({ tier: cfg.tier, label: promoForm.label, discount: parseInt(promoForm.discount), endsAt: promoForm.endsAt })}
                        disabled={createPromoMutation.isPending || !promoForm.label || !promoForm.discount || !promoForm.endsAt}>
                        Activate Promo
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setPromoForm(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GROWTH / AD CAMPAIGNS SECTION
// ─────────────────────────────────────────────────────────────────────
interface GrowthCampaignItem {
  id: number;
  name: string;
  templateKey: string;
  status: string;
  externalCampaignId: string | null;
  dailyBudgetCents: number;
  totalSpendCents: number;
  impressions: number;
  clicks: number;
  signups: number;
  createdAt: string;
}

interface AdAccount {
  adAccountId: string;
  pixelId: string | null;
  isActive: boolean;
  accessToken: string;
}

interface CampaignTemplate {
  key: string;
  name: string;
  objective: string;
  headline: string;
  description: string;
}

interface SignupAttribution {
  organizationId: number;
  name: string;
  subscriptionTier: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
}

interface AdCopyVariant {
  angle: string;
  angleLabel: string;
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
  hook: string;
}

interface GeneratedAdImage {
  style: string;
  styleLabel: string;
  url: string;
  aspectRatio: string;
  metaImageHash?: string;
}

interface CreativeBundle {
  id: string;
  templateKey: string;
  status: "generating" | "ready" | "error" | "deployed";
  copies: AdCopyVariant[] | null;
  images: GeneratedAdImage[] | null;
  error: string | null;
}

const ANGLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pain_point: Flame,
  aspiration: Heart,
  social_proof: Users2,
  curiosity: HelpCircle,
};

const ANGLE_COLORS: Record<string, string> = {
  pain_point: "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20",
  aspiration: "border-purple-200 bg-purple-50/50 dark:border-purple-900/40 dark:bg-purple-950/20",
  social_proof: "border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20",
  curiosity: "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
};

function GrowthSection() {
  const { toast } = useToast();

  // Ad account form
  const [showAdAccountForm, setShowAdAccountForm] = useState(false);
  const [adForm, setAdForm] = useState({ adAccountId: "", accessToken: "", pixelId: "", appId: "" });

  // Campaign wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<"setup" | "generating" | "preview" | "deploy">("setup");
  const [wizardTemplate, setWizardTemplate] = useState("");
  const [wizardName, setWizardName] = useState("");
  const [wizardBudget, setWizardBudget] = useState("2000");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<CreativeBundle | null>(null);
  const [editingCopy, setEditingCopy] = useState<string | null>(null); // angle being edited
  const [editDraft, setEditDraft] = useState<Partial<AdCopyVariant>>({});
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [regeneratingAngle, setRegeneratingAngle] = useState<string | null>(null);

  const { data: adAccount, refetch: refetchAccount } = useQuery<AdAccount | null>({
    queryKey: ["/api/founder/growth/ad-account"],
  });

  const { data: campaigns, refetch: refetchCampaigns } = useQuery<GrowthCampaignItem[]>({
    queryKey: ["/api/founder/growth/campaigns"],
  });

  const { data: templates } = useQuery<CampaignTemplate[]>({
    queryKey: ["/api/founder/growth/templates"],
  });

  const { data: attribution } = useQuery<SignupAttribution[]>({
    queryKey: ["/api/founder/growth/attribution"],
  });

  // Poll for creative bundle status while generating
  const { data: bundleData } = useQuery<CreativeBundle>({
    queryKey: [`/api/founder/growth/creative-bundles/${bundleId}`],
    enabled: !!bundleId && wizardStep === "generating",
    refetchInterval: (query) => {
      const data = query.state.data as CreativeBundle | undefined;
      if (data?.status === "generating") return 2000;
      return false;
    },
  });

  // Auto-advance wizard when bundle is ready
  useEffect(() => {
    if (bundleData?.status === "ready" && wizardStep === "generating") {
      setBundle(bundleData);
      setWizardStep("preview");
      setSelectedImageIdx(0);
    }
    if (bundleData?.status === "error" && wizardStep === "generating") {
      toast({ title: "Creative generation failed", description: bundleData.error || "Try again", variant: "destructive" });
      setWizardStep("setup");
      setBundleId(null);
    }
  }, [bundleData, wizardStep]);

  const saveAdAccountMutation = useMutation({
    mutationFn: async (data: typeof adForm) => apiRequest("PUT", "/api/founder/growth/ad-account", data),
    onSuccess: () => { refetchAccount(); setShowAdAccountForm(false); toast({ title: "Ad account saved" }); },
    onError: () => toast({ title: "Failed to save ad account", variant: "destructive" }),
  });

  const generateCreativeMutation = useMutation({
    mutationFn: async ({ templateKey }: { templateKey: string }) =>
      apiRequest("POST", "/api/founder/growth/generate-creative", { templateKey }).then((r) => r.json()),
    onSuccess: (data: { bundleId: string }) => {
      setBundleId(data.bundleId);
      setWizardStep("generating");
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to start generation", variant: "destructive" }),
  });

  const regenerateCopyMutation = useMutation({
    mutationFn: async ({ id, angle }: { id: string; angle: string }) =>
      apiRequest("POST", `/api/founder/growth/creative-bundles/${id}/regenerate-copy`, { angle }).then((r) => r.json()),
    onSuccess: (data: CreativeBundle) => {
      setBundle(data);
      setRegeneratingAngle(null);
      toast({ title: "Copy variant refreshed" });
    },
    onError: () => { setRegeneratingAngle(null); toast({ title: "Regeneration failed", variant: "destructive" }); },
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!bundleId) throw new Error("No bundle");
      const budgetCents = parseInt(wizardBudget) || 2000;
      return apiRequest("POST", `/api/founder/growth/creative-bundles/${bundleId}/deploy`, {
        name: wizardName,
        dailyBudgetCents: budgetCents,
        targetCountries: ["US"],
      }).then((r) => r.json());
    },
    onSuccess: () => {
      refetchCampaigns();
      setWizardOpen(false);
      resetWizard();
      toast({ title: "Campaign deployed!", description: "Check Meta Ads Manager to activate it." });
    },
    onError: (err: any) => toast({ title: err?.message || "Deploy failed", variant: "destructive" }),
  });

  const toggleCampaignMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/founder/growth/campaigns/${id}/status`, { status }),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Campaign updated" }); },
    onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
  });

  const syncStatsMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/founder/growth/campaigns/${id}/sync`),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Stats synced" }); },
    onError: () => toast({ title: "Failed to sync stats", variant: "destructive" }),
  });

  function resetWizard() {
    setWizardStep("setup");
    setWizardTemplate("");
    setWizardName("");
    setWizardBudget("2000");
    setBundleId(null);
    setBundle(null);
    setEditingCopy(null);
    setEditDraft({});
    setSelectedImageIdx(0);
  }

  function saveCopyEdit(angle: string) {
    if (!bundle?.copies) return;
    const updated: CreativeBundle = {
      ...bundle,
      copies: bundle.copies.map((c) => c.angle === angle ? { ...c, ...editDraft } : c),
    };
    setBundle(updated);
    setEditingCopy(null);
    setEditDraft({});
  }

  const statusColors: Record<string, string> = {
    active: "bg-green-500/10 text-green-700 border-green-500/20",
    paused: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
    draft: "bg-muted text-muted-foreground",
    completed: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  };

  const TEMPLATE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; tagline: string }> = {
    land_investors_signup: { icon: Target, color: "text-green-600", tagline: "Cold audience — land investors & RE buyers" },
    retargeting_visitors: { icon: RotateCcw, color: "text-orange-600", tagline: "Warm audience — website visitors who didn't convert" },
    lookalike_subscribers: { icon: Users2, color: "text-purple-600", tagline: "Lookalike — similar to your current subscribers" },
  };

  const sourceCounts = (attribution || []).reduce<Record<string, number>>((acc, s) => {
    const src = s.utmSource || "organic";
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  const dailyBudgetDollars = Math.round(parseInt(wizardBudget || "2000") / 100);
  const selectedCopy = bundle?.copies?.find((c) => c.angle === editingCopy);

  return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Growth & Ads
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            AI-generated campaigns with 4 copy variants and 3 images. Deploy in one click.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAdAccountForm(true)}>
            <Key className="w-3 h-3 mr-1" />
            {adAccount ? "Update Ad Account" : "Connect Meta"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-primary to-accent text-white font-semibold"
            onClick={() => { resetWizard(); setWizardOpen(true); }}
            disabled={!adAccount}
          >
            <Wand2 className="w-3.5 h-3.5" />
            Generate Campaign
          </Button>
        </div>
      </div>

      {/* Ad account connection form */}
      {showAdAccountForm && (
        <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
          <h3 className="font-medium text-sm">Meta Ad Account Credentials</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ad Account ID</label>
              <Input placeholder="act_123456789" className="h-8 text-sm" value={adForm.adAccountId}
                onChange={(e) => setAdForm((f) => ({ ...f, adAccountId: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Access Token</label>
              <Input type="password" placeholder="EAAxxxxxxx" className="h-8 text-sm" value={adForm.accessToken}
                onChange={(e) => setAdForm((f) => ({ ...f, accessToken: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Pixel ID (for conversion tracking)</label>
              <Input placeholder="123456789" className="h-8 text-sm" value={adForm.pixelId}
                onChange={(e) => setAdForm((f) => ({ ...f, pixelId: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Facebook Page / App ID</label>
              <Input placeholder="Meta Page or App ID" className="h-8 text-sm" value={adForm.appId}
                onChange={(e) => setAdForm((f) => ({ ...f, appId: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveAdAccountMutation.mutate(adForm)}
              disabled={saveAdAccountMutation.isPending || !adForm.adAccountId || !adForm.accessToken}>
              Save Credentials
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdAccountForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {adAccount && (
        <div className="flex items-center gap-2 p-2.5 bg-green-500/5 border border-green-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-700 font-medium">Meta ad account connected</span>
          <span className="text-sm text-muted-foreground ml-1">{adAccount.adAccountId}</span>
          {adAccount.pixelId && <Badge className="text-xs ml-auto">Pixel active</Badge>}
        </div>
      )}

      {!adAccount && (
        <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
          Connect your Meta ad account above to enable campaign generation and deployment.
        </div>
      )}

      {/* Campaign Wizard Dialog */}
      <Dialog open={wizardOpen} onOpenChange={(o) => { if (!o) { setWizardOpen(false); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-primary" />
              {wizardStep === "setup" && "New Campaign — Setup"}
              {wizardStep === "generating" && "Generating AI Creatives…"}
              {wizardStep === "preview" && "Preview & Edit Creatives"}
              {wizardStep === "deploy" && "Ready to Deploy"}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === "setup" && "Choose a campaign template and budget, then let AI generate your creatives."}
              {wizardStep === "generating" && "GPT-4o is writing 4 copy variants while DALL-E 3 generates 3 HD images. Takes ~30–60 seconds."}
              {wizardStep === "preview" && "Review and edit each ad variant. All 4 copy angles + 3 images will run as A/B tests."}
              {wizardStep === "deploy" && "Campaign will be created in Meta Ads Manager in PAUSED state. Activate it there when ready."}
            </DialogDescription>
          </DialogHeader>

          {/* ── Step 1: Setup ──────────────────────────────────────────── */}
          {wizardStep === "setup" && (
            <div className="space-y-5 pt-2">
              <div>
                <label className="text-sm font-medium mb-2 block">Campaign Template</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(templates || []).map((t) => {
                    const meta = TEMPLATE_META[t.key] || { icon: Radio, color: "text-primary", tagline: t.description };
                    const Icon = meta.icon;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setWizardTemplate(t.key)}
                        className={`p-4 border-2 rounded-xl text-left transition-all ${
                          wizardTemplate === t.key
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <Icon className={`w-5 h-5 mb-2 ${meta.color}`} />
                        <div className="font-medium text-sm">{t.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{meta.tagline}</div>
                        <div className="text-xs text-muted-foreground mt-1 italic">"{t.headline}"</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Campaign Name</label>
                  <Input
                    placeholder="e.g. AcreOS – Land Investors – March 2026"
                    value={wizardName}
                    onChange={(e) => setWizardName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block flex justify-between">
                    Daily Budget
                    <span className="font-semibold text-primary">${dailyBudgetDollars}/day</span>
                  </label>
                  <input
                    type="range"
                    min="1000"
                    max="50000"
                    step="500"
                    value={wizardBudget}
                    onChange={(e) => setWizardBudget(e.target.value)}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                    <span>$10/day</span>
                    <span>$500/day</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <span>
                  AI will generate <strong>4 copy variants</strong> (pain point, aspiration, social proof, curiosity hook)
                  and <strong>3 DALL-E 3 HD images</strong> (lifestyle, product UI, aerial land). All will run as A/B tests
                  within a single ad set.
                </span>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setWizardOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => generateCreativeMutation.mutate({ templateKey: wizardTemplate })}
                  disabled={!wizardTemplate || !wizardName || generateCreativeMutation.isPending}
                  className="gap-2"
                >
                  {generateCreativeMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Wand2 className="w-4 h-4" />}
                  Generate AI Creatives
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* ── Step 2: Generating ──────────────────────────────────────── */}
          {wizardStep === "generating" && (
            <div className="py-12 text-center space-y-6">
              <div className="relative mx-auto w-20 h-20">
                <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-primary/15">
                  <Sparkles className="w-9 h-9 text-primary animate-pulse" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-lg">AI is crafting your campaign</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                  Writing 4 persuasion-angle copy variants and generating 3 HD images designed specifically for land investor audiences.
                </p>
              </div>
              <div className="flex flex-col gap-2 max-w-xs mx-auto text-left">
                {[
                  { label: "GPT-4o writing copy variants", done: false },
                  { label: "DALL-E 3 generating lifestyle image", done: false },
                  { label: "DALL-E 3 generating product UI image", done: false },
                  { label: "DALL-E 3 generating aerial land image", done: false },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
                    {item.label}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Usually takes 30–60 seconds…</p>
            </div>
          )}

          {/* ── Step 3: Preview ─────────────────────────────────────────── */}
          {wizardStep === "preview" && bundle && (
            <div className="space-y-5 pt-1">
              {/* Images row */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ImageIcon className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">Generated Images <span className="text-muted-foreground font-normal">(click to select for preview)</span></span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(bundle.images || []).map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedImageIdx(idx)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-square ${
                        selectedImageIdx === idx ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <img src={img.url} alt={img.styleLabel} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-1 px-2 text-center">
                        {img.styleLabel}
                      </div>
                      {selectedImageIdx === idx && (
                        <div className="absolute top-1.5 right-1.5 bg-primary rounded-full p-0.5">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                  {(bundle.images?.length || 0) === 0 && (
                    <div className="col-span-3 p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
                      Image generation failed. Campaign will deploy without images.
                    </div>
                  )}
                </div>
              </div>

              {/* Copy variants */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <PencilLine className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">Copy Variants <span className="text-muted-foreground font-normal">(4 angles running as A/B test)</span></span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(bundle.copies || []).map((copy) => {
                    const Icon = ANGLE_ICONS[copy.angle] || Radio;
                    const colorClass = ANGLE_COLORS[copy.angle] || "border-border";
                    const isEditing = editingCopy === copy.angle;
                    const isRegenerating = regeneratingAngle === copy.angle;

                    return (
                      <div key={copy.angle} className={`p-3.5 border rounded-xl ${colorClass}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" />
                            <span className="text-xs font-semibold uppercase tracking-wide">{copy.angleLabel}</span>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              title="Regenerate this variant"
                              onClick={() => {
                                if (!bundleId) return;
                                setRegeneratingAngle(copy.angle);
                                regenerateCopyMutation.mutate({ id: bundleId, angle: copy.angle });
                              }}
                              disabled={isRegenerating || !!regeneratingAngle}
                              className="p-1 rounded hover:bg-black/5 disabled:opacity-40"
                            >
                              {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                            </button>
                            <button
                              type="button"
                              title="Edit copy"
                              onClick={() => {
                                if (isEditing) { saveCopyEdit(copy.angle); }
                                else { setEditingCopy(copy.angle); setEditDraft({ ...copy }); }
                              }}
                              className="p-1 rounded hover:bg-black/5"
                            >
                              {isEditing ? <Check className="w-3 h-3 text-green-600" /> : <PencilLine className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-1.5 text-sm">
                            <div>
                              <label className="text-xs text-muted-foreground">Headline (≤40 chars)</label>
                              <Input
                                value={editDraft.headline || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, headline: e.target.value.slice(0, 40) }))}
                                className="h-7 text-xs mt-0.5"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Primary Text (≤125 chars)</label>
                              <Textarea
                                value={editDraft.primaryText || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, primaryText: e.target.value.slice(0, 125) }))}
                                className="text-xs min-h-[60px] mt-0.5 resize-none"
                                rows={3}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Description (≤30 chars)</label>
                              <Input
                                value={editDraft.description || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value.slice(0, 30) }))}
                                className="h-7 text-xs mt-0.5"
                              />
                            </div>
                            <Button size="sm" className="w-full h-7 text-xs mt-1" onClick={() => saveCopyEdit(copy.angle)}>
                              <Check className="w-3 h-3 mr-1" /> Save
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-1 text-sm">
                            <div className="font-semibold leading-tight">{copy.headline}</div>
                            <p className="text-muted-foreground text-xs leading-relaxed">{copy.primaryText}</p>
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-xs text-muted-foreground italic">{copy.description}</span>
                              <Badge variant="outline" className="text-xs h-5">{copy.callToAction}</Badge>
                            </div>
                            {copy.hook && (
                              <div className="text-xs text-muted-foreground/70 border-t pt-1 mt-1 italic">
                                Hook: {copy.hook}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                <Layers className="w-4 h-4 text-primary shrink-0" />
                <span>
                  Deploying creates <strong>1 campaign</strong> → <strong>1 ad set</strong> → <strong>{bundle.copies?.length || 4} ads</strong>, one per copy variant.
                  Meta will automatically optimize toward the best performer.
                </span>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="ghost" onClick={() => setWizardStep("setup")} className="gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </Button>
                <Button
                  onClick={() => deployMutation.mutate()}
                  disabled={deployMutation.isPending || !wizardName}
                  className="gap-2 bg-gradient-to-r from-primary to-accent text-white"
                >
                  {deployMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Deploy {bundle.copies?.length || 4} Ad Variants to Meta
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Live Campaigns */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            Live Campaigns
            {(campaigns?.length || 0) > 0 && (
              <Badge variant="outline" className="text-xs">{campaigns!.length}</Badge>
            )}
          </h3>
          {(campaigns || []).some((c) => c.externalCampaignId) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
              onClick={() => (campaigns || []).forEach((c) => c.externalCampaignId && syncStatsMutation.mutate(c.id))}
              disabled={syncStatsMutation.isPending}>
              <RefreshCw className="w-3 h-3" />
              Sync All
            </Button>
          )}
        </div>

        {(campaigns || []).length === 0 ? (
          <div className="text-center py-8 border border-dashed rounded-lg">
            <Megaphone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No campaigns yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Generate Campaign" to create your first AI-powered campaign.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(campaigns || []).map((c) => {
              const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : null;
              const cpl = c.signups > 0 ? (c.totalSpendCents / 100 / c.signups).toFixed(2) : null;
              return (
                <div key={c.id} className="p-3 border rounded-xl hover:bg-muted/20 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge className={`text-xs ${statusColors[c.status] || ""}`}>{c.status}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">${(c.totalSpendCents / 100).toFixed(2)} spent</span>
                        <span>{c.impressions.toLocaleString()} impr.</span>
                        <span>{c.clicks.toLocaleString()} clicks</span>
                        {ctr && <span>{ctr}% CTR</span>}
                        {cpl && <span>${cpl} / signup</span>}
                        <span className="ml-auto">${(c.dailyBudgetCents / 100)}/day budget</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {c.externalCampaignId && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => syncStatsMutation.mutate(c.id)} disabled={syncStatsMutation.isPending}>
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 px-2"
                        onClick={() => toggleCampaignMutation.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })}
                        disabled={toggleCampaignMutation.isPending || !c.externalCampaignId}>
                        {c.status === "active" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Attribution */}
      <div>
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <MousePointerClick className="w-4 h-4 text-primary" />
          Signup Attribution
        </h3>
        {Object.keys(sourceCounts).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
              <Badge key={src} variant="outline" className="text-xs">
                {src}: {count}
              </Badge>
            ))}
          </div>
        )}
        {(attribution || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            UTM attribution will appear here once users sign up from your campaigns.
          </p>
        ) : (
          <div className="space-y-0 max-h-52 overflow-y-auto border rounded-lg divide-y">
            {(attribution || []).slice(0, 20).map((s) => (
              <div key={s.organizationId} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/20">
                <span className="flex-1 font-medium truncate">{s.name}</span>
                <Badge variant="outline" className="text-xs shrink-0">{s.subscriptionTier}</Badge>
                <span className="text-muted-foreground shrink-0">
                  {s.utmSource ? `${s.utmSource}${s.utmCampaign ? ` › ${s.utmCampaign}` : ""}` : "organic"}
                </span>
                <span className="text-muted-foreground shrink-0">{new Date(s.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TODAY'S BRIEFING
// AI-generated executive summary, refreshed every 15 min.
// Shows key stats (MRR, signups, alerts, actions) at a glance.
// ─────────────────────────────────────────────────────────────────────

interface BriefingData {
  summary: string;
  highlights: {
    totalMrr: number;
    newSignups24h: number;
    atRiskOrgs: number;
    unresolvedAlerts: number;
    escalatedTickets: number;
    activeCampaigns: number;
    totalOrgs: number;
  };
  generatedAt: string;
}

function TodaysBriefing() {
  const { data, isLoading, refetch, isFetching } = useQuery<BriefingData>({
    queryKey: ["/api/founder/briefing"],
    refetchInterval: 15 * 60 * 1000,
    staleTime: 14 * 60 * 1000,
  });

  return (
    <div className="p-5 rounded-xl border bg-gradient-to-br from-primary/5 via-background to-accent/5 border-primary/20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">AI Briefing</div>
            {isLoading ? (
              <div className="space-y-1.5">
                <div className="h-4 bg-muted animate-pulse rounded w-full" />
                <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-foreground">{data?.summary || "Loading briefing…"}</p>
            )}
            {data?.generatedAt && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Updated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground shrink-0"
          title="Refresh briefing"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {data?.highlights && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-4">
          {[
            { label: "MRR", value: `$${data.highlights.totalMrr.toLocaleString()}`, color: "text-green-600", icon: DollarSign },
            { label: "Paying Orgs", value: data.highlights.totalOrgs, color: "text-primary", icon: Building2 },
            { label: "New (24h)", value: data.highlights.newSignups24h, color: data.highlights.newSignups24h > 0 ? "text-green-600" : "text-muted-foreground", icon: UserPlus },
            { label: "At Risk", value: data.highlights.atRiskOrgs, color: data.highlights.atRiskOrgs > 0 ? "text-red-600" : "text-muted-foreground", icon: AlertTriangle },
            { label: "Alerts", value: data.highlights.unresolvedAlerts, color: data.highlights.unresolvedAlerts > 0 ? "text-amber-600" : "text-muted-foreground", icon: Bell },
            { label: "Escalations", value: data.highlights.escalatedTickets, color: data.highlights.escalatedTickets > 0 ? "text-red-600" : "text-muted-foreground", icon: AlertOctagon },
            { label: "Active Ads", value: data.highlights.activeCampaigns, color: "text-primary", icon: Megaphone },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="p-2 rounded-lg bg-background/60 border border-border/50 text-center">
              <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${color}`} />
              <div className={`text-base font-bold leading-none ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ACTION QUEUE
// Prioritized inbox of everything needing founder attention.
// Each item has: priority, description, estimated time, action button.
// Support escalations show AI-drafted reply with approve/edit/send.
// ─────────────────────────────────────────────────────────────────────

interface ActionQueueItem {
  id: string;
  type: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  estimatedMinutes: number;
  suggestedAction: string;
  data: Record<string, any>;
}

interface ActionQueueData {
  items: ActionQueueItem[];
  totalEstimatedMinutes: number;
  counts: { critical: number; high: number; medium: number };
}

const ACTION_PRIORITY_CONFIG = {
  critical: { label: "Critical", bg: "bg-red-500/10", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
  high: { label: "High", bg: "bg-orange-500/10", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
  medium: { label: "Medium", bg: "bg-amber-500/10", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-400" },
  low: { label: "Low", bg: "bg-muted", text: "text-muted-foreground", border: "border-border", dot: "bg-muted-foreground" },
};

const ACTION_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  support_escalation: AlertOctagon,
  dunning_critical: AlertTriangle,
  expiring_trial: Clock,
  feature_request: Lightbulb,
  inactive_campaign: Megaphone,
};

function ActionQueuePanel() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editingDraft, setEditingDraft] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<ActionQueueData>({
    queryKey: ["/api/founder/action-queue"],
    refetchInterval: 5 * 60 * 1000,
  });

  const draftMutation = useMutation({
    mutationFn: async (ticketId: number) =>
      apiRequest("POST", `/api/founder/support/${ticketId}/ai-draft`, {}).then((r) => r.json()),
    onSuccess: (data: { draft: string; ticketId: number }) => {
      setDrafts((d) => ({ ...d, [data.ticketId]: data.draft }));
    },
    onError: () => toast({ title: "Failed to generate draft", variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async ({ ticketId, message }: { ticketId: number; message: string }) =>
      apiRequest("POST", `/api/founder/support/${ticketId}/reply`, { message, resolve: true }).then((r) => r.json()),
    onSuccess: () => {
      refetch();
      toast({ title: "Reply sent and ticket resolved" });
    },
    onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
  });

  const items = data?.items || [];
  const totalMinutes = data?.totalEstimatedMinutes || 0;

  if (isLoading) {
    return (
      <div className="p-5 rounded-xl border bg-card space-y-2">
        <div className="h-5 bg-muted animate-pulse rounded w-1/3" />
        {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-5 rounded-xl border bg-card">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-lg">Action Queue</h2>
          <Badge className="bg-green-500/10 text-green-700 border-green-200 text-xs ml-1">All clear</Badge>
        </div>
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          Nothing needs your attention right now. The system is running autonomously.
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-xl border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-lg">Action Queue</h2>
          <Badge variant="outline" className="text-xs">{items.length} item{items.length !== 1 ? "s" : ""}</Badge>
          {totalMinutes > 0 && (
            <span className="text-xs text-muted-foreground">~{totalMinutes} min total</span>
          )}
        </div>
        <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Priority summary */}
      {(data?.counts?.critical || 0) + (data?.counts?.high || 0) > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(data?.counts?.critical || 0) > 0 && (
            <Badge className="bg-red-500/10 text-red-700 border-red-200 text-xs">
              {data!.counts.critical} critical
            </Badge>
          )}
          {(data?.counts?.high || 0) > 0 && (
            <Badge className="bg-orange-500/10 text-orange-700 border-orange-200 text-xs">
              {data!.counts.high} high
            </Badge>
          )}
          {(data?.counts?.medium || 0) > 0 && (
            <Badge className="bg-amber-500/10 text-amber-700 border-amber-200 text-xs">
              {data!.counts.medium} medium
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const cfg = ACTION_PRIORITY_CONFIG[item.priority] || ACTION_PRIORITY_CONFIG.low;
          const Icon = ACTION_TYPE_ICONS[item.type] || CircleDot;
          const isExpanded = expandedId === item.id;
          const ticketId = item.data?.ticketId as number | undefined;
          const hasDraft = ticketId ? !!drafts[ticketId] : false;
          const isEditing = ticketId ? editingDraft === ticketId : false;

          return (
            <div key={item.id} className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
              <div
                className="flex items-start gap-3 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${cfg.dot}`} />
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.text}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium text-sm ${cfg.text}`}>{item.title}</span>
                    <Badge className={`text-xs ${cfg.bg} ${cfg.text} ${cfg.border}`}>{cfg.label}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">~{item.estimatedMinutes} min</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </div>

              {isExpanded && (
                <div className="mt-3 pl-9 space-y-3">
                  <p className="text-xs text-muted-foreground italic">
                    Suggested: {item.suggestedAction}
                  </p>

                  {/* Support escalation — AI reply flow */}
                  {item.type === "support_escalation" && ticketId && (
                    <div className="space-y-2">
                      {!hasDraft ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => draftMutation.mutate(ticketId)}
                          disabled={draftMutation.isPending}
                        >
                          {draftMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          Generate AI Reply Draft
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">AI-drafted reply (edit if needed)</label>
                          {isEditing ? (
                            <Textarea
                              value={drafts[ticketId]}
                              onChange={(e) => setDrafts((d) => ({ ...d, [ticketId]: e.target.value }))}
                              className="text-sm min-h-[120px] resize-none"
                              rows={5}
                            />
                          ) : (
                            <div className="p-2.5 bg-background rounded border text-sm leading-relaxed whitespace-pre-wrap">
                              {drafts[ticketId]}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => replyMutation.mutate({ ticketId, message: drafts[ticketId] })}
                              disabled={replyMutation.isPending}
                            >
                              {replyMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              Send & Resolve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => setEditingDraft(isEditing ? null : ticketId)}
                            >
                              <PencilLine className="w-3 h-3" />
                              {isEditing ? "Done" : "Edit"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1"
                              onClick={() => draftMutation.mutate(ticketId)}
                              disabled={draftMutation.isPending}
                            >
                              <RotateCcw className="w-3 h-3" />
                              Regenerate
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Other action types — just a link/note */}
                  {item.type !== "support_escalation" && (
                    <div className="text-xs text-muted-foreground bg-background/60 rounded p-2 border">
                      {item.type === "dunning_critical" && "Org is in a critical payment stage. Review their account and consider a direct call or email."}
                      {item.type === "expiring_trial" && "Trial conversion window closing. A personal touch often converts — try reaching out directly."}
                      {item.type === "feature_request" && "High-demand request from your users. Quick triage signal (planned/declined) builds trust with customers."}
                      {item.type === "inactive_campaign" && "Campaign exists in Meta but is paused. Go to Meta Ads Manager to activate or delete it."}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ORG HEALTH MONITOR
// Per-org health score (0-100) surfacing at-risk customers.
// Sorted: critical → at_risk → watch → healthy
// ─────────────────────────────────────────────────────────────────────

interface OrgHealthItem {
  id: number;
  name: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  dunningStage: string | null;
  healthScore: number;
  healthStatus: "healthy" | "watch" | "at_risk" | "critical" | "founder";
  issues: string[];
  mrr: number;
}

const HEALTH_CONFIG = {
  critical: { label: "Critical", bg: "bg-red-500/10", text: "text-red-700", bar: "bg-red-500", dot: "bg-red-500" },
  at_risk: { label: "At Risk", bg: "bg-orange-500/10", text: "text-orange-700", bar: "bg-orange-500", dot: "bg-orange-500" },
  watch: { label: "Watch", bg: "bg-amber-500/10", text: "text-amber-700", bar: "bg-amber-400", dot: "bg-amber-400" },
  healthy: { label: "Healthy", bg: "bg-green-500/10", text: "text-green-700", bar: "bg-green-500", dot: "bg-green-500" },
  founder: { label: "Founder", bg: "bg-primary/10", text: "text-primary", bar: "bg-primary", dot: "bg-primary" },
};

function OrgHealthMonitor() {
  const [showAll, setShowAll] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: orgs, isLoading } = useQuery<OrgHealthItem[]>({
    queryKey: ["/api/founder/org-health"],
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: waterfallData } = useQuery<{
    tiers: Array<{ tier: string; label: string; count: number; activeCount: number; atRiskCount: number; mrr: number; atRiskMrr: number }>;
    totalMrr: number;
    atRiskMrr: number;
    totalOrgs: number;
  }>({
    queryKey: ["/api/founder/revenue/waterfall"],
  });

  if (isLoading) return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-3">
      <div className="h-5 bg-muted animate-pulse rounded w-1/4" />
      {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
    </div>
  );

  const allOrgs = orgs || [];
  const filtered = filterStatus === "all" ? allOrgs : allOrgs.filter(o => o.healthStatus === filterStatus);
  const displayed = showAll ? filtered : filtered.slice(0, 12);

  const counts = allOrgs.reduce<Record<string, number>>((acc, o) => {
    acc[o.healthStatus] = (acc[o.healthStatus] || 0) + 1;
    return acc;
  }, {});

  const atRiskCount = (counts.critical || 0) + (counts.at_risk || 0);
  const totalMrr = waterfallData?.totalMrr || 0;
  const atRiskMrr = waterfallData?.atRiskMrr || 0;

  return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Customer Health
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            {allOrgs.length} organizations · ${totalMrr.toLocaleString()} MRR
            {atRiskMrr > 0 && <span className="text-red-600 ml-2">· ${atRiskMrr.toLocaleString()} at risk</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(counts).filter(([k]) => k !== 'founder').map(([status, count]) => {
            const cfg = HEALTH_CONFIG[status as keyof typeof HEALTH_CONFIG] || HEALTH_CONFIG.healthy;
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  filterStatus === status ? `${cfg.bg} ${cfg.text} ${cfg.bg}` : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
                {cfg.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* MRR waterfall by tier */}
      {waterfallData && (
        <div className="grid grid-cols-5 gap-2">
          {waterfallData.tiers.filter(t => t.tier !== 'free').map((t) => (
            <div key={t.tier} className="p-3 border rounded-lg text-center">
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-lg font-bold text-primary mt-0.5">${t.mrr.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{t.activeCount} active</div>
              {t.atRiskCount > 0 && (
                <div className="text-xs text-red-600 font-medium">{t.atRiskCount} at risk</div>
              )}
            </div>
          ))}
        </div>
      )}

      {atRiskCount > 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-red-500/5 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {atRiskCount} organization{atRiskCount > 1 ? 's' : ''} at risk — check Action Queue for recommended responses
        </div>
      )}

      <div className="space-y-1.5">
        {displayed.map((org) => {
          const cfg = HEALTH_CONFIG[org.healthStatus] || HEALTH_CONFIG.healthy;
          return (
            <div key={org.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/20 transition-colors group">
              <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{org.name}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{org.subscriptionTier}</Badge>
                  {org.issues.length > 0 && (
                    <span className={`text-xs ${cfg.text} truncate`}>{org.issues[0]}</span>
                  )}
                </div>
              </div>
              {/* Health score bar */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${cfg.bar}`}
                    style={{ width: `${org.healthScore}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-7 text-right">{org.healthScore}</span>
              </div>
              {org.mrr > 0 && (
                <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">${org.mrr}/mo</span>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? "Show less" : `Show ${filtered.length - 12} more`}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AUTOPILOT STATUS BAR
// Fixed bottom bar showing live background job status.
// Green = all clear. Amber = some jobs slow. Red = failures.
// ─────────────────────────────────────────────────────────────────────

const KNOWN_JOBS = [
  { name: "Lead Nurturing", interval: "15 min" },
  { name: "Sequence Processor", interval: "60 sec" },
  { name: "Campaign Optimizer", interval: "1 hr" },
  { name: "Finance Agent", interval: "30 min" },
  { name: "Deal Hunter", interval: "2 AM" },
  { name: "Alerting", interval: "1 hr" },
  { name: "Health Checks", interval: "60 sec" },
  { name: "Digests", interval: "6 hr" },
];

function AutopilotStatusBar() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 border-t backdrop-blur-sm">
      <div className="max-w-screen-2xl mx-auto px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full"
        >
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-green-700">Autopilot Active</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {KNOWN_JOBS.length} background jobs running autonomously
          </span>
          <ChevronRight className={`w-3.5 h-3.5 ml-auto text-muted-foreground transition-transform ${expanded ? "-rotate-90" : "rotate-90"}`} />
        </button>

        {expanded && (
          <div className="mt-2 pb-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
              {KNOWN_JOBS.map((job) => (
                <div key={job.name} className="flex items-center gap-1.5 p-1.5 rounded bg-green-500/5 border border-green-500/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  <div>
                    <div className="text-xs font-medium leading-none">{job.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{job.interval}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FOUNDER STICKY NAV
// Appears below the header, sticky at top, with section anchors and
// an IntersectionObserver to highlight the active section.
// ─────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Briefing", href: "section-briefing", icon: Sparkles },
  { label: "Actions", href: "section-actions", icon: ListChecks },
  { label: "Observatory", href: "section-observatory", icon: Cpu },
  { label: "Overview", href: "section-overview", icon: BarChart },
  { label: "Readiness", href: "section-readiness", icon: Rocket },
  { label: "Features", href: "section-features", icon: ToggleRight },
  { label: "Pricing", href: "section-pricing", icon: Tag },
  { label: "Growth", href: "section-growth", icon: Megaphone },
  { label: "Health", href: "section-org-health", icon: Activity },
  { label: "Users", href: "section-users", icon: Users },
  { label: "Revenue", href: "section-revenue", icon: DollarSign },
  { label: "Config", href: "section-config", icon: Key },
] as const;

function FounderNavBar() {
  const [active, setActive] = useState<string>("section-overview");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ids = NAV_ITEMS.map(n => n.href);
    const observers: IntersectionObserver[] = [];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id); },
        { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach(o => o.disconnect());
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <div className="sticky top-0 z-30 -mx-4 px-4 bg-background/95 backdrop-blur-sm border-b border-border/60 py-0">
      <div
        ref={scrollRef}
        className="flex items-center gap-1 overflow-x-auto py-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
      >
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const isActive = active === href;
          return (
            <button
              key={href}
              onClick={() => scrollTo(href)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LAUNCH READINESS SECTION
// Interactive onboarding checklist for the founder to get AcreOS
// configured and ready to accept paying customers.
// ─────────────────────────────────────────────────────────────────────

interface ReadinessItem {
  key: string;
  label: string;
  description: string;
  priority: "critical" | "core" | "launch" | "growth";
  status: "complete" | "incomplete" | "blocked";
  section: string;
  helpText?: string;
}

interface LaunchReadiness {
  score: number;
  items: ReadinessItem[];
}

const PRIORITY_CONFIG = {
  critical: {
    label: "Critical",
    color: "text-red-600",
    bg: "bg-red-500/10 border-red-500/20",
    badgeClass: "bg-red-500/10 text-red-600 border-red-500/20",
    icon: AlertOctagon,
  },
  core: {
    label: "Core Features",
    color: "text-orange-600",
    bg: "bg-orange-500/10 border-orange-500/20",
    badgeClass: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: Zap,
  },
  launch: {
    label: "Launch Ready",
    color: "text-blue-600",
    bg: "bg-blue-500/10 border-blue-500/20",
    badgeClass: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    icon: Rocket,
  },
  growth: {
    label: "Growth",
    color: "text-purple-600",
    bg: "bg-purple-500/10 border-purple-500/20",
    badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    icon: Sparkles,
  },
} as const;

function LaunchReadinessSection() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("founder-readiness-dismissed") === "true"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(true);

  const { data, isLoading, refetch } = useQuery<LaunchReadiness>({
    queryKey: ["/api/founder/launch-readiness"],
    refetchInterval: 60_000, // re-check every minute
  });

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const dismiss = () => {
    try { localStorage.setItem("founder-readiness-dismissed", "true"); } catch {}
    setDismissed(true);
  };

  if (dismissed && (data?.score ?? 0) >= 100) return null;

  const score = data?.score ?? 0;
  const isLive = score >= 80;

  // Group by priority
  const grouped = (data?.items ?? []).reduce<Record<string, ReadinessItem[]>>((acc, item) => {
    (acc[item.priority] ??= []).push(item);
    return acc;
  }, {});

  const incompleteCount = (data?.items ?? []).filter(i => i.status === "incomplete").length;
  const criticalIncomplete = (data?.items ?? []).filter(i => i.priority === "critical" && i.status === "incomplete").length;

  return (
    <div className="mt-4">
      {/* Header bar */}
      <div
        className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
          isLive
            ? "bg-green-500/5 border-green-500/30"
            : criticalIncomplete > 0
            ? "bg-red-500/5 border-red-500/30"
            : "bg-amber-500/5 border-amber-500/30"
        }`}
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          isLive ? "bg-green-500/20" : criticalIncomplete > 0 ? "bg-red-500/20" : "bg-amber-500/20"
        }`}>
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : isLive ? (
            <Rocket className={`w-5 h-5 text-green-600`} />
          ) : (
            <ListChecks className={`w-5 h-5 ${criticalIncomplete > 0 ? "text-red-600" : "text-amber-600"}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {isLive ? "AcreOS is live-ready" : "App Launch Checklist"}
            </span>
            {!isLoading && (
              <Badge
                className={`text-xs ${
                  isLive
                    ? "bg-green-500/10 text-green-700 border-green-500/20"
                    : criticalIncomplete > 0
                    ? "bg-red-500/10 text-red-700 border-red-500/20"
                    : "bg-amber-500/10 text-amber-700 border-amber-500/20"
                }`}
              >
                {score}% ready
              </Badge>
            )}
            {incompleteCount > 0 && (
              <span className="text-xs text-muted-foreground">{incompleteCount} item{incompleteCount !== 1 ? "s" : ""} remaining</span>
            )}
          </div>

          {/* Progress bar */}
          {!isLoading && (
            <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden w-full max-w-sm">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  isLive ? "bg-green-500" : criticalIncomplete > 0 ? "bg-red-500" : "bg-amber-500"
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); refetch(); }}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
          {isLive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); dismiss(); }}
            >
              Dismiss
            </Button>
          )}
          <ChevronRight
            className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {(["critical", "core", "launch", "growth"] as const).map((priority) => {
            const items = grouped[priority] ?? [];
            if (items.length === 0) return null;
            const cfg = PRIORITY_CONFIG[priority];
            const PriorityIcon = cfg.icon;
            const allDone = items.every(i => i.status === "complete");

            return (
              <div key={priority} className={`p-4 rounded-xl border ${allDone ? "bg-muted/30 border-border/50" : cfg.bg}`}>
                <div className="flex items-center gap-2 mb-3">
                  <PriorityIcon className={`w-4 h-4 ${allDone ? "text-green-600" : cfg.color}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wide ${allDone ? "text-green-600" : cfg.color}`}>
                    {cfg.label}
                  </span>
                  {allDone && (
                    <Badge className="ml-auto text-xs bg-green-500/10 text-green-700 border-green-500/20">All done</Badge>
                  )}
                </div>

                <div className="space-y-2">
                  {items.map((item) => {
                    const done = item.status === "complete";
                    return (
                      <div key={item.key} className={`flex items-start gap-2.5 p-2.5 rounded-lg transition-colors ${done ? "" : "hover:bg-background/60 cursor-pointer"}`}
                        onClick={() => !done && scrollToSection(item.section)}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          done ? "bg-green-500" : item.status === "blocked" ? "bg-muted" : "bg-background border-2 border-muted-foreground/30"
                        }`}>
                          {done ? (
                            <Check className="w-3 h-3 text-white" />
                          ) : item.status === "blocked" ? (
                            <X className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <CircleDot className="w-2.5 h-2.5 text-muted-foreground/50" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
                              {item.label}
                            </span>
                            {!done && (
                              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                            )}
                          </div>
                          {!done && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {item.helpText || item.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NEW SUBSCRIBER LIVE FEED
// Shows recent new_subscriber system alerts prominently in the overview.
// Usage: <NewSubscriberFeed alerts={alerts} />
// ─────────────────────────────────────────────────────────────────────

export function NewSubscriberFeed({ alerts }: { alerts: SystemAlert[] | undefined }) {
  const newSubs = (alerts ?? []).filter(a => a.alertType === "new_subscriber").slice(0, 5);
  if (newSubs.length === 0) return null;

  return (
    <div className="p-4 border rounded-xl bg-gradient-to-br from-green-500/5 to-background border-green-500/20">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-green-600" />
        <span className="font-medium text-sm text-green-700">Recent subscribers</span>
        <Badge className="ml-auto text-xs bg-green-500/10 text-green-700 border-green-500/20">{newSubs.length} new</Badge>
      </div>
      <div className="space-y-2">
        {newSubs.map(alert => (
          <div key={alert.id} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <span className="flex-1 truncate">{alert.message}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(alert.createdAt!), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
