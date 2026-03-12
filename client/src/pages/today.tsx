import { PageShell } from "@/components/page-shell";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  Map,
  Banknote,
  GitBranch,
  ArrowRight,
  Sun,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Calendar,
  Clock,
  X,
  Target,
  Sparkles,
  Moon,
  Zap,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Flame,
  BarChart3,
} from "lucide-react";
import { format, isToday, isBefore, startOfDay, subDays } from "date-fns";

interface GoalWithProgress {
  id: number;
  label: string;
  goalType: string;
  targetValue: string;
  periodStart: string;
  periodEnd: string;
  currentValue: number;
  progressPct: number;
  isActive: boolean;
}

interface NextBestAction {
  id: string;
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
}

interface TodayPriority {
  id: string;
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  count?: number;
}

interface TodayPrioritiesData {
  priorities: TodayPriority[];
  generatedAt: string;
  meta: { unscoredLeads: number; staleFollowUps: number; lastCampaignDaysAgo: number };
}

interface DashboardIntelligence {
  actions: NextBestAction[];
}

interface Task {
  id: number;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  entityType?: string;
  entityId?: number;
}

interface SystemAlert {
  id: number;
  type: string;
  severity: string; // info | warning | critical
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

interface AtlasObservation {
  id: number;
  type: string;
  severity: string; // high | medium | low | info
  title: string;
  description: string;
  metadata: Record<string, any> | null;
  createdAt: string | null;
}

interface AtlasStaleLead {
  id: number;
  firstName: string;
  lastName: string;
  daysSinceContact: number;
}

interface AtlasExpiringOffer {
  id: number;
  title: string;
  offerExpiresAt: string | null;
  leadName: string;
}

interface AtlasInsights {
  observations: AtlasObservation[];
  staleLeads: AtlasStaleLead[];
  expiringOffers: AtlasExpiringOffer[];
  generatedAt: string;
}

interface SophieSuggestion {
  id: string;
  suggestion: string;
  rationale: string;
  action: string;
  actionLabel: string;
  actionUrl: string;
  entityId?: number;
  entityType?: string;
  confidence: number;
}

interface SophieSuggestionsResponse {
  suggestions: SophieSuggestion[];
  generatedAt: string;
}

const alertHrefByType: Record<string, string> = {
  note_overdue: "/money",
  stale_leads: "/pipeline#leads",
  stuck_deals: "/pipeline#board",
  stale_avm: "/pipeline#properties",
};

const alertLinkLabelByType: Record<string, string> = {
  note_overdue: "View Notes",
  stale_leads: "View Leads",
  stuck_deals: "View Deals",
  stale_avm: "View Properties",
};

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};


export default function TodayPage() {
  const { data: organization } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    staleTime: 2 * 60 * 1000,
  });
  const { data: systemAlerts = [], isLoading: alertsLoading } = useQuery<SystemAlert[]>({
    queryKey: ["/api/alerts/active"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: activeGoals = [] } = useQuery<GoalWithProgress[]>({
    queryKey: ["/api/goals"],
    staleTime: 5 * 60 * 1000,
    select: (data) => data.filter((g) => g.isActive),
  });

  const { data: intelligence, isLoading: intelligenceLoading } =
    useQuery<DashboardIntelligence>({
      queryKey: ["/api/dashboard/intelligence"],
      staleTime: 5 * 60 * 1000,
    });

  const { data: atlasInsights, isLoading: atlasLoading } =
    useQuery<AtlasInsights>({
      queryKey: ["/api/atlas/insights"],
      staleTime: 5 * 60 * 1000,
    });

  // Epic J: "3 Things Today" AI-prioritized actions
  const { data: todayPriorities, isLoading: prioritiesLoading } =
    useQuery<TodayPrioritiesData>({
      queryKey: ["/api/dashboard/today-priorities"],
      staleTime: 10 * 60 * 1000,
    });

  const { data: sophieSuggestionsData, isLoading: sophieLoading } =
    useQuery<SophieSuggestionsResponse>({
      queryKey: ["/api/atlas/sophie-suggestions"],
      staleTime: 5 * 60 * 1000,
    });

  // Decision queue: derive pending count from leads + deals already fetched
  const { data: allDeals = [] } = useQuery<{ id: number; status: string; offerDate?: string; updatedAt?: string }[]>({
    queryKey: ["/api/deals"],
    staleTime: 5 * 60 * 1000,
  });

  const pendingDecisionCount = (() => {
    const nowTs = new Date();
    const stalledLeads = leads.filter((l: any) => {
      if (["closed", "dead", "converted"].includes(l.status)) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt) < subDays(nowTs, 14);
    }).length;
    const waitingCounters = allDeals.filter((d) => {
      if (d.status !== "offer_sent") return false;
      if (!d.offerDate) return false;
      return new Date(d.offerDate) < subDays(nowTs, 7);
    }).length;
    const stuckDeals = allDeals.filter((d) => {
      if (["closed", "cancelled", "offer_sent"].includes(d.status)) return false;
      if (!d.updatedAt) return false;
      return new Date(d.updatedAt) < subDays(nowTs, 14);
    }).length;
    return stalledLeads + waitingCounters + stuckDeals;
  })();

  const dismissMutation = useMutation({
    mutationFn: async (alertId: number) => {
      await apiRequest("DELETE", `/api/alerts/${alertId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
    },
  });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  // --- Today's Actions: tasks due today or overdue (not completed) ---
  const todayActions = tasks.filter((t) => {
    if (t.status === "completed" || t.status === "done") return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return isToday(due) || isBefore(due, startOfDay(new Date()));
  });

  const aiActions = intelligence?.actions?.slice(0, 5) ?? [];

  const atlasObservations = atlasInsights?.observations ?? [];
  const atlasStaleLeads = atlasInsights?.staleLeads ?? [];
  const atlasExpiringOffers = atlasInsights?.expiringOffers ?? [];
  const atlasItemCount = atlasObservations.length + atlasStaleLeads.length + atlasExpiringOffers.length;

  // ── Business Pulse derived metrics ──────────────────────────────────────────
  const activeDeals = allDeals.filter((d) => !["closed", "cancelled", "dead"].includes(d.status));
  const closedDealsThisMonth = allDeals.filter((d) => {
    if (d.status !== "closed") return false;
    if (!d.updatedAt) return false;
    const updatedAt = new Date(d.updatedAt);
    const now = new Date();
    return updatedAt.getMonth() === now.getMonth() && updatedAt.getFullYear() === now.getFullYear();
  });
  const pipelineValue = activeDeals.reduce((s: number, d: any) => s + Number(d.acceptedAmount || d.offerAmount || 0), 0);
  const closedRevenueThisMonth = closedDealsThisMonth.reduce((s: number, d: any) => s + Number(d.acceptedAmount || 0), 0);
  const avgWinProbability = activeDeals.length > 0
    ? Math.round(activeDeals.reduce((s: number, d: any) => {
        const prob = d.status === "accepted" ? 90 : d.status === "negotiating" ? 55 : d.status === "offer_sent" ? 35 : 20;
        return s + prob;
      }, 0) / activeDeals.length)
    : 0;
  const hotDeals = activeDeals.filter((d: any) => ["accepted", "in_escrow"].includes(d.status)).length;

  const pulseScore = Math.min(100, Math.round(
    (activeDeals.length > 0 ? 25 : 0) +
    (leads.filter((l: any) => !["closed", "dead"].includes(l.status)).length > 0 ? 20 : 0) +
    (todayActions.length === 0 ? 20 : Math.max(0, 20 - todayActions.length * 4)) +
    (hotDeals > 0 ? 20 : 0) +
    (closedRevenueThisMonth > 0 ? 15 : 0)
  ));

  const pulseLabel = pulseScore >= 80 ? "Firing" : pulseScore >= 55 ? "Active" : pulseScore >= 30 ? "Building" : "Warming Up";
  const pulseColor = pulseScore >= 80 ? "text-emerald-600" : pulseScore >= 55 ? "text-amber-500" : pulseScore >= 30 ? "text-blue-500" : "text-muted-foreground";
  const pulseBg = pulseScore >= 80 ? "from-emerald-50 to-emerald-100/50 border-emerald-200 dark:from-emerald-900/20 dark:to-emerald-900/10 dark:border-emerald-800" :
                  pulseScore >= 55 ? "from-amber-50 to-amber-100/50 border-amber-200 dark:from-amber-900/20 dark:to-amber-900/10 dark:border-amber-800" :
                  "from-blue-50 to-blue-100/50 border-blue-200 dark:from-blue-900/20 dark:to-blue-900/10 dark:border-blue-800";

  const sophieSuggestions = sophieSuggestionsData?.suggestions ?? [];

  return (
    <PageShell>
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sun className="w-5 h-5 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-today-title">
            {greeting()}{organization?.name ? `, ${organization.name}` : ""}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {format(new Date(), "EEEE, MMMM d, yyyy")} — here's what needs your attention today.
        </p>
        {pendingDecisionCount > 0 && (
          <Link href="/decision-queue">
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 text-sm text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer">
              <Clock className="w-4 h-4" />
              <span className="font-medium">{pendingDecisionCount} pending decision{pendingDecisionCount !== 1 ? "s" : ""}</span>
              <Badge variant="destructive" className="text-xs px-1.5 py-0">{pendingDecisionCount}</Badge>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        )}
      </div>

      {/* Business Pulse — live business momentum snapshot */}
      <div data-testid="section-business-pulse">
        <div className={`rounded-xl border bg-gradient-to-br ${pulseBg} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 ${pulseColor}`} />
              <span className="font-semibold text-sm">Business Pulse</span>
              <Badge variant="outline" className={`text-xs ${pulseColor} border-current`}>
                {pulseLabel}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${pulseScore >= 55 ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-xs text-muted-foreground">{pulseScore}/100</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Pipeline</span>
              </div>
              <p className="text-lg font-bold text-foreground">
                {pipelineValue >= 1_000_000
                  ? `$${(pipelineValue / 1_000_000).toFixed(1)}M`
                  : pipelineValue >= 1000
                  ? `$${(pipelineValue / 1000).toFixed(0)}K`
                  : pipelineValue > 0 ? `$${pipelineValue}` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">{activeDeals.length} active deals</p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Hot Deals</span>
              </div>
              <p className="text-lg font-bold text-foreground">{hotDeals}</p>
              <p className="text-[10px] text-muted-foreground">accepted/in escrow</p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <BarChart3 className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Win Prob</span>
              </div>
              <p className="text-lg font-bold text-foreground">
                {avgWinProbability > 0 ? `${avgWinProbability}%` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">across pipeline</p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">This Month</span>
              </div>
              <p className="text-lg font-bold text-foreground">
                {closedRevenueThisMonth >= 1_000_000
                  ? `$${(closedRevenueThisMonth / 1_000_000).toFixed(1)}M`
                  : closedRevenueThisMonth >= 1000
                  ? `$${(closedRevenueThisMonth / 1000).toFixed(0)}K`
                  : closedRevenueThisMonth > 0 ? `$${closedRevenueThisMonth}` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">{closedDealsThisMonth.length} closed</p>
            </div>
          </div>
          {/* Pulse progress bar */}
          <div className="mt-3">
            <div className="w-full bg-background/60 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  pulseScore >= 80 ? "bg-emerald-500" : pulseScore >= 55 ? "bg-amber-500" : "bg-blue-500"
                }`}
                style={{ width: `${pulseScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Epic J: Section 0 — Start Here Today (3 AI-prioritized actions) */}
      <div data-testid="section-start-here-today">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h2 className="text-lg font-semibold">Start Here Today</h2>
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
              AI
            </Badge>
          </div>
          <Link href="/night-cap">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              <Moon className="w-3 h-3" /> Night Cap
            </Button>
          </Link>
        </div>

        {prioritiesLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (todayPriorities?.priorities ?? []).length > 0 ? (
          <div className="space-y-2">
            {(todayPriorities?.priorities ?? []).map((priority, idx) => (
              <Card key={priority.id} className={`hover:shadow-md transition-shadow ${idx === 0 ? "border-amber-200 dark:border-amber-800" : ""}`}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${idx === 0 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">{priority.title}</span>
                      <Badge variant="secondary" className={priorityColors[priority.priority]}>
                        {priority.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{priority.description}</p>
                  </div>
                  <Button asChild size="sm" variant={idx === 0 ? "default" : "outline"} className="shrink-0 text-xs">
                    <Link href={priority.actionUrl}>{priority.actionLabel}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-muted-foreground">All caught up! No priority actions right now.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Section 1: Today's Actions (tasks due today or overdue) */}
      <div data-testid="section-todays-actions">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Today's Actions</h2>
            {todayActions.length > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                {todayActions.length}
              </Badge>
            )}
          </div>
          <Link href="/pipeline">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              All Tasks <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {tasksLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : todayActions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-muted-foreground">No tasks due today. You're ahead of schedule.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {todayActions.map((task) => {
              const isOverdue = task.dueDate && isBefore(new Date(task.dueDate), startOfDay(new Date()));
              return (
                <Card key={task.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="flex items-center gap-4 py-3 px-4">
                    <Clock className={`w-4 h-4 shrink-0 ${isOverdue ? "text-red-500" : "text-amber-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{task.title}</span>
                        {task.priority && (
                          <Badge variant="secondary" className={`${priorityColors[task.priority] ?? ""} text-xs`}>
                            {task.priority}
                          </Badge>
                        )}
                        {isOverdue && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">overdue</Badge>
                        )}
                      </div>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground">
                          Due {format(new Date(task.dueDate), "MMM d")}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Portfolio Health Alerts */}
      {!alertsLoading && systemAlerts.length > 0 && (
        <div data-testid="section-alerts">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-amber-500" />
            <h2 className="text-lg font-semibold">Portfolio Alerts</h2>
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
              {systemAlerts.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {systemAlerts.map((alert) => {
              const isCritical = alert.severity === "critical";
              const isWarning = alert.severity === "warning";
              const borderClass = isCritical
                ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                : isWarning
                ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20";
              const iconClass = isCritical ? "text-red-500" : isWarning ? "text-amber-500" : "text-blue-500";
              const href = alertHrefByType[alert.type] ?? "/";
              const linkLabel = alertLinkLabelByType[alert.type] ?? "View";
              return (
                <div key={alert.id} className={`flex items-start gap-3 rounded-lg border p-3 ${borderClass}`}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={href}>
                      <Button variant="outline" size="sm" className="text-xs h-7">{linkLabel}</Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => dismissMutation.mutate(alert.id)}
                      disabled={dismissMutation.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 2b: Atlas Noticed */}
      {!atlasLoading && atlasItemCount > 0 && (
        <div data-testid="section-atlas-noticed">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <h2 className="text-lg font-semibold">Atlas Noticed</h2>
              <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 text-xs">
                AI
              </Badge>
              {atlasItemCount > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                  {atlasItemCount}
                </Badge>
              )}
            </div>
            <Link href="/atlas#insights">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>

          <div className="space-y-2">
            {/* Observation cards */}
            {atlasObservations.map((obs) => {
              const isHigh = obs.severity === "high";
              const isMedium = obs.severity === "medium";
              const isLow = obs.severity === "low";
              const borderClass = isHigh
                ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                : isMedium
                ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                : isLow
                ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
                : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/20";
              const badgeClass = isHigh
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : isMedium
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : isLow
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
              return (
                <div key={`obs-${obs.id}`} className={`flex items-start gap-3 rounded-lg border p-3 ${borderClass}`}>
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-violet-500" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{obs.title}</p>
                      <Badge variant="secondary" className={`text-xs ${badgeClass}`}>
                        {obs.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{obs.description}</p>
                  </div>
                </div>
              );
            })}

            {/* Stale lead cards */}
            {atlasStaleLeads.map((lead) => (
              <div key={`stale-${lead.id}`} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {lead.firstName} {lead.lastName} hasn't been contacted
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lead.daysSinceContact >= 999 ? "Never contacted" : `${lead.daysSinceContact} days since last contact`}
                  </p>
                </div>
                <Link href="/leads">
                  <Button variant="outline" size="sm" className="text-xs h-7 shrink-0">Follow Up</Button>
                </Link>
              </div>
            ))}

            {/* Expiring offer cards */}
            {atlasExpiringOffers.map((offer) => (
              <div key={`offer-${offer.id}`} className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{offer.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Offer expires {offer.offerExpiresAt ? format(new Date(offer.offerExpiresAt), "MMM d, h:mm a") : "soon"}
                  </p>
                </div>
                <Link href="/deals">
                  <Button variant="outline" size="sm" className="text-xs h-7 shrink-0">View Deal</Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2c: Sophie Suggests */}
      <div data-testid="section-sophie-suggests">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            <h2 className="text-lg font-semibold">Sophie Suggests</h2>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs">
              AI
            </Badge>
          </div>
          <Link href="/leads">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              All Leads <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {sophieLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : sophieSuggestions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-muted-foreground">No proactive suggestions right now. Sophie is monitoring your pipeline.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sophieSuggestions.map((s) => {
              const confidencePct = Math.round(s.confidence * 100);
              const confBadgeClass = confidencePct >= 85
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : confidencePct >= 70
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
              return (
                <Card key={s.id} className="hover:shadow-sm transition-shadow border-emerald-100 dark:border-emerald-900/30">
                  <CardContent className="flex items-start gap-4 py-3 px-4">
                    <Sparkles className="w-4 h-4 shrink-0 mt-1 text-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-medium text-sm">{s.suggestion}</span>
                        <Badge variant="secondary" className={`text-xs ${confBadgeClass}`}>
                          {confidencePct}% confidence
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.rationale}</p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0 text-xs h-8 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-900/20">
                      <Link href={s.actionUrl}>{s.actionLabel}</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Goal Progress */}
      {activeGoals.length > 0 && (
        <div data-testid="section-goals">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Goal Progress</h2>
              <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                {activeGoals.length}
              </Badge>
            </div>
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                Manage Goals <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeGoals.map((goal) => (
              <Card key={goal.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate">{goal.label}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">
                      {goal.progressPct}%
                    </span>
                  </div>
                  <Progress value={goal.progressPct} className="h-2 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {typeof goal.currentValue === "number" && goal.goalType === "revenue_earned"
                      ? `$${goal.currentValue.toLocaleString()} of $${Number(goal.targetValue).toLocaleString()}`
                      : `${goal.currentValue} of ${Number(goal.targetValue)}`}
                    {" · "}ends {format(new Date(goal.periodEnd), "MMM d, yyyy")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Section 4: AI Action Queue */}
      <div data-testid="section-ai-actions">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">AI Action Queue</h2>
          </div>
          <Link href="/pipeline">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View Pipeline <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {intelligenceLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : aiActions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-muted-foreground">You're all caught up! No AI-suggested actions right now.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {aiActions.map((action) => (
              <Card key={action.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{action.title}</span>
                      <Badge variant="secondary" className={priorityColors[action.priority]}>
                        {action.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={action.actionUrl}>{action.actionLabel}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Section 4: KPI Stats */}
      <div data-testid="section-stats">
        <h2 className="text-lg font-semibold mb-3">Portfolio Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5" data-testid="stats-grid">
          <StatCard
            title="Active Leads"
            value={statsLoading ? "-" : stats?.activeLeads ?? leads.length}
            icon={Users}
            trend={`${leads.filter((l) => l.status === "new").length} new`}
            color="terracotta"
            data-testid="stat-active-leads"
          />
          <StatCard
            title="Properties"
            value={statsLoading ? "-" : stats?.activeProperties ?? properties.length}
            icon={Map}
            trend={`${properties.filter((p) => p.status === "owned").length} owned`}
            color="sage"
            data-testid="stat-properties"
          />
          <StatCard
            title="Active Notes"
            value={statsLoading ? "-" : stats?.activeNotes ?? 0}
            icon={Banknote}
            color="terracotta"
            data-testid="stat-active-notes"
          />
          <StatCard
            title="Open Deals"
            value={statsLoading ? "-" : stats?.activeDeals ?? 0}
            icon={GitBranch}
            color="sage"
            data-testid="stat-open-deals"
          />
        </div>
      </div>
    </PageShell>
  );
}
