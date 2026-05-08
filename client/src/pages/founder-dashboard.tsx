import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
import { Label } from "@/components/ui/label";
import { SystemHealth } from "@/components/system-health";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
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
  Sparkles,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Keyboard,
  Target,
  Flame,
  CalendarDays,
  SendHorizonal,
  ToggleLeft,
  ToggleRight,
  Tag,
  Percent,
  Radio,
  Megaphone,
  MousePointerClick,
  BarChart,
  Pause,
  TrendingUp as TrendingUpIcon,
  ChevronRight,
  Rocket,
  AlertOctagon,
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
  CalendarCheck,
  Plug,
} from "lucide-react";
import { format } from "date-fns";
import { relative, usd } from "@/lib/format";
import {
  ThePulse, DecisionsInbox, JobQueueHealth, BusinessIntelligence,
  MRRTrajectory, ChurnIntelligence, GrowthEngine, PlatformPassiveScore,
} from "@/components/dashboard";
import { FounderSetupWizard, SetupReadinessBanner } from "@/components/founder-setup-wizard";
import { Suspense } from "react";

// v3 Sovereign Company Protocol — Apple-grade CEO experience
import { MorningBriefing } from "@/components/founder/MorningBriefing";
import { SwipeDecisionCard } from "@/components/founder/SwipeDecisionCard";
import { AgentTeamChat } from "@/components/founder/AgentTeamChat";
import ActivityTimeline from "@/components/founder/ActivityTimeline";
import TrendCards from "@/components/founder/TrendCards";
import { MonthlyCheckin } from "@/components/monthly-checkin";
import OnboardingWalkthrough from "@/components/founder/OnboardingWalkthrough";
import ForecastPanel from "@/components/founder/ForecastPanel";
import CustomerHealthPanel from "@/components/founder/CustomerHealthPanel";
import OutcomeFeedback from "@/components/founder/OutcomeFeedback";
import DelegationManager from "@/components/founder/DelegationManager";
// Phase 8 Mo 12 — Beatriz §3 (code-splitting).
// The v6/v7/v8 panels are only mounted when their tab is active. Each one
// pulls a small constellation of charts / framer-motion / its own data
// hooks into the founder-dashboard chunk. Converting them to React.lazy
// reclaims ~80 KB of inert JS from the founder-dashboard entry chunk.
//
// FocusCard stays eager — it renders on the default Overview tab so it
// would just defer the very first paint by one round-trip.
import { FocusCard } from "@/components/founder/FocusCard";
const WorkflowMonitor      = React.lazy(() => import("@/components/founder/WorkflowMonitor").then(m => ({ default: m.WorkflowMonitor })));
const WarRoom              = React.lazy(() => import("@/components/founder/WarRoom").then(m => ({ default: m.WarRoom })));
const InitiativeBoard      = React.lazy(() => import("@/components/founder/InitiativeBoard").then(m => ({ default: m.InitiativeBoard })));
const PerformanceReviews   = React.lazy(() => import("@/components/founder/PerformanceReviews").then(m => ({ default: m.PerformanceReviews })));
const DecisionQuality      = React.lazy(() => import("@/components/founder/DecisionQuality").then(m => ({ default: m.DecisionQuality })));
const PlaybookManager      = React.lazy(() => import("@/components/founder/PlaybookManager").then(m => ({ default: m.PlaybookManager })));
const AbsenceMode          = React.lazy(() => import("@/components/founder/AbsenceMode").then(m => ({ default: m.AbsenceMode })));
const DecisionAutopilot    = React.lazy(() => import("@/components/founder/DecisionAutopilot").then(m => ({ default: m.DecisionAutopilot })));
const ScenarioEngine       = React.lazy(() => import("@/components/founder/ScenarioEngine").then(m => ({ default: m.ScenarioEngine })));
const AgentGrowth          = React.lazy(() => import("@/components/founder/AgentGrowth").then(m => ({ default: m.AgentGrowth })));
const FounderTwin          = React.lazy(() => import("@/components/founder/FounderTwin").then(m => ({ default: m.FounderTwin })));
const InstitutionalMemory  = React.lazy(() => import("@/components/founder/InstitutionalMemory").then(m => ({ default: m.InstitutionalMemory })));
const StrategicCompass     = React.lazy(() => import("@/components/founder/StrategicCompass").then(m => ({ default: m.StrategicCompass })));
const AgentDebatePanel     = React.lazy(() => import("@/components/founder/AgentDebatePanel").then(m => ({ default: m.AgentDebatePanel })));
const FounderWellbeingCard = React.lazy(() => import("@/components/founder/FounderWellbeingCard").then(m => ({ default: m.FounderWellbeingCard })));
const SynergyMap           = React.lazy(() => import("@/components/founder/SynergyMap").then(m => ({ default: m.SynergyMap })));
const CompanyChronicle     = React.lazy(() => import("@/components/founder/CompanyChronicle").then(m => ({ default: m.CompanyChronicle })));
import { trustLabel, trustBadgeColor } from "@/lib/trust-language";
import { GlossaryTerm } from "@/components/Glossary";

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
    case 'under_review': return 'bg-acr-accent/10 text-acr-accent border-acr-accent/20';
    case 'planned': return 'bg-acr-brand/10 text-acr-brand border-acr-brand/20';
    case 'in_progress': return 'bg-acr-warn/10 text-acr-warn border-acr-warn/20';
    case 'completed': return 'bg-acr-pos/10 text-acr-pos border-acr-pos/20';
    case 'declined': return 'bg-acr-neg/10 text-acr-neg border-acr-neg/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function getPriorityBadgeColor(priority: string | null) {
  switch (priority) {
    case 'high': return 'bg-acr-neg/10 text-acr-neg border-acr-neg/20';
    case 'medium': return 'bg-acr-warn/10 text-acr-warn border-acr-warn/20';
    case 'low': return 'bg-acr-pos/10 text-acr-pos border-acr-pos/20';
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

interface GreetingHeaderProps {
  onRefresh: () => void;
  onGenerateDigest: () => void;
  digestPending: boolean;
  onShowShortcuts: () => void;
  onOpenSetup: () => void;
  lastRefreshed: Date;
}

// v3: Swipeable decisions section using the new SwipeDecisionCard
function SwipeDecisionsSection() {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: any[]; totalPending: number }>({
    queryKey: ["/api/founder/intelligence/decisions-inbox"],
    refetchInterval: 5 * 60_000, // 5 min — use manual refresh for urgency
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Decisions ({items.length})
        </h2>
        <span className="text-xs text-muted-foreground">Swipe or tap to decide</span>
      </div>
      <div className="space-y-3">
        {items.slice(0, 5).map(item => (
          <SwipeDecisionCard
            key={item.id}
            item={item}
            onAction={() => qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] })}
          />
        ))}
      </div>
    </div>
  );
}

function GreetingHeader({ onRefresh, onGenerateDigest, digestPending, onShowShortcuts, onOpenSetup, lastRefreshed }: GreetingHeaderProps) {
  const { user: authUser } = useAuth();
  const founderName = authUser?.firstName || "Founder";
  const { data: pulseData } = useQuery<{ pulseStatus: { allClear: boolean; revenueHealth: { green: boolean }; systemHealth: { green: boolean }; churnRisk: { green: boolean } } }>({
    queryKey: ["/api/founder/intelligence/pulse"],
    staleTime: 30000,
  });

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5 ? "Still up?" :
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" :
    "Good evening";

  const pulse = pulseData?.pulseStatus;
  const allSystemsGreen = pulse?.allClear;
  const hasIssues = pulse && (!pulse.revenueHealth?.green || !pulse.systemHealth?.green || !pulse.churnRisk?.green);

  const healthColor = !pulse
    ? "text-muted-foreground"
    : allSystemsGreen
    ? "text-acr-pos"
    : hasIssues
    ? "text-acr-warn"
    : "text-acr-pos";

  const healthLabel = !pulse
    ? "Checking..."
    : allSystemsGreen
    ? "All systems healthy"
    : "Needs attention";

  const healthDot = !pulse
    ? "bg-muted-foreground"
    : allSystemsGreen
    ? "bg-acr-pos animate-pulse"
    : "bg-acr-warn animate-pulse";

  return (
    <div className="rounded-xl border bg-gradient-to-r from-card to-card/80 px-5 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Greeting + Status */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-acr-warn" />
            <h1 className="text-xl font-bold tracking-tight text-foreground" data-testid="text-founder-dashboard-title">
              {greeting}, {founderName}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${healthDot}`} />
              <span className={`text-sm font-medium ${healthColor}`}>{healthLabel}</span>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">·</span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground hidden sm:flex">
              <CalendarDays className="h-3 w-3" />
              {format(now, "EEEE, MMMM d")}
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">·</span>
            <span className="text-xs text-muted-foreground hidden sm:block">
              Refreshed {relative(lastRefreshed)}
            </span>
          </div>
        </div>

        {/* Right: Quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
            <kbd className="hidden sm:inline-block ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">R</kbd>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={onGenerateDigest}
            disabled={digestPending}
          >
            {digestPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizonal className="h-3.5 w-3.5" />
            )}
            {digestPending ? "Sending..." : "Email Digest"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={onOpenSetup}
          >
            <Key className="h-3.5 w-3.5" />
            Platform Setup
          </Button>
          <Button aria-label="Keyboard"
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs h-8 px-2"
            onClick={onShowShortcuts}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SophieActivityPreview() {
  const { data, isLoading } = useQuery<{ autoResolutions: any[]; count: number }>({
    queryKey: ["/api/founder/intelligence/sophie-activity"],
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: supportAnalyticsData } = useQuery<{
    totalTickets: number;
    openTickets: number;
    aiResolvedTickets: number;
    aiResolutionRate: number | string;
    averageRating: number | null;
  }>({
    queryKey: ['/api/founder/support/analytics'],
    staleTime: 60000,
  });

  const recent = data?.autoResolutions?.slice(0, 5) ?? [];
  const resolutionRate = typeof supportAnalyticsData?.aiResolutionRate === 'number'
    ? supportAnalyticsData.aiResolutionRate
    : parseFloat(String(supportAnalyticsData?.aiResolutionRate ?? "0")) || 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bot className="h-4 w-4 text-acr-accent" />
          Sophie AI Intelligence
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-acr-accent/10 text-acr-accent border-acr-accent/20">
            {data?.count ?? 0} resolved today
          </Badge>
          {resolutionRate > 0 && (
            <Badge variant="outline" className={`text-xs ${resolutionRate >= 70 ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' : 'bg-acr-warn/10 text-acr-warn border-acr-warn/20'}`}>
              {resolutionRate.toFixed(0)}% auto-rate
            </Badge>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {supportAnalyticsData && (
        <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{supportAnalyticsData.totalTickets}</p>
            <p className="text-xs text-muted-foreground">Total tickets</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-acr-pos">{supportAnalyticsData.aiResolvedTickets}</p>
            <p className="text-xs text-muted-foreground">AI resolved</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-acr-warn">{supportAnalyticsData.openTickets}</p>
            <p className="text-xs text-muted-foreground">Still open</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2 animate-pulse" role="status" aria-busy="true" aria-label="Loading auto-resolutions">
          {[0,1,2].map(i => <div key={i} className="h-7 bg-muted rounded" />)}
          <span className="sr-only">Loading…</span>
        </div>
      ) : recent.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No autonomous resolutions in the last 24 hours.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent auto-resolutions</p>
          {recent.map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 text-xs py-0.5">
              <CheckCircle2 className="h-3 w-3 text-acr-pos shrink-0" />
              <span className="text-foreground truncate flex-1">{t.subject ?? `Ticket #${t.id}`}</span>
              <span className="text-muted-foreground shrink-0 text-[11px]">
                {t.resolvedAt ? relative(t.resolvedAt) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// AUTONOMOUS OBSERVATORY COMPONENTS
// ─────────────────────────────────────────────

// Per-job display tone is sourced from the consolidated identity registry —
// see client/src/lib/agent-identity.ts. One semantic palette for both
// agents and jobs prevents the dashboard from drifting back to hardcoded
// hexes every time a new job lands.
import { jobBgClass, agentTextClass } from "@/lib/agent-identity";

function jobColor(jobName: string) {
  return jobBgClass(jobName);
}

function JobStatusDot({ status }: { status: string }) {
  if (status === "healthy")  return <CircleCheck className="w-4 h-4 text-acr-pos shrink-0" />;
  if (status === "degraded") return <CircleDotIcon className="w-4 h-4 text-acr-warn shrink-0" />;
  if (status === "failed")   return <CircleX className="w-4 h-4 text-acr-neg shrink-0" />;
  return <Minus className="w-4 h-4 text-muted-foreground shrink-0" />;
}

/** Live System Activity Stream */
function SystemActivityPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/system-activity"],
    queryFn: () => apiRequest("GET", "/api/admin/system-activity?hours=48&limit=80").then(r => r.json()),
    refetchInterval: 5 * 60_000,
  });

  const rows: any[] = data?.rows ?? [];

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-acr-pos" />
            System Activity Stream
          </CardTitle>
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">Last 48h · auto-refreshes every 30s</span>
            <Button aria-label="Refresh" variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
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
                    {relative(row.createdAt)}
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
    refetchInterval: 5 * 60_000,
  });

  const jobs: any[] = data?.jobs ?? [];
  const summary = data?.summary ?? { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
  const hasIssues = summary.failed > 0 || summary.degraded > 0;

  return (
    <Card className={hasIssues ? "border-acr-neg dark:border-acr-neg/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-acr-accent" />
            Background Job Health
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasIssues && <Badge variant="destructive" className="text-xs">Issues Detected</Badge>}
            <Button aria-label="Refresh" variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="text-acr-pos font-medium">{summary.healthy} healthy</span>
          {summary.degraded > 0 && <span className="text-acr-warn font-medium">{summary.degraded} degraded</span>}
          {summary.failed > 0 && <span className="text-acr-neg font-medium">{summary.failed} failed</span>}
          {summary.unknown > 0 && <span>{summary.unknown} not yet run</span>}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading scheduled jobs">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            <span className="sr-only">Loading…</span>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {jobs.map((job: any) => (
              <div key={job.name} className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
                <JobStatusDot status={job.status} />
                <span className="text-sm font-mono flex-1 truncate">{job.name.replace(/_/g, " ")}</span>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {job.lastRunAt ? (
                    <span>{relative(job.lastRunAt)}</span>
                  ) : (
                    <span className="italic">not yet run</span>
                  )}
                  {job.consecutiveFailures > 0 && (
                    <span className="ml-2 text-acr-neg font-medium">{job.consecutiveFailures} fails</span>
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


/** Pax's Eyes — observations and cross-org learnings */
const ACTION_LABELS: Record<string, string> = {
  proactive_outreach: "Re-engage",
  draft_outreach_message: "Re-engage",
  upgrade_plan: "Send Upgrade Email",
  get_deals: "Hunt Deals",
  monitor: "Acknowledge",
  wait_and_retry: "Acknowledge",
  review_data: "Acknowledge",
};

function PaxEyesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/pax-observations"],
    queryFn: () => apiRequest("GET", "/api/admin/pax-observations?limit=25").then(r => r.json()),
    refetchInterval: 10 * 60_000,
  });

  const executeMutation = useMutation({
    mutationFn: (obsId: number) =>
      apiRequest("POST", `/api/admin/pax-observations/${obsId}/execute`).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pax-observations"] });
      toast({ title: "Action executed", description: data.actionTaken?.replace(/_/g, " ") });
    },
    onError: () => toast({ title: "Couldn't execute action", description: "No changes were made. Try again or check the system status.", variant: "destructive" }),
  });

  const observations: any[] = data?.observations ?? [];
  const learnings: any[] = data?.learnings ?? [];

  const confidenceBadge = (score: number) => {
    const pct = score > 1 ? score : score * 100;
    if (pct >= 80) return <Badge className="text-xs bg-acr-pos/10 text-acr-pos dark:text-acr-pos border-acr-pos/20">High</Badge>;
    if (pct >= 50) return <Badge className="text-xs bg-acr-warn/10 text-acr-warn dark:text-acr-warn border-acr-warn/20">Medium</Badge>;
    return <Badge className="text-xs bg-muted text-muted-foreground border-border">Low</Badge>;
  };

  const severityColor = (s: string) => {
    if (s === "high") return "text-acr-neg dark:text-acr-neg";
    if (s === "medium") return "text-acr-warn dark:text-acr-warn";
    return "text-acr-brand";
  };

  return (
    <Card className="col-span-full md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-acr-brand" />
          Pax's Eyes
        </CardTitle>
        <CardDescription className="text-xs">What Pax has observed and learned across all organizations</CardDescription>
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
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {observations.map((obs: any) => (
                <div key={obs.id} className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
                  <Eye className={`w-3.5 h-3.5 mt-1 shrink-0 ${severityColor(obs.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug line-clamp-2">{obs.content}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {obs.orgName && <span className="text-xs text-muted-foreground">{obs.orgName}</span>}
                      {obs.confidence != null && confidenceBadge(Number(obs.confidence))}
                      <span className="text-xs text-muted-foreground">
                        {relative(obs.createdAt)}
                      </span>
                    </div>
                  </div>
                  {obs.suggestedAction && obs.suggestedAction !== "monitor" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0 gap-1"
                      disabled={executeMutation.isPending}
                      onClick={() => executeMutation.mutate(obs.id)}
                    >
                      <Zap className="w-3 h-3" />
                      {ACTION_LABELS[obs.suggestedAction] ?? "Execute"}
                    </Button>
                  )}
                  {(!obs.suggestedAction || obs.suggestedAction === "monitor") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs shrink-0 text-muted-foreground"
                      disabled={executeMutation.isPending}
                      onClick={() => executeMutation.mutate(obs.id)}
                    >
                      Dismiss
                    </Button>
                  )}
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
                  <Sparkles className="w-3.5 h-3.5 mt-1 text-acr-warn shrink-0" />
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
      toast({ title: "Couldn't send briefing", description: "No email was sent. Try again or check the system status.", variant: "destructive" });
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

type DashboardTab = "overview" | "agents" | "operations" | "growth" | "infrastructure";

const DASHBOARD_TABS: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Crown className="w-4 h-4" /> },
  { id: "agents", label: "Agents & AI", icon: <Bot className="w-4 h-4" /> },
  { id: "operations", label: "Operations", icon: <Activity className="w-4 h-4" /> },
  { id: "growth", label: "Growth", icon: <TrendingUp className="w-4 h-4" /> },
  { id: "infrastructure", label: "Infrastructure", icon: <Server className="w-4 h-4" /> },
];

export default function FounderDashboard() {
  useDocumentTitle("Founder dashboard");
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    try { return (localStorage.getItem("founder_dashboard_tab") as DashboardTab) || "overview"; } catch { return "overview"; }
  });
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  // focusMode removed 2026-05-01 (Wave G3) — the F key toggled a banner
  // and toast saying "showing only critical sections" but no actual
  // filtering ever ran. Honest fix: remove the affordance rather than
  // ship a placebo. If section-filtering returns, design which sections
  // are "critical" first, then re-add.
  const [goalCents, setGoalCents] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("founder_mrr_goal_cents") || "0", 10) || 0; } catch { return 0; }
  });
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalInputValue, setGoalInputValue] = useState("");
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const briefingRef = useRef<HTMLDivElement>(null);

  const handleTabChange = useCallback((tab: DashboardTab) => {
    setActiveTab(tab);
    try { localStorage.setItem("founder_dashboard_tab", tab); } catch {}
  }, []);

  const handleRefreshAll = useCallback(() => {
    queryClient.invalidateQueries();
    setLastRefreshed(new Date());
    toast({ title: "All data refreshed" });
  }, [toast]);

  const handleSaveGoal = useCallback(() => {
    const dollars = parseFloat(goalInputValue.replace(/[^0-9.]/g, ""));
    if (!isNaN(dollars) && dollars >= 0) {
      const cents = Math.round(dollars * 100);
      setGoalCents(cents);
      try { localStorage.setItem("founder_mrr_goal_cents", String(cents)); } catch {}
      setGoalDialogOpen(false);
      setGoalInputValue("");
      toast({ title: "MRR goal saved", description: `Target: ${usd(dollars, { noCents: Number.isInteger(dollars) })}/mo` });
    }
  }, [goalInputValue, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r") {
        handleRefreshAll();
      } else if (e.key === "?") {
        setShowShortcuts(prev => !prev);
      } else if (e.key === "g") {
        setGoalDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRefreshAll]);

  // Only load dashboard data for overview + growth tabs.
  // Cycle 11: the /api/admin/dashboard endpoint returns a flatter shape
  // than the client's AdminDashboardData interface expects. Normalize
  // missing sections to safe defaults so the UI can render even when the
  // server hasn't populated every KPI.
  const { data: dashboardData, isLoading } = useQuery<AdminDashboardData>({
    queryKey: ['/api/admin/dashboard'],
    enabled: activeTab === "overview" || activeTab === "growth",
    select: (raw: any) => {
      const r = raw ?? {};
      const agentDefault = { lastRun: null, processed: 0, pending: 0, failed: 0, status: "idle" };
      return {
        revenue: {
          mrr: r?.revenue?.mrr ?? 0,
          creditSalesThisMonth: r?.revenue?.creditSalesThisMonth ?? 0,
          totalRevenueThisMonth: r?.revenue?.totalRevenueThisMonth ?? r?.revenue?.mrr ?? 0,
          mrrAtRisk: r?.revenue?.mrrAtRisk ?? r?.revenueAtRisk?.totalMrrAtRisk ?? 0,
        },
        systemHealth: {
          activeOrganizations: r?.systemHealth?.activeOrganizations ?? r?.revenue?.customers ?? 0,
          totalUsers: r?.systemHealth?.totalUsers ?? r?.users?.total ?? 0,
          activeUsers: r?.systemHealth?.activeUsers ?? r?.users?.active ?? 0,
          uptime: r?.systemHealth?.uptime ?? r?.system?.uptime ?? 0,
        },
        agents: {
          leadNurturer: r?.agents?.leadNurturer ?? agentDefault,
          campaignOptimizer: r?.agents?.campaignOptimizer ?? agentDefault,
          financeAgent: r?.agents?.financeAgent ?? agentDefault,
          apiQueue: r?.agents?.apiQueue ?? { pending: 0, failed: 0 },
        },
        alerts: {
          bySeverity: r?.alerts?.bySeverity ?? {},
          total: Array.isArray(r?.alerts) ? r.alerts.length : (r?.alerts?.total ?? 0),
          critical: Array.isArray(r?.alerts?.critical) ? r.alerts.critical : [],
        },
        revenueAtRisk: {
          dunningByStage: r?.revenueAtRisk?.dunningByStage ?? {},
          totalMrrAtRisk: r?.revenueAtRisk?.totalMrrAtRisk ?? 0,
          orgsApproachingCreditExhaustion: r?.revenueAtRisk?.orgsApproachingCreditExhaustion ?? 0,
        },
        userActivity: {
          activeUsers: r?.userActivity?.activeUsers ?? r?.users?.active ?? 0,
          newSignupsThisWeek: r?.userActivity?.newSignupsThisWeek ?? r?.users?.new ?? 0,
          organizationsByTier: r?.userActivity?.organizationsByTier ?? {},
        },
      } as AdminDashboardData;
    },
  });

  // Only poll decisions on overview tab
  const { data: decisionsInboxData } = useQuery<{ totalPending: number }>({
    queryKey: ['/api/founder/intelligence/decisions-inbox'],
    refetchInterval: activeTab === "overview" ? 5 * 60_000 : false,
    enabled: activeTab === "overview" || activeTab === "infrastructure",
  });

  const { data: alerts } = useQuery<SystemAlert[]>({
    queryKey: ['/api/admin/alerts'],
    enabled: activeTab === "overview" || activeTab === "infrastructure",
  });

  const { data: apiUsageData } = useQuery<ApiUsageStats>({
    queryKey: ['/api/founder/api-usage'],
    enabled: activeTab === "overview" || activeTab === "growth",
  });

  const { data: featureRequests, isLoading: featureRequestsLoading } = useQuery<FeatureRequest[]>({
    queryKey: ['/api/founder/feature-requests'],
    enabled: activeTab === "operations",
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
    enabled: activeTab === "operations",
  });

  const { data: escalations, isLoading: escalationsLoading } = useQuery<EscalatedTicket[]>({
    queryKey: ['/api/founder/escalations'],
    enabled: activeTab === "operations",
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the text and copy manually.", variant: "destructive" });
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Alerts acknowledged", description: data.message || "All alerts acknowledged." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Alerts resolved", description: data.message || "All alerts resolved." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
    },
  });

  const digestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/digest/generate", {});
      if (!res.ok) throw new Error("Failed to generate digest");
      return res.json();
    },
    onSuccess: () => toast({ title: "Daily digest sent", description: "Check your email for the founder digest" }),
    onError: (error: Error) => toast({ title: "Couldn't generate digest", description: `${error.message} — no email was sent.`, variant: "destructive" }),
  });

  const { data: countyGisEndpoints, isLoading: gisEndpointsLoading } = useQuery<CountyGisEndpoint[]>({
    queryKey: ['/api/county-gis-endpoints'],
    enabled: activeTab === "infrastructure",
  });

  const { data: dataSources, isLoading: dataSourcesLoading } = useQuery<DataSource[]>({
    queryKey: ['/api/data-sources'],
    enabled: activeTab === "infrastructure",
  });

  const { data: dataSourceStats } = useQuery<DataSourceStats>({
    queryKey: ['/api/data-sources/stats'],
    enabled: activeTab === "infrastructure",
  });

  const { data: userOrganizations, isLoading: usersLoading } = useQuery<UserOrganization[]>({
    queryKey: ['/api/admin/users'],
    enabled: activeTab === "operations" || activeTab === "growth",
  });

  const { data: subscriptionStats } = useQuery<SubscriptionStats>({
    queryKey: ['/api/admin/subscription-stats'],
    enabled: activeTab === "overview" || activeTab === "growth",
  });

  const { data: subscriptionEvents } = useQuery<SubscriptionEvent[]>({
    queryKey: ['/api/admin/subscription-events'],
    enabled: activeTab === "growth",
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't complete that action", description: `${error.message} — no changes were made.`, variant: "destructive" });
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
      toast({ title: "Couldn't test endpoint", description: `${error.message} — the endpoint's last-known status is unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't test endpoints", description: `${error.message} — endpoint statuses are unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't diagnose endpoint", description: `${error.message} — try again or test the endpoint manually.`, variant: "destructive" });
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
      toast({ title: "Couldn't scan for endpoints", description: `${error.message} — your existing endpoints are unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't add endpoints", description: `${error.message} — your existing endpoints are unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't scan ArcGIS", description: `${error.message} — discovered endpoints are unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't validate endpoint", description: `${error.message} — the endpoint's status is unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't approve endpoint", description: `${error.message} — the endpoint is still pending review.`, variant: "destructive" });
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
      toast({ title: "Couldn't reject endpoint", description: `${error.message} — the endpoint is still pending review.`, variant: "destructive" });
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
      toast({ title: "Couldn't run batch validation", description: `${error.message} — endpoint statuses are unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't test data source", description: `${error.message} — the data source's last-known status is unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't start validation", description: `${error.message} — data source statuses are unchanged.`, variant: "destructive" });
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
    onError: (err: Error) => toast({ title: "Couldn't import sources", description: `${err.message} — your existing data sources are unchanged.`, variant: "destructive" }),
  });

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-acr-pos/10 text-acr-pos border-acr-pos/20';
      case 'busy': return 'bg-acr-warn/10 text-acr-warn border-acr-warn/20';
      case 'warning': return 'bg-acr-warn/10 text-acr-warn border-acr-warn/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-acr-neg/10 text-acr-neg border-acr-neg/20';
      case 'warning': return 'bg-acr-warn/10 text-acr-warn border-acr-warn/20';
      default: return 'bg-acr-accent/10 text-acr-accent border-acr-accent/20';
    }
  };

  const getEventTypeIcon = (eventType: string) => {
    switch (eventType) {
      case 'upgrade': return <TrendingUp className="w-4 h-4 text-acr-pos" />;
      case 'downgrade': return <TrendingDown className="w-4 h-4 text-acr-warn" />;
      case 'cancel': return <AlertCircle className="w-4 h-4 text-acr-neg" />;
      case 'reactivate': return <RefreshCw className="w-4 h-4 text-acr-accent" />;
      case 'signup': return <UserPlus className="w-4 h-4 text-acr-pos" />;
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
      <PageShell label="Founder dashboard">
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
    <PageShell label="Founder dashboard">
          {/* Legacy operational dashboard banner — product-call #4. The
              prototype's daily founder experience is /founder-home, which
              ships a clean status pill + What-needs-you queue + autonomy
              health card. This page (7,400+ lines) keeps every specialized
              tab (data sources, endpoints, escalations, feature requests,
              etc) and stays available for deep-dive operations work, but
              is no longer the canonical entrypoint. The eventual rebuild
              extracts each tab into its own focused route over time. */}
          <div className="rounded-card border border-acr-warn/30 bg-acr-warn-soft px-4 py-3 mb-4 flex items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-medium text-acr-warn">Operational dashboard (legacy)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                For the daily founder check, use{" "}
                <Link href="/founder-home" className="underline underline-offset-2 font-medium hover:text-acr-warn">
                  /founder-home
                </Link>
                . This page keeps every specialized tab for operations
                work; tabs migrate to focused routes over time.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href="/founder-home">Go to founder home</Link>
            </Button>
          </div>

          {/* v4: Onboarding walkthrough (modal overlay) */}
          <OnboardingWalkthrough />

          {/* ── Keyboard shortcuts modal ─────────────────────────────── */}
          <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Keyboard className="h-4 w-4" />
                  Keyboard Shortcuts
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-1 text-sm">
                {[
                  { key: "R", desc: "Refresh all data" },
                  { key: "G", desc: "Set MRR goal" },
                  { key: "?", desc: "Toggle this panel" },
                ].map(({ key, desc }) => (
                  <div key={key} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <span className="text-muted-foreground">{desc}</span>
                    <kbd className="rounded bg-muted px-2 py-0.5 text-xs font-mono font-semibold">{key}</kbd>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {/* ── MRR Goal dialog ──────────────────────────────────────── */}
          <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-acr-warn" />
                  Set MRR Goal
                </DialogTitle>
                <DialogDescription>
                  Your goal will appear as a reference line on the revenue chart.
                </DialogDescription>
              </DialogHeader>
              <form
                id="founder-mrr-goal-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveGoal();
                }}
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    className="pl-7"
                    placeholder="e.g. 10000"
                    value={goalInputValue}
                    onChange={e => setGoalInputValue(e.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    autoComplete="off"
                    aria-label="Monthly revenue target in USD"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-muted-foreground">Enter monthly revenue target in USD</p>
              </form>
              <DialogFooter>
                {goalCents > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => {
                    setGoalCents(0);
                    try { localStorage.removeItem("founder_mrr_goal_cents"); } catch {}
                    setGoalDialogOpen(false);
                    toast({ title: "Goal cleared" });
                  }}>
                    Clear goal
                  </Button>
                )}
                <Button type="submit" form="founder-mrr-goal-form">Save goal</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ── Setup Wizard ─────────────────────────────────────────── */}
          <FounderSetupWizard open={setupWizardOpen} onClose={() => setSetupWizardOpen(false)} />

          {/* ── Greeting Header ──────────────────────────────────────── */}
          <GreetingHeader
            onRefresh={handleRefreshAll}
            onGenerateDigest={() => digestMutation.mutate()}
            digestPending={digestMutation.isPending}
            onShowShortcuts={() => setShowShortcuts(true)}
            onOpenSetup={() => setSetupWizardOpen(true)}
            lastRefreshed={lastRefreshed}
          />

          {/* ── Platform Readiness Banner ─────────────────────────────── */}
          <SetupReadinessBanner onOpenWizard={() => setSetupWizardOpen(true)} />

          {/* Tab Navigation */}
          <div role="tablist" aria-label="Founder dashboard sections" className="flex items-center gap-1 border-b mb-6 overflow-x-auto pb-px">
            {DASHBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`founder-tab-panel-${tab.id}`}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={handleRefreshAll} className="ml-2 shrink-0" aria-label="Refresh all">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* ── MRR Goal Progress (when goal is set) ─────────────────── */}
          {goalCents > 0 && dashboardData && (
            <div className="rounded-lg border bg-card px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-acr-warn" />
                  <span className="text-sm font-medium">MRR Goal Progress</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {formatCurrency(dashboardData.revenue.mrr)} / {formatCurrency(goalCents)}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setGoalInputValue(String(goalCents / 100)); setGoalDialogOpen(true); }}>
                    Edit
                  </Button>
                </div>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    dashboardData.revenue.mrr >= goalCents
                      ? "bg-acr-pos"
                      : dashboardData.revenue.mrr >= goalCents * 0.75
                      ? "bg-acr-warn"
                      : "bg-acr-accent"
                  }`}
                  style={{ width: `${Math.min(100, (dashboardData.revenue.mrr / goalCents) * 100).toFixed(1)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dashboardData.revenue.mrr >= goalCents
                  ? "🎉 Goal reached!"
                  : `${((dashboardData.revenue.mrr / goalCents) * 100).toFixed(0)}% to goal — ${formatCurrency(goalCents - dashboardData.revenue.mrr)} remaining`}
              </p>
            </div>
          )}

          {/* ═══ TAB: OVERVIEW ═══ */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div ref={briefingRef}>
                <MorningBriefing />
              </div>
              <TrendCards />
              <Suspense fallback={<div className="animate-pulse h-32 rounded-xl bg-muted" />}>
                <SwipeDecisionsSection />
              </Suspense>
              <FocusCard />
            </div>
          )}

          {/* ═══ TAB: AGENTS & AI ═══ */}
          {activeTab === "agents" && (
            <div className="space-y-6">
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Talk to Your Team
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 h-[360px]">
                  <AgentTeamChat />
                </CardContent>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Agent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                  <ActivityTimeline />
                </CardContent>
              </Card>
              <CompanyBriefingPanel />
              <AgentTeamPanel />
              <Suspense fallback={<div className="animate-pulse h-32 rounded-xl bg-muted" />}>
                <DecisionAutopilot />
                <AgentGrowth />
                <FounderTwin />
                <AgentDebatePanel />
                <PerformanceReviews />
                <SynergyMap />
                <InstitutionalMemory />
              </Suspense>
            </div>
          )}

          {/* ═══ TAB: OPERATIONS ═══ */}
          {activeTab === "operations" && (
            <div className="space-y-6">
              {/* ActionQueuePanel merged into /founder (What needs you today) (F-D #3).
                  The unified todo feed now also surfaces support escalations,
                  dunning, expiring trials, hot feature requests, and inactive
                  campaigns with `source: 'action-queue'` provenance. */}
              <Link href="/founder" className="block p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-primary" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-sm">Action queue → /founder</p>
                      <p className="text-xs text-muted-foreground">
                        Support escalations, dunning, trial conversions, hot feature requests, inactive campaigns — all merged into the unified What-needs-you-today feed.
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Open →</Badge>
                </div>
              </Link>
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    Customer Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <CustomerHealthPanel />
                </CardContent>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Decision Outcomes
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <OutcomeFeedback />
                </CardContent>
              </Card>
              <DelegationManager />
              <Suspense fallback={<div className="animate-pulse h-32 rounded-xl bg-muted" />}>
                <AbsenceMode />
                <WarRoom />
                <WorkflowMonitor />
                <InitiativeBoard />
                <PlaybookManager />
                <DecisionQuality />
                <ScenarioEngine />
                <StrategicCompass />
                <FounderWellbeingCard />
                <CompanyChronicle />
              </Suspense>
            </div>
          )}

          {/* ═══ TAB: GROWTH ═══ */}
          {activeTab === "growth" && (
            <div className="space-y-6">
              {/* MRRTrajectory moved to /founder/customers/health (F-D #4)
                  alongside ChurnRiskPanel + OrgHealthMonitor. */}
              <Link href="/founder/customers/health" className="block p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Heart className="w-5 h-5 text-primary" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-sm">Customer health → /founder/customers/health</p>
                      <p className="text-xs text-muted-foreground">MRR trajectory, churn risk, org health.</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Open →</Badge>
                </div>
              </Link>
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Financial Forecast
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ForecastPanel />
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ChurnIntelligence />
                <GrowthEngine />
              </div>
              <BusinessIntelligence />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <PlatformPassiveScore />
                <SophieActivityPreview />
              </div>
              <NewSubscriberFeed alerts={alerts} />
              <TodaysBriefing />
            </div>
          )}

          {/* ═══ TAB: INFRASTRUCTURE ═══ */}
          {activeTab === "infrastructure" && (
            <div className="space-y-6">
              {/* LaunchReadinessSection extracted to /founder/readiness (F-D #2). */}
              <Link href="/founder/readiness" className="block p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-primary" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-sm">Launch readiness checklist</p>
                      <p className="text-xs text-muted-foreground">Open the dedicated page to see incomplete items + score.</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Open →</Badge>
                </div>
              </Link>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-acr-accent" />
                      Autonomous Observatory
                    </h2>
                    <p className="text-sm text-muted-foreground">Watch the system work in real time</p>
                  </div>
                  <FounderBriefingTrigger />
                </div>
                <SystemActivityPanel />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <JobHealthPanel />
                  {/* ChurnRiskPanel moved to /founder/customers/health (F-D #4) */}
                  <PaxEyesPanel />
                </div>
              </div>
              <JobQueueHealth />
              <SystemHealth />
              {/* External Integrations link */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Plug className="w-4 h-4 text-acr-accent" />
                    External Integrations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    View status of all external API integrations and get CLI commands to configure them.
                  </p>
                  <Link href="/founder/integrations" className="text-sm text-primary hover:underline font-medium">
                    Open integrations dashboard &rarr;
                  </Link>
                </CardContent>
              </Card>
              <ThePulse decisionsInboxCount={decisionsInboxData?.totalPending} />
              <DecisionsInbox />
            </div>
          )}

          {/* ── Overview KPI Cards (visible on overview + growth tabs) ── */}
          <div id="section-overview" className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${activeTab !== "overview" && activeTab !== "growth" ? "hidden" : ""}`}>
            <Card data-testid="card-revenue-analytics">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('revenue')}
                  data-testid="title-revenue-analytics"
                >
                  <DollarSign className="w-5 h-5 text-acr-pos" />
                  Revenue Analytics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* MRR Hero Number */}
                <div className="rounded-lg bg-acr-pos/5 border border-acr-pos/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Monthly Recurring Revenue</p>
                  <p className="text-3xl font-bold text-acr-pos tracking-tight" data-testid="text-mrr">
                    {formatCurrency(dashboardData?.revenue.mrr || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <GlossaryTerm slug="ARR">ARR</GlossaryTerm>: <span className="font-semibold text-foreground">{formatCurrency((dashboardData?.revenue.mrr || 0) * 12)}</span>
                  </p>
                </div>
                <div className="space-y-2.5">
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
                {/* MRR at risk banner */}
                {(dashboardData?.revenue.mrrAtRisk || 0) > 0 && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5 text-acr-warn">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">MRR at risk</span>
                      </div>
                      <span className="text-xs font-semibold text-acr-warn">
                        {formatCurrency(dashboardData?.revenue.mrrAtRisk || 0)}
                        {dashboardData?.revenue.mrr ? (
                          <span className="text-muted-foreground font-normal ml-1">
                            ({((dashboardData.revenue.mrrAtRisk / dashboardData.revenue.mrr) * 100).toFixed(0)}% of MRR)
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                )}
                {(dashboardData?.revenue.mrrAtRisk || 0) === 0 && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-1.5 text-acr-pos text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>No MRR at risk — all accounts in good standing</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-system-health">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle 
                  className="text-lg font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setExpandedTile('health')}
                  data-testid="title-system-health"
                >
                  <Server className="w-5 h-5 text-acr-accent" />
                  System Health
                </CardTitle>
                <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
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
                  <span className="font-medium text-acr-pos" data-testid="text-uptime">
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
                  <Bot className="w-5 h-5 text-acr-brand" />
                  Agent Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Lead Nurturing</span>
                    <span className="text-xs text-muted-foreground">
                      {dashboardData?.agents.leadNurturer.lastRun 
                        ? relative(dashboardData.agents.leadNurturer.lastRun)
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
                        ? relative(dashboardData.agents.campaignOptimizer.lastRun)
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
                        ? relative(dashboardData.agents.financeAgent.lastRun)
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
                    <Badge variant="outline" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">
                      <Clock className="w-3 h-3 mr-1" />
                      {dashboardData?.agents.apiQueue.pending || 0} pending
                    </Badge>
                    {(dashboardData?.agents.apiQueue.failed || 0) > 0 && (
                      <Badge variant="outline" className="bg-acr-neg/10 text-acr-neg border-acr-neg/20">
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
                  <AlertTriangle className="w-5 h-5 text-acr-warn" />
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
                    <div key={alert.id} className="flex items-start gap-2 p-2 rounded-md bg-acr-neg/5 border border-acr-neg/20">
                      <AlertCircle className="w-4 h-4 text-acr-neg mt-0.5 flex-shrink-0" />
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
                          aria-label="Acknowledge alert"
                          data-testid={`button-acknowledge-alert-${alert.id}`}
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => resolveMutation.mutate(alert.id)}
                          aria-label="Resolve alert"
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
                  <TrendingDown className="w-5 h-5 text-acr-neg" />
                  Revenue At Risk
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total MRR At Risk</span>
                  <span className="text-lg font-bold text-acr-neg" data-testid="text-mrr-at-risk">
                    {formatCurrency(dashboardData?.revenueAtRisk.totalMrrAtRisk || 0)}
                  </span>
                </div>
                <div className="space-y-2">
                  <span className="text-sm font-medium">Organizations in Dunning</span>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(dashboardData?.revenueAtRisk.dunningByStage || {}).map(([stage, count]) => (
                      <Badge key={stage} variant="outline" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">
                        {stage.replace(/_/g, ' ')}: {count}
                      </Badge>
                    ))}
                    {Object.keys(dashboardData?.revenueAtRisk.dunningByStage || {}).length === 0 && (
                      <span className="text-sm text-muted-foreground">No organizations in dunning</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Low Credit Balance</span>
                  <Badge variant="outline" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">
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
                  <Users className="w-5 h-5 text-acr-accent" />
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
                  <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
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

            {/* Customer Momentum Card */}
            <Card data-testid="card-customer-momentum">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Flame className="w-5 h-5 text-acr-warn" />
                  Customer Momentum
                </CardTitle>
                {subscriptionStats && (
                  <Badge
                    variant="outline"
                    className={subscriptionStats.upgrades30d > subscriptionStats.downgrades30d
                      ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20'
                      : 'bg-acr-neg/10 text-acr-neg border-acr-neg/20'
                    }
                  >
                    {subscriptionStats.upgrades30d > subscriptionStats.downgrades30d ? (
                      <ArrowUp className="w-3 h-3 mr-1" />
                    ) : (
                      <ArrowDown className="w-3 h-3 mr-1" />
                    )}
                    {subscriptionStats.upgrades30d > subscriptionStats.downgrades30d ? 'Growing' : 'Watch closely'}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {subscriptionStats ? (
                  <>
                    {/* 30-day momentum grid */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-acr-pos/5 border border-acr-pos/10 px-2 py-2">
                        <p className="text-lg font-bold text-acr-pos">{subscriptionStats.upgrades30d}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">upgrades</p>
                      </div>
                      <div className="rounded-lg bg-acr-neg/5 border border-acr-neg/10 px-2 py-2">
                        <p className="text-lg font-bold text-acr-neg">{subscriptionStats.cancellations30d}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">cancels</p>
                      </div>
                      <div className="rounded-lg bg-acr-accent/5 border border-acr-accent/10 px-2 py-2">
                        <p className="text-lg font-bold text-acr-accent">{subscriptionStats.signups30d}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">new signups</p>
                      </div>
                    </div>
                    <div className="pt-1 border-t space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Downgrades (30d)</span>
                        <span className="font-medium text-acr-warn">{subscriptionStats.downgrades30d}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Reactivations (30d)</span>
                        <span className="font-medium text-acr-pos">{subscriptionStats.reactivations30d}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Net growth (30d)</span>
                        <span className={`font-semibold ${(subscriptionStats.signups30d + subscriptionStats.reactivations30d) - (subscriptionStats.cancellations30d + subscriptionStats.downgrades30d) >= 0 ? 'text-acr-pos' : 'text-acr-neg'}`}>
                          {(() => {
                            const net = (subscriptionStats.signups30d + subscriptionStats.reactivations30d) - (subscriptionStats.cancellations30d + subscriptionStats.downgrades30d);
                            return net >= 0 ? `+${net}` : `${net}`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2 animate-pulse">
                    {[0,1,2].map(i => <div key={i} className="h-6 bg-muted rounded" />)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-api-usage">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="w-5 h-5 text-acr-warn" />
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
                      <Mail className="w-4 h-4 text-acr-accent" />
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
                      <MapIcon className="w-4 h-4 text-acr-pos" />
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
                      <MessageSquare className="w-4 h-4 text-acr-brand" />
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
                          className="flex-1 bg-acr-warn/20 rounded-t-sm hover:bg-acr-warn/40 transition-colors"
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

          {/* External Services Health (infrastructure tab only) */}
          {activeTab === "infrastructure" && <SystemHealth />}

          {/* Feature Requests + Support + Escalations (operations tab only) */}
          <div id="section-users" className={`scroll-mt-16 ${activeTab !== "operations" ? "hidden" : ""}`} />
          <Card data-testid="card-feature-requests" className={activeTab !== "operations" ? "hidden" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-acr-warn" />
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
          <Card data-testid="card-support-analytics" className={activeTab !== "operations" ? "hidden" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-acr-brand" />
                Support Analytics (Pax AI)
              </CardTitle>
              <CardDescription>Pax-handled support metrics</CardDescription>
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
          <Card data-testid="card-escalation-queue" className={activeTab !== "operations" ? "hidden" : ""}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HandHelping className="w-5 h-5 text-acr-warn" />
                  Escalation Queue
                  {escalations && escalations.length > 0 && (
                    <Badge variant="secondary" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">
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
                        ticket.priority === 'urgent' ? 'bg-acr-neg/5 border-acr-neg/20' :
                        ticket.priority === 'high' ? 'bg-acr-warn/5 border-acr-warn/20' :
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
                                {ticket.createdAt ? relative(ticket.createdAt) : ''}
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
                              <span className="ml-2 text-acr-warn">
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
                            <AlertTriangle className="w-3 h-3 text-acr-warn" />
                            <span className="text-xs text-acr-warn">
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
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-acr-pos" />
                  <p className="text-sm">No escalations pending</p>
                  <p className="text-xs">Pax is handling all support requests</p>
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
                        alert.severity === 'critical' ? 'bg-acr-neg/5 border-acr-neg/20' :
                        alert.severity === 'warning' ? 'bg-acr-warn/5 border-acr-warn/20' :
                        'bg-acr-accent/5 border-acr-accent/20'
                      }`}
                      data-testid={`alert-item-${alert.id}`}
                    >
                      {alert.severity === 'critical' ? (
                        <AlertCircle className="w-5 h-5 text-acr-neg flex-shrink-0" />
                      ) : alert.severity === 'warning' ? (
                        <AlertTriangle className="w-5 h-5 text-acr-warn flex-shrink-0" />
                      ) : (
                        <Activity className="w-5 h-5 text-acr-accent flex-shrink-0" />
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
                          {alert.createdAt ? relative(alert.createdAt) : ''}
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
                          <Badge variant="outline" className="bg-acr-accent/10 text-acr-accent border-acr-accent/20">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Testing
                          </Badge>
                        ) : endpointTestResults.has(endpoint.id) ? (
                          endpointTestResults.get(endpoint.id)?.success ? (
                            <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Passed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-acr-neg/10 text-acr-neg border-acr-neg/20" title={endpointTestResults.get(endpoint.id)?.message}>
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Failed
                            </Badge>
                          )
                        ) : endpoint.isVerified ? (
                          <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Verified
                          </Badge>
                        ) : endpoint.errorCount > 0 ? (
                          <Badge variant="outline" className="bg-acr-neg/10 text-acr-neg border-acr-neg/20">
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
                          aria-label="Test endpoint"
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
                            aria-label="Diagnose issues"
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
                          aria-label={`Delete endpoint ${endpoint.county}, ${endpoint.state}`}
                          data-testid={`button-delete-gis-${endpoint.id}`}
                          title={`Delete endpoint ${endpoint.county}, ${endpoint.state}`}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
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
                    <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
                      {dataSourceStats.enabled} enabled
                    </Badge>
                    <Badge variant="outline" className="bg-acr-accent/10 text-acr-accent border-acr-accent/20">
                      {dataSourceStats.verified} verified
                    </Badge>
                  </div>
                )}
                {validationStatus?.isRunning && validationStatus?.progress && (
                  <Badge variant="outline" className="bg-acr-accent/10 text-acr-accent border-acr-accent/20">
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
                            <a
                              href={source.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`${source.title} portal (opens in new tab)`}
                              className="hover:underline text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            >
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
                            className={source.accessLevel === 'free' ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' : 
                                       source.accessLevel === 'limited_free' ? 'bg-acr-warn/10 text-acr-warn border-acr-warn/20' : 
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
                            <Loader2 className="w-4 h-4 text-acr-accent animate-spin" />
                          ) : dataSourceTestResults.has(source.id) ? (
                            dataSourceTestResults.get(source.id)?.success ? (
                              <span title="Test passed"><CheckCircle2 className="w-4 h-4 text-acr-pos" /></span>
                            ) : (
                              <span title={dataSourceTestResults.get(source.id)?.message}><AlertCircle className="w-4 h-4 text-acr-neg" /></span>
                            )
                          ) : source.isVerified ? (
                            <CheckCircle2 className="w-4 h-4 text-acr-pos" />
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
                            aria-label="Test data source"
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
                            aria-label={source.isEnabled ? "Disable data source" : "Enable data source"}
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
                  <Users className="w-5 h-5 text-acr-accent" />
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
                            org.tier === 'scale' ? 'bg-acr-brand/10 text-acr-brand border-acr-brand/20' :
                            org.tier === 'pro' ? 'bg-acr-accent/10 text-acr-accent border-acr-accent/20' :
                            org.tier === 'starter' ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' :
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
                            org.subscriptionStatus === 'active' ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' :
                            org.subscriptionStatus === 'cancelled' ? 'bg-acr-neg/10 text-acr-neg border-acr-neg/20' :
                            org.subscriptionStatus === 'trialing' ? 'bg-acr-accent/10 text-acr-accent border-acr-accent/20' :
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
                        {org.lastActiveAt ? relative(org.lastActiveAt) : 'Never'}
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
                <TrendingUp className="w-5 h-5 text-acr-pos" />
                Subscription Lifecycle
              </CardTitle>
              <CardDescription>Track subscription changes over time</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-4 h-4 text-acr-pos" />
                    <span className="text-2xl font-bold text-acr-pos">{subscriptionStats?.upgrades30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Upgrades (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingDown className="w-4 h-4 text-acr-warn" />
                    <span className="text-2xl font-bold text-acr-warn">{subscriptionStats?.downgrades30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Downgrades (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <AlertCircle className="w-4 h-4 text-acr-neg" />
                    <span className="text-2xl font-bold text-acr-neg">{subscriptionStats?.cancellations30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Cancellations (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <RefreshCw className="w-4 h-4 text-acr-accent" />
                    <span className="text-2xl font-bold text-acr-accent">{subscriptionStats?.reactivations30d || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Reactivations (30d)</p>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <UserPlus className="w-4 h-4 text-acr-accent" />
                    <span className="text-2xl font-bold text-acr-accent">{subscriptionStats?.signups30d || 0}</span>
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
                          <span className="text-sm font-medium capitalize">{event.eventType.replace(/_/g, ' ')}</span>
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
                          {event.createdAt ? relative(event.createdAt) : ''}
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
            placeholder="Enter internal notes about this feature request…"
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
                      <Badge variant="outline" className="bg-acr-accent/10 text-acr-accent border-acr-accent/20">
                        {scanResult?.totalKnown || 0} known patterns
                      </Badge>
                      <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">
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
                                            className={`text-xs ${endpoint.confidenceScore >= 85 ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' : endpoint.confidenceScore >= 70 ? 'bg-acr-warn/10 text-acr-warn border-acr-warn/20' : 'bg-muted text-muted-foreground border-border'}`}
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
                    <Label htmlFor="discovery-state-filter" className="text-sm text-muted-foreground">Filter by state:</Label>
                    <Select
                      value={discoveryStateFilter}
                      onValueChange={setDiscoveryStateFilter}
                    >
                      <SelectTrigger id="discovery-state-filter" className="w-32" data-testid="select-discovery-state-filter">
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
                    <Label htmlFor="scan-target-states" className="text-sm text-muted-foreground">Scan target states:</Label>
                    <input
                      id="scan-target-states"
                      type="text"
                      placeholder="e.g., TX, AZ, NM"
                      value={scanTargetStates}
                      onChange={(e) => setScanTargetStates(e.target.value)}
                      autoCapitalize="characters"
                      autoComplete="off"
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
                            <Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Validated</Badge>
                          )}
                          {endpoint.status === "rejected" && (
                            <Badge variant="outline" className="bg-acr-neg/10 text-acr-neg border-acr-neg/20">Rejected</Badge>
                          )}
                          {endpoint.status === "added" && (
                            <Badge variant="outline" className="bg-acr-accent/10 text-acr-accent border-acr-accent/20">Added</Badge>
                          )}
                        </span>
                        <span className="col-span-2">
                          {endpoint.confidenceScore && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${endpoint.confidenceScore >= 80 ? 'bg-acr-pos/10 text-acr-pos border-acr-pos/20' : endpoint.confidenceScore >= 60 ? 'bg-acr-warn/10 text-acr-warn border-acr-warn/20' : 'bg-muted text-muted-foreground border-border'}`}
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
                            aria-label="Validate endpoint"
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
                            aria-label="Approve endpoint"
                            data-testid={`button-approve-live-${endpoint.id}`}
                            title="Approve and add to database"
                          >
                            <Check className="w-4 h-4 text-acr-pos" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => rejectLiveEndpointMutation.mutate(endpoint.id)}
                            disabled={rejectLiveEndpointMutation.isPending || endpoint.status === "added" || endpoint.status === "rejected"}
                            aria-label="Reject endpoint"
                            data-testid={`button-reject-live-${endpoint.id}`}
                            title="Reject endpoint"
                          >
                            <X className="w-4 h-4 text-acr-neg" />
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
              {expandedTile === 'revenue' && <><DollarSign className="w-5 h-5 text-acr-pos" /> Revenue Analytics - Detailed View</>}
              {expandedTile === 'health' && <><Server className="w-5 h-5 text-acr-accent" /> System Health - Detailed View</>}
              {expandedTile === 'agents' && <><Bot className="w-5 h-5 text-acr-brand" /> Agent Status - Detailed View</>}
              {expandedTile === 'alerts' && <><AlertTriangle className="w-5 h-5 text-acr-warn" /> Alerts - Detailed View</>}
              {expandedTile === 'revenueAtRisk' && <><TrendingDown className="w-5 h-5 text-acr-neg" /> Revenue At Risk - Detailed View</>}
              {expandedTile === 'userActivity' && <><Users className="w-5 h-5 text-acr-accent" /> User Activity - Detailed View</>}
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
                          <th scope="col" className="text-left py-2">Tier</th>
                          <th scope="col" className="text-right py-2">Count</th>
                          <th scope="col" className="text-right py-2"><GlossaryTerm slug="MRR">MRR</GlossaryTerm></th>
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
                      <div className="flex justify-between"><span>Total MRR:</span><span className="font-bold text-acr-pos">{formatCurrency(dashboardData?.revenue.mrr || 0)}</span></div>
                      <div className="flex justify-between"><span>Credit Sales (Month):</span><span>{formatCurrency(dashboardData?.revenue.creditSalesThisMonth || 0)}</span></div>
                      <div className="flex justify-between"><span>Total (Month):</span><span>{formatCurrency(dashboardData?.revenue.totalRevenueThisMonth || 0)}</span></div>
                      <div className="flex justify-between"><span>MRR at Risk:</span><span className="text-acr-neg">{formatCurrency(dashboardData?.revenue.mrrAtRisk || 0)}</span></div>
                    </div>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Revenue Projections (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="text-left py-2">Month</th>
                        <th scope="col" className="text-right py-2">Projected MRR</th>
                        <th scope="col" className="text-right py-2">Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">This Month</td><td className="text-right">{formatCurrency(dashboardData?.revenue.mrr || 0)}</td><td className="text-right text-acr-pos">-</td></tr>
                      <tr><td className="py-1">Next Month</td><td className="text-right">{formatCurrency((dashboardData?.revenue.mrr || 0) * 1.05)}</td><td className="text-right text-acr-pos">+5%</td></tr>
                      <tr><td className="py-1">+2 Months</td><td className="text-right">{formatCurrency((dashboardData?.revenue.mrr || 0) * 1.1)}</td><td className="text-right text-acr-pos">+10%</td></tr>
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
                      <div className="flex justify-between"><span>System Uptime:</span><span className="font-medium text-acr-pos">{dashboardData?.systemHealth.uptime || 99.9}%</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Users by Tier</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2">Tier</th>
                          <th scope="col" className="text-right py-2">Organizations</th>
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
                        <th scope="col" className="text-left py-2">Date</th>
                        <th scope="col" className="text-right py-2">Uptime</th>
                        <th scope="col" className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Today</td><td className="text-right">100%</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Healthy</Badge></td></tr>
                      <tr><td className="py-1">Yesterday</td><td className="text-right">100%</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Healthy</Badge></td></tr>
                      <tr><td className="py-1">2 Days Ago</td><td className="text-right">99.9%</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Healthy</Badge></td></tr>
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
                          <div><span className="text-muted-foreground">Last Run:</span><br/>{agent.lastRun ? relative(agent.lastRun) : 'Never'}</div>
                          <div><span className="text-muted-foreground">Processed:</span><br/><span className="font-medium">{agent.processed}</span></div>
                          <div><span className="text-muted-foreground">Failed:</span><br/><span className={agent.failed > 0 ? 'text-acr-neg font-medium' : ''}>{agent.failed}</span></div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">API Queue</h4>
                    <div className="flex gap-4">
                      <div><span className="text-muted-foreground">Pending:</span> <span className="font-medium">{dashboardData?.agents.apiQueue.pending || 0}</span></div>
                      <div><span className="text-muted-foreground">Failed:</span> <span className={`${(dashboardData?.agents.apiQueue.failed || 0) > 0 ? 'text-acr-neg' : ''} font-medium`}>{dashboardData?.agents.apiQueue.failed || 0}</span></div>
                    </div>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Recent Task History (Mock Data)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="text-left py-2">Agent</th>
                        <th scope="col" className="text-left py-2">Task</th>
                        <th scope="col" className="text-right py-2">Duration</th>
                        <th scope="col" className="text-left py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Lead Nurturer</td><td>Process follow-ups</td><td className="text-right">2.3s</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Success</Badge></td></tr>
                      <tr><td className="py-1">Campaign Optimizer</td><td>Analyze A/B tests</td><td className="text-right">1.5s</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Success</Badge></td></tr>
                      <tr><td className="py-1">Finance Agent</td><td>Process dunning</td><td className="text-right">0.8s</td><td><Badge variant="outline" className="bg-acr-pos/10 text-acr-pos border-acr-pos/20">Success</Badge></td></tr>
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
                        alert.severity === 'critical' ? 'bg-acr-neg/5 border-acr-neg/20' :
                        alert.severity === 'warning' ? 'bg-acr-warn/5 border-acr-warn/20' :
                        'bg-acr-accent/5 border-acr-accent/20'
                      }`}
                    >
                      {alert.severity === 'critical' ? (
                        <AlertCircle className="w-5 h-5 text-acr-neg flex-shrink-0" />
                      ) : alert.severity === 'warning' ? (
                        <AlertTriangle className="w-5 h-5 text-acr-warn flex-shrink-0" />
                      ) : (
                        <Activity className="w-5 h-5 text-acr-accent flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{alert.title}</span>
                          <Badge variant="outline" className={getSeverityColor(alert.severity)}>{alert.severity}</Badge>
                          <Badge variant="outline">{alert.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.createdAt ? relative(alert.createdAt) : ''}
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
                      <div className="flex justify-between"><span>Total MRR at Risk:</span><span className="font-bold text-acr-neg">{formatCurrency(dashboardData?.revenueAtRisk.totalMrrAtRisk || 0)}</span></div>
                      <div className="flex justify-between"><span>Orgs in Dunning:</span><span>{Object.values(dashboardData?.revenueAtRisk.dunningByStage || {}).reduce((a, b) => a + b, 0)}</span></div>
                      <div className="flex justify-between"><span>Low Credit Balance:</span><span>{dashboardData?.revenueAtRisk.orgsApproachingCreditExhaustion || 0}</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Dunning by Stage</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2">Stage</th>
                          <th scope="col" className="text-right py-2">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dashboardData?.revenueAtRisk.dunningByStage || {}).map(([stage, count]) => (
                          <tr key={stage}><td className="py-1 capitalize">{stage.replace(/_/g, ' ')}</td><td className="text-right">{count}</td></tr>
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
                        <th scope="col" className="text-left py-2">Organization</th>
                        <th scope="col" className="text-left py-2">Tier</th>
                        <th scope="col" className="text-left py-2">Status</th>
                        <th scope="col" className="text-right py-2">MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="py-1">Acme Corp</td><td>Pro</td><td><Badge variant="outline" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">Payment Overdue</Badge></td><td className="text-right">$99</td></tr>
                      <tr><td className="py-1">Beta Inc</td><td>Starter</td><td><Badge variant="outline" className="bg-acr-warn/10 text-acr-warn border-acr-warn/20">Low Credits</Badge></td><td className="text-right">$49</td></tr>
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
                      <div className="flex justify-between"><span>New Signups (Week):</span><span className="font-medium text-acr-pos">{dashboardData?.userActivity.newSignupsThisWeek || 0}</span></div>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">Organizations by Tier</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2">Tier</th>
                          <th scope="col" className="text-right py-2">Count</th>
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
                        <th scope="col" className="text-left py-2">Period</th>
                        <th scope="col" className="text-right py-2">Signups</th>
                        <th scope="col" className="text-right py-2">Conversions</th>
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
                            intensity > 0.75 ? 'bg-acr-pos' :
                            intensity > 0.5 ? 'bg-acr-pos' :
                            intensity > 0.25 ? 'bg-acr-pos' :
                            'bg-acr-pos-soft dark:bg-acr-pos-soft'
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
                  <AlertCircle className="w-4 h-4 text-acr-neg" />
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
                    <Lightbulb className="w-4 h-4 text-acr-warn" />
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
              <Clipboard className="w-5 h-5 text-acr-accent" />
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
      {/* OrgHealthMonitor moved to /founder/customers/health (F-D #4) */}
      <div id="section-org-health" className="scroll-mt-16">
        <Link href="/founder/customers/health" className="block p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" aria-hidden="true" />
              <div>
                <p className="font-semibold text-sm">Customer health</p>
                <p className="text-xs text-muted-foreground">Per-org health scores, MRR waterfall by tier — open the dedicated page.</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs">Open →</Badge>
          </div>
        </Link>
      </div>

      {/* AI Models + System API Keys = Config */}
      <AIModelsSection />
      {/* SystemApiKeysSection extracted to /founder/keys (F-D #1).
          Link card preserves discoverability for founders who scroll. */}
      <Link href="/founder/keys" className="block mt-6 mb-8 p-6 border rounded-xl bg-card hover:border-primary/40 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" aria-hidden="true" />
              System API keys
            </h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              Platform-wide API keys, BYOK overrides. Open the dedicated page to rotate.
            </p>
          </div>
          <Badge variant="outline" className="text-xs">Open →</Badge>
        </div>
      </Link>

      {/* Monthly Check-In Dashboard */}
      <MonthlyCheckin />

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
    onError: () => toast({ title: "Couldn't update model", description: "The model's existing enabled state is unchanged.", variant: "destructive" }),
  });

  const updateWeightMutation = useMutation({
    mutationFn: async ({ id, weight }: { id: number; weight: number }) =>
      apiRequest("PUT", `/api/admin/ai-models/${id}`, { weight }),
    onSuccess: () => { refetch(); },
    onError: () => toast({ title: "Couldn't update weight", description: "The model's existing weight is unchanged.", variant: "destructive" }),
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
                <th scope="col" className="text-left py-2 pr-4 font-medium">Model</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Input $/M</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Output $/M</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Weight</th>
                <th scope="col" className="text-center py-2 pr-4 font-medium">Enabled</th>
                <th scope="col" className="text-left py-2 font-medium">Task Types</th>
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
    onError: () => toast({ title: "Couldn't update flag", description: "The flag's existing value is unchanged.", variant: "destructive" }),
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
    onError: () => toast({ title: "Couldn't update prices", description: "Tier pricing is unchanged. Try again.", variant: "destructive" }),
  });

  const createPromoMutation = useMutation({
    mutationFn: async ({ tier, label, discount, endsAt }: { tier: string; label: string; discount: number; endsAt: string }) =>
      apiRequest("POST", `/api/founder/pricing/${tier}/promo`, {
        promoLabel: label,
        promoDiscountPercent: discount,
        promoEndsAt: endsAt,
      }),
    onSuccess: () => { refetch(); setPromoForm(null); toast({ title: "Promotion activated" }); },
    onError: () => toast({ title: "Couldn't create promotion", description: "No promotion was activated. Try again.", variant: "destructive" }),
  });

  const clearPromoMutation = useMutation({
    mutationFn: async (tier: string) => apiRequest("DELETE", `/api/founder/pricing/${tier}/promo`),
    onSuccess: () => { refetch(); toast({ title: "Promotion cleared" }); },
    onError: () => toast({ title: "Couldn't clear promotion", description: "The promotion is still active. Try again.", variant: "destructive" }),
  });

  const togglePromoCodesMutation = useMutation({
    mutationFn: async ({ tier, allow }: { tier: string; allow: boolean }) =>
      apiRequest("PUT", `/api/founder/pricing/${tier}`, { allowPromoCodes: allow }),
    onSuccess: () => refetch(),
    onError: () => toast({ title: "Couldn't update promo code setting", description: "The existing setting is unchanged.", variant: "destructive" }),
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
                      <Badge className="ml-2 bg-acr-pos/10 text-acr-pos border-acr-pos/20">
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
                          inputMode="numeric"
                          className="h-8 w-24 text-sm"
                          placeholder="Monthly ¢"
                          value={draftPrices.monthly}
                          onChange={(e) => setDraftPrices((p) => ({ ...p, monthly: e.target.value }))}
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
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
                      <Input type="number" inputMode="numeric" min="1" max="99" placeholder="Discount %" className="h-8 text-sm"
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
  pain_point: "border-acr-neg/30 bg-acr-neg-soft/50 dark:border-acr-neg-soft/40 dark:bg-acr-neg-soft/20",
  aspiration: "border-acr-brand-soft bg-acr-brand-soft/50 dark:border-acr-brand-soft/40 dark:bg-acr-brand-soft/20",
  social_proof: "border-acr-accent bg-acr-accent/50 dark:border-acr-accent/40 dark:bg-acr-accent/20",
  curiosity: "border-acr-warn/30 bg-acr-warn-soft/50 dark:border-acr-warn-soft/40 dark:bg-acr-warn-soft/20",
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
      toast({ title: "Couldn't generate creative", description: `${bundleData.error || "Try again"} — no bundle was saved.`, variant: "destructive" });
      setWizardStep("setup");
      setBundleId(null);
    }
  }, [bundleData, wizardStep]);

  const saveAdAccountMutation = useMutation({
    mutationFn: async (data: typeof adForm) => apiRequest("PUT", "/api/founder/growth/ad-account", data),
    onSuccess: () => { refetchAccount(); setShowAdAccountForm(false); toast({ title: "Ad account saved" }); },
    onError: () => toast({ title: "Couldn't save ad account", description: "Your existing ad account credentials are unchanged.", variant: "destructive" }),
  });

  const generateCreativeMutation = useMutation({
    mutationFn: async ({ templateKey }: { templateKey: string }) =>
      apiRequest("POST", "/api/founder/growth/generate-creative", { templateKey }).then((r) => r.json()),
    onSuccess: (data: { bundleId: string }) => {
      setBundleId(data.bundleId);
      setWizardStep("generating");
    },
    onError: (err: any) => toast({ title: "Couldn't start generation", description: `${err?.message || "Try again"} — no creative bundle was generated.`, variant: "destructive" }),
  });

  const regenerateCopyMutation = useMutation({
    mutationFn: async ({ id, angle }: { id: string; angle: string }) =>
      apiRequest("POST", `/api/founder/growth/creative-bundles/${id}/regenerate-copy`, { angle }).then((r) => r.json()),
    onSuccess: (data: CreativeBundle) => {
      setBundle(data);
      setRegeneratingAngle(null);
      toast({ title: "Copy variant refreshed" });
    },
    onError: () => { setRegeneratingAngle(null); toast({ title: "Couldn't regenerate copy", description: "The existing variant is unchanged.", variant: "destructive" }); },
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
    onError: (err: any) => toast({ title: "Couldn't deploy campaign", description: `${err?.message || "Try again"} — no campaign was created in Meta.`, variant: "destructive" }),
  });

  const toggleCampaignMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/founder/growth/campaigns/${id}/status`, { status }),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Campaign updated" }); },
    onError: () => toast({ title: "Couldn't update campaign", description: "The campaign's existing status is unchanged.", variant: "destructive" }),
  });

  const syncStatsMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/founder/growth/campaigns/${id}/sync`),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Stats synced" }); },
    onError: () => toast({ title: "Couldn't sync stats", description: "Last-known stats are still displayed.", variant: "destructive" }),
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

  // Status → semantic --acr-* tone (Tier 1 platform pattern). Phase G.3
  // partial polish — full founder-dashboard re-skin scoped per JUDGMENT-CALLS
  // E.6.1; this swaps the centralized status map without touching the
  // 200+ inline color usages elsewhere in the file.
  const statusColors: Record<string, string> = {
    active: "bg-acr-pos-soft text-acr-pos border-[color:var(--acr-pos)]/20",
    paused: "bg-acr-warn-soft text-acr-warn border-[color:var(--acr-warn)]/20",
    draft: "bg-acr-surface-2 text-acr-ink-3 border-transparent",
    completed: "bg-acr-brand-soft text-acr-brand border-[color:var(--acr-brand)]/20",
  };

  const TEMPLATE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; tagline: string }> = {
    land_investors_signup: { icon: Target, color: "text-acr-pos", tagline: "Cold audience — land investors & buyers" },
    retargeting_visitors: { icon: RotateCcw, color: "text-acr-warn", tagline: "Warm audience — website visitors who didn't convert" },
    lookalike_subscribers: { icon: Users2, color: "text-acr-brand", tagline: "Lookalike — similar to your current subscribers" },
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
          <h3 className="font-medium text-sm">Meta ad-account credentials</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ad-account-id" className="text-xs text-muted-foreground mb-1 block">Ad account ID</Label>
              <Input id="ad-account-id" placeholder="act_123456789" className="h-8 text-sm" value={adForm.adAccountId}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                onChange={(e) => setAdForm((f) => ({ ...f, adAccountId: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="meta-access-token" className="text-xs text-muted-foreground mb-1 block">Access token</Label>
              <Input id="meta-access-token" type="password" placeholder="EAAxxxxxxx" className="h-8 text-sm" value={adForm.accessToken}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                onChange={(e) => setAdForm((f) => ({ ...f, accessToken: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="meta-pixel-id" className="text-xs text-muted-foreground mb-1 block">Pixel ID <span className="text-muted-foreground/70">(for conversion tracking)</span></Label>
              <Input id="meta-pixel-id" placeholder="123456789" className="h-8 text-sm" value={adForm.pixelId}
                inputMode="numeric" autoComplete="off"
                onChange={(e) => setAdForm((f) => ({ ...f, pixelId: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="meta-app-id" className="text-xs text-muted-foreground mb-1 block">Facebook page / app ID</Label>
              <Input id="meta-app-id" placeholder="Meta page or app ID" className="h-8 text-sm" value={adForm.appId}
                autoComplete="off"
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
        <div className="flex items-center gap-2 p-2.5 bg-acr-pos/5 border border-acr-pos/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0" />
          <span className="text-sm text-acr-pos font-medium">Meta ad account connected</span>
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
                <p id="campaign-template-label" className="text-sm font-medium mb-2">Campaign template</p>
                <div role="radiogroup" aria-labelledby="campaign-template-label" className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(templates || []).map((t) => {
                    const meta = TEMPLATE_META[t.key] || { icon: Radio, color: "text-primary", tagline: t.description };
                    const Icon = meta.icon;
                    const isSelected = wizardTemplate === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setWizardTemplate(t.key)}
                        className={`p-4 border-2 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <Icon className={`w-5 h-5 mb-2 ${meta.color}`} aria-hidden="true" />
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
                  <Label htmlFor="campaign-name" className="text-sm font-medium mb-1.5 block">Campaign name</Label>
                  <Input
                    id="campaign-name"
                    placeholder="e.g. AcreOS – Real Estate Pros – March 2026"
                    value={wizardName}
                    onChange={(e) => setWizardName(e.target.value)}
                    autoCapitalize="words"
                  />
                </div>
                <div>
                  <Label htmlFor="campaign-budget" className="text-sm font-medium mb-1.5 block flex justify-between">
                    Daily budget
                    <span className="font-semibold text-primary">${dailyBudgetDollars}/day</span>
                  </Label>
                  <input
                    id="campaign-budget"
                    type="range"
                    min="1000"
                    max="50000"
                    step="500"
                    value={wizardBudget}
                    onChange={(e) => setWizardBudget(e.target.value)}
                    aria-valuetext={`$${dailyBudgetDollars} per day`}
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
                              {isEditing ? <Check className="w-3 h-3 text-acr-pos" /> : <PencilLine className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-1.5 text-sm">
                            <div>
                              <Label htmlFor={`copy-headline-${copy.angle}`} className="text-xs text-muted-foreground">Headline <span className="text-muted-foreground/70">(≤40 chars)</span></Label>
                              <Input
                                id={`copy-headline-${copy.angle}`}
                                value={editDraft.headline || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, headline: e.target.value.slice(0, 40) }))}
                                maxLength={40}
                                className="h-7 text-xs mt-0.5"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`copy-primary-${copy.angle}`} className="text-xs text-muted-foreground">Primary text <span className="text-muted-foreground/70">(≤125 chars)</span></Label>
                              <Textarea
                                id={`copy-primary-${copy.angle}`}
                                value={editDraft.primaryText || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, primaryText: e.target.value.slice(0, 125) }))}
                                maxLength={125}
                                className="text-xs min-h-[60px] mt-0.5 resize-none"
                                rows={3}
                              />
                            </div>
                            <div>
                              <Label htmlFor={`copy-description-${copy.angle}`} className="text-xs text-muted-foreground">Description <span className="text-muted-foreground/70">(≤30 chars)</span></Label>
                              <Input
                                id={`copy-description-${copy.angle}`}
                                value={editDraft.description || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value.slice(0, 30) }))}
                                maxLength={30}
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
            <p className="text-xs text-muted-foreground mt-1">Click "Generate Campaign" to create your first one.</p>
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
                        <Button aria-label="Refresh" size="sm" variant="ghost" className="h-7 w-7 p-0"
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
                Updated {relative(data.generatedAt)}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Refresh briefing"
          aria-label={isFetching ? "Refreshing briefing" : "Refresh briefing"}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {data?.highlights && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-4">
          {[
            { label: "MRR", value: usd(data.highlights.totalMrr, { noCents: Number.isInteger(data.highlights.totalMrr) }), color: "text-acr-pos", icon: DollarSign },
            { label: "Paying Orgs", value: data.highlights.totalOrgs, color: "text-primary", icon: Building2 },
            { label: "New (24h)", value: data.highlights.newSignups24h, color: data.highlights.newSignups24h > 0 ? "text-acr-pos" : "text-muted-foreground", icon: UserPlus },
            { label: "At Risk", value: data.highlights.atRiskOrgs, color: data.highlights.atRiskOrgs > 0 ? "text-acr-neg" : "text-muted-foreground", icon: AlertTriangle },
            { label: "Alerts", value: data.highlights.unresolvedAlerts, color: data.highlights.unresolvedAlerts > 0 ? "text-acr-warn" : "text-muted-foreground", icon: Bell },
            { label: "Escalations", value: data.highlights.escalatedTickets, color: data.highlights.escalatedTickets > 0 ? "text-acr-neg" : "text-muted-foreground", icon: AlertOctagon },
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
    // Hidden on mobile — sat directly under MobileBottomNav (~72px) so
    // it was invisible. Founder operations surface anyway; desktop only.
    <aside aria-label="Autopilot status" className="hidden md:block fixed bottom-0 left-0 right-0 z-40 bg-background/95 border-t backdrop-blur-sm">
      <div className="max-w-screen-2xl mx-auto px-4 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse autopilot status" : "Expand autopilot status"}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-acr-pos animate-pulse" />
            <span className="text-xs font-medium text-acr-pos">Autopilot Active</span>
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
                <div key={job.name} className="flex items-center gap-1.5 p-1.5 rounded bg-acr-pos/5 border border-acr-pos/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-acr-pos shrink-0" />
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
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FOUNDER STICKY NAV
// Appears below the header, sticky at top, with section anchors and
// an IntersectionObserver to highlight the active section.
// ─────────────────────────────────────────────────────────────────────

// FounderNavBar + NAV_ITEMS removed 2026-05-01 (Wave G2). Defined here
// but never rendered anywhere — the legacy operational dashboard uses
// page-down scrolling instead. Removed to prevent maintenance drift on a
// dead-code path.


// ─────────────────────────────────────────────────────────────────────
// NEW SUBSCRIBER LIVE FEED
// Shows recent new_subscriber system alerts prominently in the overview.
// Usage: <NewSubscriberFeed alerts={alerts} />
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// CEO COMPANY BRIEFING — Sovereign Company Protocol
// "Good morning, Thomas. Here's your company."
// Synthesized view from all 10 AI agent personas.
// ─────────────────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, React.ElementType> = {
  atlas_cto: Cpu,
  sophie_csm: Heart,
  forge_revenue: DollarSign,
  beacon_marketing: Megaphone,
  sentinel_devops: Server,
  ledger_finance: BarChart3,
  shield_legal: ShieldAlert,
  oracle_analytics: BrainCircuit,
  compass_pm: Navigation,
  crucible_qa: ScrollText,
};

// Per-agent text color sourced from the consolidated identity registry
// — see client/src/lib/agent-identity.ts (agentTextClass). Direct lookup
// kept as a Record so existing call-sites (`AGENT_COLORS[codename]`) keep
// working without further refactoring.
const AGENT_COLORS: Record<string, string> = new Proxy({}, {
  get: (_, codename: string) => agentTextClass(codename),
}) as Record<string, string>;

const WING_BADGES: Record<string, { label: string; className: string }> = {
  product: { label: "Product", className: "bg-acr-accent/10 text-acr-accent dark:text-acr-accent border-acr-accent/20" },
  growth: { label: "Growth", className: "bg-acr-pos/10 text-acr-pos dark:text-acr-pos border-acr-pos/20" },
  ops: { label: "Ops", className: "bg-muted/10 text-foreground dark:text-muted-foreground border-border/20" },
};

const MOOD_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: "bg-acr-pos/5", border: "border-acr-pos/20", text: "text-acr-pos dark:text-acr-pos", dot: "bg-acr-pos" },
  yellow: { bg: "bg-acr-warn/5", border: "border-acr-warn/20", text: "text-acr-warn dark:text-acr-warn", dot: "bg-acr-warn" },
  red: { bg: "bg-acr-neg/5", border: "border-acr-neg/20", text: "text-acr-neg dark:text-acr-neg", dot: "bg-acr-neg" },
};

function CompanyBriefingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const founderName = authUser?.firstName || "Founder";

  const { data: briefing, isLoading, refetch } = useQuery({
    queryKey: ["/api/founder/intelligence/company-briefing"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/company-briefing", {});
      return res.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchInterval: 60 * 60 * 1000, // refresh every hour
  });

  const approveMutation = useMutation({
    mutationFn: async (decisionId: number) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/decisions-inbox/${decisionId}`, {
        action: "approve",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Decision approved" });
      refetch();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (decisionId: number) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/decisions-inbox/${decisionId}`, {
        action: "reject",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Decision rejected" });
      refetch();
    },
  });

  if (isLoading) {
    return (
      <Card className="border-2">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!briefing) return null;

  const mood = MOOD_STYLES[briefing.mood] || MOOD_STYLES.green;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className={`rounded-xl border-2 ${mood.border} ${mood.bg} p-6 space-y-6`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {greeting}, {founderName}. Here's your company.
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Generated {briefing.generatedAt ? relative(briefing.generatedAt) : "just now"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${mood.bg} border ${mood.border}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${mood.dot} animate-pulse`} />
            <span className={`text-sm font-bold ${mood.text}`}>
              Company Health: {briefing.healthScore >= 80 ? "Excellent" : briefing.healthScore >= 60 ? "Good" : briefing.healthScore >= 40 ? "Needs attention" : "Critical"}
            </span>
          </div>
          <Button aria-label="Refresh" size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Overnight Activity */}
      {briefing.agentReports && briefing.agentReports.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Overnight, your team:
          </h3>
          <div className="space-y-2">
            {briefing.agentReports.map((report: any) => {
              const Icon = AGENT_ICONS[report.codename] || Bot;
              const color = AGENT_COLORS[report.codename] || "text-muted-foreground";

              return (
                <div key={report.codename} className="flex items-start gap-3 p-2 rounded-lg hover:bg-background/50 transition-colors">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0">
                    <span className={`font-semibold text-sm ${color}`}>{report.codename.split("_")[0].charAt(0).toUpperCase() + report.codename.split("_")[0].slice(1)}</span>
                    <span className="text-sm text-foreground ml-1">{report.summary}</span>
                  </div>
                  {report.alerts && report.alerts.length > 0 && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {report.alerts.length} alert{report.alerts.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Decisions */}
      {briefing.decisionsNeeded && briefing.decisionsNeeded.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            You have {briefing.decisionsNeeded.length} decision{briefing.decisionsNeeded.length > 1 ? "s" : ""} pending:
          </h3>
          <div className="space-y-3">
            {briefing.decisionsNeeded.map((decision: any, idx: number) => {
              const urgencyColors: Record<string, string> = {
                critical: "border-acr-neg/30 bg-acr-neg/5",
                high: "border-acr-warn/30 bg-acr-warn/5",
                medium: "border-acr-accent/30 bg-acr-accent/5",
                low: "border-acr-pos/30 bg-acr-pos/5",
              };

              const urgencyDot: Record<string, string> = {
                critical: "bg-acr-neg",
                high: "bg-acr-warn",
                medium: "bg-acr-accent",
                low: "bg-acr-pos",
              };

              const fromAgent = decision.fromAgent?.split("_")[0] || "unknown";
              const agentLabel = fromAgent.charAt(0).toUpperCase() + fromAgent.slice(1);

              return (
                <div key={decision.id} className={`p-4 rounded-lg border ${urgencyColors[decision.urgency] || urgencyColors.medium}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${urgencyDot[decision.urgency] || urgencyDot.medium}`} />
                      <div>
                        <span className="text-sm">
                          <span className="font-semibold">{agentLabel}</span>
                          {" "}{decision.title || decision.context}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-acr-pos/30 text-acr-pos hover:bg-acr-pos/10"
                        onClick={() => approveMutation.mutate(decision.id)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-acr-neg/30 text-acr-neg hover:bg-acr-neg/10"
                        onClick={() => rejectMutation.mutate(decision.id)}
                        disabled={rejectMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Clear */}
      {(!briefing.decisionsNeeded || briefing.decisionsNeeded.length === 0) && (
        <div className="flex items-center gap-2 text-sm font-medium text-acr-pos">
          <CheckCircle2 className="w-4 h-4" />
          No escalations. Your company is running.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AGENT TEAM PANEL — Sovereign Company Protocol
// Grid of all 10 AI agents with trust scores, status, and chat.
// ─────────────────────────────────────────────────────────────────────

function AgentTeamPanel() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string; agent?: string }[]>([]);
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalAgent, setGoalAgent] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [goalPriority, setGoalPriority] = useState("medium");
  const [chatPending, setChatPending] = useState(false);

  const { data: agents, isLoading, refetch } = useQuery({
    queryKey: ["/api/founder/intelligence/company-agents"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/founder/intelligence/company-agents");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ codename, status }: { codename: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/company-agents/${codename}/status`, { status });
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: `Agent ${vars.status === "paused" ? "paused" : "resumed"}` });
      refetch();
    },
  });

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    const userMsg = chatMessage;
    setChatMessage("");
    setChatHistory(prev => [...prev, { role: "user", content: userMsg }]);
    setChatPending(true);

    try {
      const res = await apiRequest("POST", "/api/founder/intelligence/agent-chat", {
        message: userMsg,
        targetAgent: chatAgent,
        conversationId: chatConvId,
      });
      const data = await res.json();
      if (data.conversationId && !chatConvId) setChatConvId(data.conversationId);
      setChatHistory(prev => [...prev, {
        role: "assistant",
        content: data.response + (data.dataUsed ? "" : ""),
        agent: data.agentTitle,
      }]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that request." }]);
    } finally {
      setChatPending(false);
    }
  };

  const sendGoal = async () => {
    if (!goalAgent || !goalText.trim()) return;
    try {
      await apiRequest("POST", "/api/founder/intelligence/agent-goals", {
        assignedAgent: goalAgent,
        goal: goalText,
        priority: goalPriority,
      });
      toast({ title: "Goal assigned", description: `${goalAgent} has received a new goal.` });
      setGoalOpen(false);
      setGoalText("");
    } catch {
      toast({ title: "Couldn't assign goal", description: "The agent has not received a new goal. Try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const agentList = agents || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users2 className="w-5 h-5 text-acr-accent" />
            Your AI Team
          </h2>
          <p className="text-sm text-muted-foreground">10 agent personas coordinating {">"}166 services</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setChatAgent(null); setChatOpen(true); setChatHistory([]); }}>
          <MessageSquare className="w-4 h-4 mr-1.5" />
          Talk to your company
        </Button>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {agentList.map((agent: any) => {
          const Icon = AGENT_ICONS[agent.codename] || Bot;
          const color = AGENT_COLORS[agent.codename] || "text-muted-foreground";
          const wing = WING_BADGES[agent.wing] || WING_BADGES.ops;
          const isPaused = agent.status === "paused";
          const metrics = agent.metrics || {};
          const trustPct = agent.trustScore || 50;

          return (
            <Card key={agent.codename} className={`relative overflow-hidden cursor-pointer hover:border-primary/30 transition-colors ${isPaused ? "opacity-60" : ""}`}
              onClick={() => navigate(`/founder/agents/${agent.codename}`)}>
              <CardContent className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-5 h-5 ${color}`} />
                    <div>
                      <div className="text-sm font-semibold leading-tight">
                        {agent.codename.split("_")[0].charAt(0).toUpperCase() + agent.codename.split("_")[0].slice(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">{agent.title}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${wing.className}`}>
                    {wing.label}
                  </Badge>
                </div>

                {/* Trust Score */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Trust</span>
                    <span className={`font-medium ${trustBadgeColor(trustPct)} px-1.5 py-0.5 rounded-full text-[10px]`}>{trustLabel(trustPct)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        trustPct >= 75 ? "bg-acr-pos" : trustPct >= 50 ? "bg-acr-warn" : "bg-acr-neg"
                      }`}
                      style={{ width: `${trustPct}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs flex-1"
                    onClick={() => { setChatAgent(agent.codename); setChatOpen(true); setChatHistory([]); setChatConvId(null); }}
                  >
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Chat
                  </Button>
                  <Button aria-label="Target"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-acr-accent"
                    onClick={() => { setGoalAgent(agent.codename); setGoalOpen(true); }}
                  >
                    <Target className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 text-xs ${isPaused ? "text-acr-pos" : "text-acr-warn"}`}
                    onClick={() => statusMutation.mutate({
                      codename: agent.codename,
                      status: isPaused ? "active" : "paused",
                    })}
                    disabled={statusMutation.isPending}
                  >
                    {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  </Button>
                </div>

                {/* Status indicator */}
                <div className="absolute top-2 right-2">
                  <div className={`w-2 h-2 rounded-full ${isPaused ? "bg-acr-warn" : "bg-acr-pos animate-pulse"}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Goal Delegation Dialog */}
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Assign Goal to {goalAgent?.split("_")[0]}
            </DialogTitle>
            <DialogDescription>
              Describe what you want this agent to accomplish.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="e.g. Increase trial-to-paid conversion by 15% this quarter"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              rows={3}
            />
            <Select value={goalPriority} onValueChange={setGoalPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low Priority</SelectItem>
                <SelectItem value="medium">Medium Priority</SelectItem>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="critical">Critical Priority</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGoalOpen(false)}>Cancel</Button>
            <Button onClick={sendGoal} disabled={!goalText.trim()}>Assign Goal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent Chat Dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {chatAgent
                ? `Talk to ${chatAgent.split("_")[0].charAt(0).toUpperCase() + chatAgent.split("_")[0].slice(1)}`
                : "Talk to your company"}
            </DialogTitle>
            <DialogDescription>
              {chatAgent
                ? "Ask this agent about their domain."
                : "Address any agent by name, or ask a general question. Try: \"Forge, what's our MRR trend?\""}
            </DialogDescription>
          </DialogHeader>

          {/* Chat History */}
          <div className="max-h-[400px] overflow-y-auto space-y-3 p-3 bg-muted/30 rounded-lg">
            {chatHistory.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Start a conversation with your AI team.
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border"
                }`}>
                  {msg.agent && (
                    <div className="text-xs font-semibold text-muted-foreground mb-1">{msg.agent}</div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {chatPending && (
              <div className="flex justify-start">
                <div className="bg-card border rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="flex items-center gap-2">
            <Input
              placeholder={chatAgent ? `Ask ${chatAgent.split("_")[0]}...` : "Type your message..."}
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              disabled={chatPending}
            />
            <Button aria-label="Send" onClick={sendChat} disabled={chatPending || !chatMessage.trim()} size="sm">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
    <div className="p-4 border rounded-xl bg-gradient-to-br from-acr-pos/5 to-background border-acr-pos/20">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-acr-pos" />
        <span className="font-medium text-sm text-acr-pos">Recent subscribers</span>
        <Badge className="ml-auto text-xs bg-acr-pos/10 text-acr-pos border-acr-pos/20">{newSubs.length} new</Badge>
      </div>
      <div className="space-y-2">
        {newSubs.map(alert => (
          <div key={alert.id} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos shrink-0" />
            <span className="flex-1 truncate">{alert.message}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {relative(alert.createdAt!)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
