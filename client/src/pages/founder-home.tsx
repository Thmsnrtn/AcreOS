import { PageShell } from "@/components/page-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  DollarSign,
  Users,
  Smile,
  Frown,
  Meh,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Bot,
  Clock,
  Sparkles,
  Sun,
  Moon,
  Sunset,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────

interface ExecutiveMetrics {
  mrr: number;
  activeOrganizations: number;
  nps: { score: number };
  churnRate: number;
  churnedOrgsLast30Days: number;
  newOrgsLast30Days: number;
}

interface ActionQueueItem {
  id: string;
  type: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  suggestedAction: string;
  data: Record<string, unknown>;
}

interface ActionQueueData {
  items: ActionQueueItem[];
  totalEstimatedMinutes: number;
  counts: { critical: number; high: number; medium: number };
}

interface AgentHealth {
  name: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "disabled";
  lastRun: string | null;
  lastError: string | null;
  runCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

const AGENT_FRIENDLY_NAMES: Record<string, string> = {
  customer_success: "Customer Success",
  growth: "Growth Engine",
  revenue: "Revenue Optimizer",
  operations: "Operations Monitor",
  digest: "Daily Digest",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getGreeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", Icon: Sun };
  if (hour < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

function getActionLabel(type: string): string {
  const map: Record<string, string> = {
    support_escalation: "Review",
    feature_request: "Review",
    dunning_critical: "Review",
    expiring_trial: "Review",
    inactive_campaign: "Review",
  };
  return map[type] || "Review";
}

// ── Data Hooks ───────────────────────────────────────────────────────

function useMetrics() {
  return useQuery<ExecutiveMetrics>({
    queryKey: ["/api/founder/executive-dashboard"],
    staleTime: 1000 * 60 * 2,
  });
}

function useActionQueue() {
  return useQuery<ActionQueueData>({
    queryKey: ["/api/founder/action-queue"],
    staleTime: 1000 * 60 * 5,
  });
}

function useAgents() {
  return useQuery<AgentHealth[]>({
    queryKey: ["/api/admin/agents/status"],
    refetchInterval: 10000,
  });
}

// ── Skeletons ────────────────────────────────────────────────────────

function HeroSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-5 w-64" />
      </CardContent>
    </Card>
  );
}

function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <Skeleton className="h-4 w-4 mb-3 rounded" />
        <Skeleton className="h-3 w-24 mb-2" />
        <Skeleton className="h-7 w-16 mb-1" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

function ActionSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-16 rounded" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AgentSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </CardContent>
    </Card>
  );
}

// ── Section Components ───────────────────────────────────────────────

function HeroCard({
  metrics,
  actionCount,
}: {
  metrics: ExecutiveMetrics | undefined;
  actionCount: number;
}) {
  const { text, Icon } = getGreeting();

  const hasErrors = actionCount > 0;
  const hasCritical =
    metrics && (metrics.churnRate > 10 || metrics.nps.score < 20);

  let statusText = "Everything is running smoothly";
  let statusColor = "text-emerald-600";
  let statusBg = "bg-emerald-50 dark:bg-emerald-950/30";

  if (hasCritical) {
    statusText = "Action required";
    statusColor = "text-red-600";
    statusBg = "bg-red-50 dark:bg-red-950/30";
  } else if (hasErrors) {
    statusText = `${actionCount} item${actionCount !== 1 ? "s" : ""} need${actionCount === 1 ? "s" : ""} your attention`;
    statusColor = "text-amber-600";
    statusBg = "bg-amber-50 dark:bg-amber-950/30";
  }

  return (
    <motion.div variants={staggerItem}>
      <Card className={statusBg}>
        <CardContent className="p-6 flex items-center gap-4">
          <Icon className={`h-8 w-8 ${statusColor} shrink-0`} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{text}</h1>
            <p className={`text-sm font-medium ${statusColor}`}>
              {statusText}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function MetricCards({ metrics }: { metrics: ExecutiveMetrics }) {
  const npsScore = metrics.nps.score;
  const NpsIcon = npsScore > 50 ? Smile : npsScore >= 20 ? Meh : Frown;
  const npsColor =
    npsScore > 50
      ? "text-emerald-600"
      : npsScore >= 20
        ? "text-amber-600"
        : "text-red-600";

  const cards = [
    {
      icon: DollarSign,
      label: "Monthly Revenue",
      value: formatCurrency(metrics.mrr),
      trend: null,
      iconColor: "text-emerald-600",
    },
    {
      icon: Users,
      label: "Active Customers",
      value: metrics.activeOrganizations.toLocaleString(),
      trend:
        metrics.newOrgsLast30Days > 0
          ? { up: true, text: `+${metrics.newOrgsLast30Days} this month` }
          : null,
      iconColor: "text-blue-600",
    },
    {
      icon: NpsIcon,
      label: "Customer Satisfaction",
      value: `${npsScore}`,
      trend: null,
      iconColor: npsColor,
    },
    {
      icon: AlertTriangle,
      label: "Churn Risk",
      value: `${metrics.churnedOrgsLast30Days} customer${metrics.churnedOrgsLast30Days !== 1 ? "s" : ""} at risk`,
      trend:
        metrics.churnRate > 0
          ? { up: false, text: `${metrics.churnRate}% churn rate` }
          : null,
      iconColor: metrics.churnedOrgsLast30Days > 0 ? "text-red-600" : "text-emerald-600",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <motion.div key={card.label} variants={staggerItem}>
          <Card className="h-full">
            <CardContent className="p-5">
              <card.icon className={`h-5 w-5 mb-3 ${card.iconColor}`} />
              <p className="text-sm text-muted-foreground mb-1">
                {card.label}
              </p>
              <p className="text-2xl font-bold text-foreground">{card.value}</p>
              {card.trend && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {card.trend.up ? (
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  {card.trend.text}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function AttentionQueue({ data }: { data: ActionQueueData }) {
  const items = data.items.slice(0, 8);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All clear!"
        description="Your platform is humming along. Nothing needs your attention right now."
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <motion.div key={item.id} variants={staggerItem}>
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.title}
                  </p>
                  {item.priority === "critical" && (
                    <Badge variant="destructive" className="text-xs shrink-0">
                      Urgent
                    </Badge>
                  )}
                  {item.priority === "high" && (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 shrink-0"
                    >
                      Important
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {item.description}
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0">
                {getActionLabel(item.type)}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function AgentCards({ agents }: { agents: AgentHealth[] }) {
  const queryClient = useQueryClient();
  const [pendingAgent, setPendingAgent] = useState<{
    name: string;
    enabled: boolean;
  } | null>(null);

  const toggleMutation = useMutation({
    mutationFn: async ({
      name,
      enabled,
    }: {
      name: string;
      enabled: boolean;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/agents/${name}/toggle`,
        { enabled },
      );
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/agents/status"],
      }),
  });

  const statusConfig = {
    idle: { label: "Running", color: "bg-emerald-500" },
    running: { label: "Running", color: "bg-blue-500 animate-pulse" },
    error: { label: "Error", color: "bg-red-500" },
    disabled: { label: "Paused", color: "bg-muted-foreground" },
  };

  function getAgentSummary(agent: AgentHealth): string {
    if (agent.status === "error" && agent.lastError) return agent.lastError;
    if (agent.status === "disabled") return "Paused by you";
    if (agent.lastRun) {
      const ago = formatDistanceToNow(new Date(agent.lastRun), {
        addSuffix: true,
      });
      return `Last ran ${ago} — ${agent.runCount} total runs`;
    }
    return "Has not run yet";
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents configured"
        description="Autonomous agents will appear here once they are set up."
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => {
          const status = statusConfig[agent.status] ?? statusConfig.disabled;
          const friendlyName =
            AGENT_FRIENDLY_NAMES[agent.name] ?? agent.name;

          return (
            <motion.div key={agent.name} variants={staggerItem}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${status.color}`}
                      />
                      <h3 className="text-sm font-medium text-foreground">
                        {friendlyName}
                      </h3>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <div>
                          <Switch
                            checked={agent.enabled}
                            onCheckedChange={() =>
                              setPendingAgent({
                                name: agent.name,
                                enabled: !agent.enabled,
                              })
                            }
                            aria-label={`Toggle ${friendlyName}`}
                          />
                        </div>
                      </AlertDialogTrigger>
                      {pendingAgent?.name === agent.name && (
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {pendingAgent.enabled ? "Enable" : "Disable"}{" "}
                              {friendlyName}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {pendingAgent.enabled
                                ? `This will resume automated actions for ${friendlyName}.`
                                : `This will pause all automated actions for ${friendlyName} until you turn it back on.`}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel
                              onClick={() => setPendingAgent(null)}
                            >
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                toggleMutation.mutate(pendingAgent);
                                setPendingAgent(null);
                              }}
                            >
                              {pendingAgent.enabled ? "Enable" : "Disable"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      )}
                    </AlertDialog>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {getAgentSummary(agent)}
                  </p>
                  <Badge
                    variant="secondary"
                    className="mt-2 text-xs"
                  >
                    {status.label}
                  </Badge>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function FounderHome() {
  const metrics = useMetrics();
  const actions = useActionQueue();
  const agents = useAgents();

  const isAnyError = metrics.isError || actions.isError || agents.isError;
  const isLoading = metrics.isLoading && actions.isLoading && agents.isLoading;

  if (isAnyError) {
    return (
      <PageShell label="Founder Home">
        <QueryErrorState
          error={metrics.error || actions.error || agents.error}
          onRetry={() => {
            metrics.refetch();
            actions.refetch();
            agents.refetch();
          }}
          title="Could not load your dashboard"
          description="Something went wrong loading your data. Please try again."
        />
      </PageShell>
    );
  }

  return (
    <PageShell label="Founder Home" isLoading={isLoading}>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-8 max-w-5xl mx-auto"
      >
        {/* Section 1: Greeting */}
        {metrics.isLoading ? (
          <HeroSkeleton />
        ) : (
          <HeroCard
            metrics={metrics.data}
            actionCount={actions.data?.items.length ?? 0}
          />
        )}

        {/* Section 2: Business Metrics */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Your Business Today
          </h2>
          {metrics.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <MetricCardSkeleton key={i} />
              ))}
            </div>
          ) : metrics.data ? (
            <MetricCards metrics={metrics.data} />
          ) : null}
        </section>

        {/* Section 3: Attention Queue */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Needs Your Attention
          </h2>
          {actions.isLoading ? (
            <ActionSkeleton />
          ) : actions.data ? (
            <AttentionQueue data={actions.data} />
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="All clear!"
              description="Your platform is humming along. Nothing needs your attention right now."
            />
          )}
        </section>

        {/* Section 4: Agent Team */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            Your Automation Team
          </h2>
          {agents.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <AgentSkeleton key={i} />
              ))}
            </div>
          ) : agents.data ? (
            <AgentCards agents={agents.data} />
          ) : null}
        </section>
      </motion.div>
    </PageShell>
  );
}
