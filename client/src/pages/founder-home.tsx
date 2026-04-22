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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  DollarSign, Users, Smile, Frown, Meh, AlertTriangle, TrendingUp,
  TrendingDown, CheckCircle2, Bot, Clock, Sparkles, Sun, Moon, Sunset,
  ShieldCheck, ShieldAlert, ShieldX,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { relative } from "@/lib/format";
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

type Band = "green" | "yellow" | "red";

interface AutonomyHealthReport {
  generatedAt: string;
  band: Band;
  verdict: string;
  dimensions: Record<string, { band: Band; value: number | string; threshold: string; note: string }>;
  recommendedAction: string;
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

const AGENT_NAMES: Record<string, string> = {
  customer_success: "Customer Success", growth: "Growth Engine",
  revenue: "Revenue Optimizer", operations: "Operations Monitor", digest: "Daily Digest",
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  idle: { label: "Running", color: "bg-emerald-500" },
  running: { label: "Running", color: "bg-blue-500 animate-pulse" },
  error: { label: "Error", color: "bg-red-500" },
  disabled: { label: "Paused", color: "bg-muted-foreground" },
};

function fmtCurrency(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning", Icon: Sun };
  if (h < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

// ── Data Hooks ───────────────────────────────────────────────────────

const useMetrics = () => useQuery<ExecutiveMetrics>({ queryKey: ["/api/founder/executive-dashboard"], staleTime: 120_000 });
const useActionQueue = () => useQuery<ActionQueueData>({ queryKey: ["/api/founder/action-queue"], staleTime: 300_000 });
const useAgents = () => useQuery<AgentHealth[]>({ queryKey: ["/api/admin/agents/status"], refetchInterval: 10_000 });
const useAutonomyHealth = () =>
  useQuery<AutonomyHealthReport>({ queryKey: ["/api/founder/intelligence/autonomy-health"], staleTime: 60_000 });
const useFounderTodo = () =>
  useQuery<{ total: number; items: Array<{ type: string; id: number; title: string; subtitle: string; urgency: number; actionUrl: string; createdAt: string; badge?: string; estimatedImpactCents: number | null }> }>({
    queryKey: ["/api/founder/intelligence/todo"],
    staleTime: 60_000,
  });

// ── Section 1c: What needs you ───────────────────────────────────────

function WhatNeedsYouCard({
  data,
}: {
  data: ReturnType<typeof useFounderTodo>["data"];
}) {
  const top5 = (data?.items ?? []).slice(0, 5);
  if (top5.length === 0) {
    return (
      <motion.div variants={staggerItem}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Inbox zero</h2>
              <p className="text-sm text-muted-foreground">
                Nothing is waiting on you right now. The system is running itself.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }
  const urgencyTint = (u: number) =>
    u >= 70 ? "border-l-red-500" : u >= 50 ? "border-l-amber-500" : "border-l-muted";
  return (
    <motion.div variants={staggerItem}>
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-border flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              What needs you ({data?.total ?? 0})
            </h2>
            <a href="/founder/todo" className="text-xs text-muted-foreground hover:text-foreground">
              See all →
            </a>
          </div>
          <ul>
            {top5.map((item) => (
              <li key={`${item.type}-${item.id}`} className="border-b border-border last:border-b-0">
                <a
                  href={item.actionUrl}
                  className={`flex items-start gap-3 p-3 hover:bg-muted/40 transition border-l-4 ${urgencyTint(item.urgency)}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {item.type.replace(/_/g, " ")}
                      {item.badge ? ` · ${item.badge}` : ""}
                      {item.estimatedImpactCents != null && item.estimatedImpactCents !== 0
                        ? ` · ${item.estimatedImpactCents > 0 ? "+" : ""}$${Math.abs(item.estimatedImpactCents / 100).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
                    {item.urgency}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Section 1b: Autonomy Health ──────────────────────────────────────

function AutonomyHealthCard({ report }: { report: AutonomyHealthReport }) {
  const bandCfg: Record<Band, { bg: string; text: string; Icon: typeof ShieldCheck; label: string }> = {
    green: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400", Icon: ShieldCheck, label: "Autonomous" },
    yellow: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-500", Icon: ShieldAlert, label: "Needs a look" },
    red: { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400", Icon: ShieldX, label: "Intervene now" },
  };
  const cfg = bandCfg[report.band];
  const dims = Object.entries(report.dimensions);
  return (
    <motion.div variants={staggerItem}>
      <Card className={cfg.bg}>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <cfg.Icon className={`h-8 w-8 ${cfg.text} shrink-0`} aria-label={`Autonomy status: ${cfg.label}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className={`text-lg font-semibold ${cfg.text}`}>Autonomy: {cfg.label}</h2>
                <Badge variant="secondary" className="text-xs">{report.band.toUpperCase()}</Badge>
              </div>
              <p className="text-sm text-foreground mb-2">{report.verdict}</p>
              <p className="text-xs text-muted-foreground">{report.recommendedAction}</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
                {dims.map(([key, d]) => {
                  const dotColor =
                    d.band === "green" ? "bg-emerald-500" : d.band === "yellow" ? "bg-amber-500" : "bg-red-500";
                  return (
                    <div key={key} className="flex items-start gap-2" title={d.note}>
                      <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-foreground capitalize leading-tight">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">{String(d.value)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Section 1: Hero ──────────────────────────────────────────────────

function HeroCard({ metrics, actionCount }: { metrics?: ExecutiveMetrics; actionCount: number }) {
  const { text, Icon } = getGreeting();
  const hasCritical = metrics && (metrics.churnRate > 10 || metrics.nps.score < 20);
  let statusText = "Everything is running smoothly";
  let statusColor = "text-emerald-600";
  let statusBg = "bg-emerald-50 dark:bg-emerald-950/30";
  if (hasCritical) {
    statusText = "Action required"; statusColor = "text-red-600"; statusBg = "bg-red-50 dark:bg-red-950/30";
  } else if (actionCount > 0) {
    statusText = `${actionCount} item${actionCount !== 1 ? "s" : ""} need${actionCount === 1 ? "s" : ""} your attention`;
    statusColor = "text-amber-600"; statusBg = "bg-amber-50 dark:bg-amber-950/30";
  }
  return (
    <motion.div variants={staggerItem}>
      <Card className={statusBg}>
        <CardContent className="p-6 flex items-center gap-4">
          <Icon className={`h-8 w-8 ${statusColor} shrink-0`} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{text}</h1>
            <p className={`text-sm font-medium ${statusColor}`}>{statusText}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Section 2: Metrics ───────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: ExecutiveMetrics }) {
  const nps = metrics.nps.score;
  const NpsIcon = nps > 50 ? Smile : nps >= 20 ? Meh : Frown;
  const npsColor = nps > 50 ? "text-emerald-600" : nps >= 20 ? "text-amber-600" : "text-red-600";
  const cards = [
    { icon: DollarSign, label: "Monthly Revenue", value: fmtCurrency(metrics.mrr), iconColor: "text-emerald-600",
      trend: null as { up: boolean; text: string } | null },
    { icon: Users, label: "Active Customers", value: metrics.activeOrganizations.toLocaleString(), iconColor: "text-blue-600",
      trend: metrics.newOrgsLast30Days > 0 ? { up: true, text: `+${metrics.newOrgsLast30Days} this month` } : null },
    { icon: NpsIcon, label: "Customer Satisfaction", value: `${nps}`, iconColor: npsColor, trend: null },
    { icon: AlertTriangle, label: "Churn Risk",
      value: `${metrics.churnedOrgsLast30Days} customer${metrics.churnedOrgsLast30Days !== 1 ? "s" : ""} at risk`,
      iconColor: metrics.churnedOrgsLast30Days > 0 ? "text-red-600" : "text-emerald-600",
      trend: metrics.churnRate > 0 ? { up: false, text: `${metrics.churnRate}% churn rate` } : null },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <motion.div key={c.label} variants={staggerItem}>
          <Card className="h-full">
            <CardContent className="p-5">
              <c.icon className={`h-5 w-5 mb-3 ${c.iconColor}`} />
              <p className="text-sm text-muted-foreground mb-1">{c.label}</p>
              <p className="text-2xl font-bold text-foreground">{c.value}</p>
              {c.trend && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {c.trend.up ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : <TrendingDown className="h-3 w-3 text-red-500" />}
                  {c.trend.text}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ── Section 3: Attention Queue ───────────────────────────────────────

function AttentionQueue({ data }: { data: ActionQueueData }) {
  const items = data.items.slice(0, 8);
  if (items.length === 0) {
    return <EmptyState icon={CheckCircle2} title="All clear!" description="Your platform is humming along. Nothing needs your attention right now." />;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <motion.div key={item.id} variants={staggerItem}>
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                  {item.priority === "critical" && <Badge variant="destructive" className="text-xs shrink-0">Urgent</Badge>}
                  {item.priority === "high" && (
                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">Important</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{item.description}</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0">Review</Button>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ── Section 4: Agent Cards ───────────────────────────────────────────

function AgentCards({ agents }: { agents: AgentHealth[] }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ name: string; enabled: boolean } | null>(null);
  const toggle = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) =>
      (await apiRequest("POST", `/api/admin/agents/${name}/toggle`, { enabled })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/agents/status"] }),
  });

  function summary(a: AgentHealth) {
    if (a.status === "error" && a.lastError) return a.lastError;
    if (a.status === "disabled") return "Paused by you";
    if (a.lastRun) return `Last ran ${relative(a.lastRun)}`;
    return "Has not run yet";
  }

  if (agents.length === 0) return <EmptyState icon={Bot} title="No agents configured" description="Autonomous agents will appear here once set up." />;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {agents.map((agent) => {
        const st = STATUS_CFG[agent.status] ?? STATUS_CFG.disabled;
        const friendly = AGENT_NAMES[agent.name] ?? agent.name;
        return (
          <motion.div key={agent.name} variants={staggerItem}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${st.color}`} />
                    <h3 className="text-sm font-medium text-foreground">{friendly}</h3>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <div><Switch checked={agent.enabled} onCheckedChange={() => setPending({ name: agent.name, enabled: !agent.enabled })} aria-label={`Toggle ${friendly}`} /></div>
                    </AlertDialogTrigger>
                    {pending?.name === agent.name && (
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{pending.enabled ? "Enable" : "Disable"} {friendly}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {pending.enabled ? `This will resume automated actions for ${friendly}.` : `This will pause all automated actions for ${friendly} until you turn it back on.`}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setPending(null)}>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => { toggle.mutate(pending); setPending(null); }}>
                            {pending.enabled ? "Enable" : "Disable"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    )}
                  </AlertDialog>
                </div>
                <p className="text-xs text-muted-foreground">{summary(agent)}</p>
                <Badge variant="secondary" className="mt-2 text-xs">{st.label}</Badge>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Skeletons ────────────────────────────────────────────────────────

const Skel = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <Card className={className}><CardContent className="p-5">{children}</CardContent></Card>
);

// ── Main Page ────────────────────────────────────────────────────────

export default function FounderHome() {
  const metrics = useMetrics();
  const actions = useActionQueue();
  const agents = useAgents();
  const autonomy = useAutonomyHealth();
  const todo = useFounderTodo();

  const isAnyError = metrics.isError || actions.isError || agents.isError;
  const allLoading = metrics.isLoading && actions.isLoading && agents.isLoading;

  if (isAnyError) {
    return (
      <PageShell label="Founder Home">
        <QueryErrorState
          error={metrics.error || actions.error || agents.error}
          onRetry={() => { metrics.refetch(); actions.refetch(); agents.refetch(); }}
          title="Could not load your dashboard"
          description="Something went wrong loading your data. Please try again."
        />
      </PageShell>
    );
  }

  return (
    <PageShell label="Founder Home" isLoading={allLoading}>
      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8 max-w-5xl mx-auto">
        {/* Section 1: Greeting */}
        {metrics.isLoading ? (
          <Skel><Skeleton className="h-8 w-48 mb-2" /><Skeleton className="h-5 w-64" /></Skel>
        ) : (
          <HeroCard metrics={metrics.data} actionCount={actions.data?.items.length ?? 0} />
        )}

        {/* Section 1b: Autonomy Health — single glance signal */}
        {autonomy.isLoading ? (
          <Skel><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-72" /></Skel>
        ) : autonomy.data ? (
          <AutonomyHealthCard report={autonomy.data} />
        ) : null}

        {/* Section 1c: What needs you — top-5 unified todos */}
        {todo.isLoading ? (
          <Skel><Skeleton className="h-5 w-32 mb-3" /><Skeleton className="h-12 w-full" /></Skel>
        ) : (
          <WhatNeedsYouCard data={todo.data} />
        )}

        {/* Section 2: Business Metrics */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />Your Business Today
          </h2>
          {metrics.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <Skel key={i}><Skeleton className="h-4 w-4 mb-3 rounded" /><Skeleton className="h-3 w-24 mb-2" /><Skeleton className="h-7 w-16" /></Skel>)}
            </div>
          ) : metrics.data ? <MetricCards metrics={metrics.data} /> : null}
        </section>

        {/* Section 3 (Attention Queue) was removed — the new
            WhatNeedsYouCard above (section 1c) supersedes it with a
            unified ranked feed across 7 inbox sources instead of one. */}

        {/* Section 4: Agent Team */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />Your Automation Team
          </h2>
          {agents.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => <Skel key={i}><div className="flex items-center justify-between"><div className="space-y-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div><Skeleton className="h-5 w-9 rounded-full" /></div></Skel>)}
            </div>
          ) : agents.data ? <AgentCards agents={agents.data} /> : null}
        </section>
      </motion.div>
    </PageShell>
  );
}
