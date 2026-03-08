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
} from "lucide-react";
import { format, isToday, isBefore, startOfDay } from "date-fns";

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
