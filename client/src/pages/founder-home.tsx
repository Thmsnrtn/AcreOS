import { PageShell } from "@/components/page-shell";
import { FounderPageShell } from "@/components/founder/founder-page-shell";
import "./today.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  TrendingDown, CheckCircle2, Bot, Sparkles, Sun, Moon, Sunset,
  ShieldCheck, ShieldAlert, ShieldX,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { relative, usd } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useState } from "react";

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

const AGENT_NAMES: Record<string, string> = {
  customer_success: "Customer success",
  growth: "Growth engine",
  revenue: "Revenue optimizer",
  operations: "Operations monitor",
  digest: "Daily digest",
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  idle: { label: "Running", color: "bg-emerald-500" },
  running: { label: "Running", color: "bg-blue-500 animate-pulse" },
  error: { label: "Error", color: "bg-red-500" },
  disabled: { label: "Paused", color: "bg-muted-foreground" },
};

const reassurance = "Your settings are unchanged — try again.";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning", Icon: Sun };
  if (h < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

// /api/founder/executive-dashboard now returns the full metric set
// matching the UI's ExecutiveMetrics interface — see server/routes.ts
// `app.get('/api/founder/executive-dashboard'...)`. The response shape
// is normalized through this select transform so any future field
// rename or temporary missing field still degrades gracefully to 0
// rather than crashing the page.
interface ExecutiveDashboardApiResponse {
  mrr?: number;
  activeOrganizations?: number;
  newOrgsLast30Days?: number;
  nps?: { score: number };
  churnRate?: number;
  churnedOrgsLast30Days?: number;
}

const useMetrics = () =>
  useQuery<ExecutiveMetrics, Error, ExecutiveMetrics>({
    queryKey: ["/api/founder/executive-dashboard"],
    staleTime: 120_000,
    select: (raw) => {
      const r = raw as unknown as ExecutiveDashboardApiResponse;
      return {
        mrr: r.mrr ?? 0,
        activeOrganizations: r.activeOrganizations ?? 0,
        nps: r.nps ?? { score: 0 },
        churnRate: r.churnRate ?? 0,
        churnedOrgsLast30Days: r.churnedOrgsLast30Days ?? 0,
        newOrgsLast30Days: r.newOrgsLast30Days ?? 0,
      };
    },
  });
const useActionQueue = () => useQuery<ActionQueueData>({ queryKey: ["/api/founder/action-queue"], staleTime: 300_000 });
const useAgents = () => useQuery<AgentHealth[]>({ queryKey: ["/api/admin/agents/status"], refetchInterval: 10_000 });
const useAutonomyHealth = () =>
  useQuery<AutonomyHealthReport>({ queryKey: ["/api/founder/intelligence/autonomy-health"], staleTime: 60_000 });
const useFounderTodo = () =>
  useQuery<{ total: number; items: Array<{ type: string; id: number; title: string; subtitle: string; urgency: number; actionUrl: string; createdAt: string; badge?: string; estimatedImpactCents: number | null }> }>({
    queryKey: ["/api/founder/intelligence/todo"],
    staleTime: 60_000,
  });

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
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
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
            <Link href="/founder/todo" className="text-xs text-muted-foreground hover:text-foreground">
              See all →
            </Link>
          </div>
          <ul aria-label="Top 5 items needing your attention">
            {top5.map((item) => {
              const impactCents = item.estimatedImpactCents;
              const impactLabel = impactCents != null && impactCents !== 0
                ? `${impactCents > 0 ? "+" : "−"}${usd(Math.abs(impactCents) / 100, { noCents: true })}`
                : null;
              return (
                <li key={`${item.type}-${item.id}`} className="border-b border-border last:border-b-0">
                  <a
                    href={item.actionUrl}
                    className={`flex items-start gap-3 p-3 hover:bg-muted/40 transition border-l-4 ${urgencyTint(item.urgency)}`}
                    aria-label={`${item.title} — urgency ${item.urgency}${impactLabel ? `, impact ${impactLabel}` : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {item.type.replace(/_/g, " ")}
                        {item.badge ? ` · ${item.badge}` : ""}
                        {impactLabel ? ` · ${impactLabel}` : ""}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-1 tabular-nums" aria-hidden="true">
                      {item.urgency}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}

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
                <Badge variant="secondary" className="text-xs" aria-label={`Band: ${report.band}`}>{report.band.toUpperCase()}</Badge>
              </div>
              <p className="text-sm text-foreground mb-2">{report.verdict}</p>
              <p className="text-xs text-muted-foreground">{report.recommendedAction}</p>
              <ul className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 list-none p-0" aria-label="Autonomy dimensions">
                {dims.map(([key, d]) => {
                  const dotColor =
                    d.band === "green" ? "bg-emerald-500" : d.band === "yellow" ? "bg-amber-500" : "bg-red-500";
                  const niceKey = key.replace(/([A-Z])/g, " $1").trim();
                  return (
                    <li
                      key={key}
                      className="flex items-start gap-2"
                      title={d.note}
                      aria-label={`${niceKey}: ${d.value}, band ${d.band}. ${d.note}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}
                        role="img"
                        aria-label={`Band: ${d.band}`}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-foreground capitalize leading-tight">
                          {niceKey}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate tabular-nums">{String(d.value)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HeroStatus({
  metrics,
  actionCount,
}: {
  metrics?: ExecutiveMetrics;
  actionCount: number;
}) {
  // Status pill — replaces the old HeroCard's bg-tinted card. The
  // greeting + identity now lives in FounderPageShell's editorial
  // header (eyebrow + title + soft clause). This is just the
  // operational health badge below.
  const hasCritical = metrics && (metrics.churnRate > 10 || metrics.nps.score < 20);
  let label: string;
  let tone: "pos" | "warn" | "neg";
  if (hasCritical) {
    label = "Action required";
    tone = "neg";
  } else if (actionCount > 0) {
    label = `${actionCount} item${actionCount !== 1 ? "s" : ""} need${actionCount === 1 ? "s" : ""} your attention`;
    tone = "warn";
  } else {
    label = "Everything is running smoothly";
    tone = "pos";
  }
  const color = tone === "neg" ? "var(--acr-neg)" : tone === "warn" ? "var(--acr-warn)" : "var(--acr-pos)";
  const bg =
    tone === "neg"
      ? "var(--acr-neg-soft)"
      : tone === "warn"
        ? "var(--acr-warn-soft)"
        : "var(--acr-pos-soft)";
  return (
    <motion.div
      variants={staggerItem}
      role="status"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        background: bg,
        color,
        font: "500 13px/1 var(--font-sans)",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </motion.div>
  );
}

function MetricCards({ metrics }: { metrics: ExecutiveMetrics }) {
  const nps = metrics.nps.score;
  const NpsIcon = nps > 50 ? Smile : nps >= 20 ? Meh : Frown;
  const npsColor = nps > 50 ? "text-emerald-600" : nps >= 20 ? "text-amber-600" : "text-red-600";
  const cards = [
    { icon: DollarSign, label: "Monthly revenue", value: usd(metrics.mrr, { noCents: true }), iconColor: "text-emerald-600",
      trend: null as { up: boolean; text: string } | null },
    { icon: Users, label: "Active customers", value: metrics.activeOrganizations.toLocaleString(), iconColor: "text-blue-600",
      trend: metrics.newOrgsLast30Days > 0 ? { up: true, text: `+${metrics.newOrgsLast30Days} this month` } : null },
    { icon: NpsIcon, label: "Customer satisfaction", value: `${nps}`, iconColor: npsColor, trend: null },
    { icon: AlertTriangle, label: "Churn risk",
      value: `${metrics.churnedOrgsLast30Days} customer${metrics.churnedOrgsLast30Days !== 1 ? "s" : ""} at risk`,
      iconColor: metrics.churnedOrgsLast30Days > 0 ? "text-red-600" : "text-emerald-600",
      trend: metrics.churnRate > 0 ? { up: false, text: `${metrics.churnRate}% churn rate` } : null },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <motion.div key={c.label} variants={staggerItem}>
          <Card className="h-full">
            <CardContent className="p-5">
              <c.icon className={`h-5 w-5 mb-3 ${c.iconColor}`} aria-hidden="true" />
              <dt className="text-sm text-muted-foreground mb-1">{c.label}</dt>
              <dd className="text-2xl font-bold text-foreground tabular-nums">{c.value}</dd>
              {c.trend && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {c.trend.up ? <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" /> : <TrendingDown className="h-3 w-3 text-red-500" aria-hidden="true" />}
                  <span className="tabular-nums">{c.trend.text}</span>
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </dl>
  );
}

function AgentCards({ agents }: { agents: AgentHealth[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<{ name: string; enabled: boolean } | null>(null);
  const toggle = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) =>
      (await apiRequest("POST", `/api/admin/agents/${name}/toggle`, { enabled })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/agents/status"] }),
    onError: (e: any) => toast({ title: "Couldn't toggle agent", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  function summary(a: AgentHealth) {
    if (a.status === "error" && a.lastError) return a.lastError;
    if (a.status === "disabled") return "Paused by you";
    if (a.lastRun) return `Last ran ${relative(a.lastRun)}`;
    return "Has not run yet";
  }

  if (agents.length === 0) return <EmptyState icon={Bot} title="No agents configured" description="Autonomous agents will appear here once set up." />;

  return (
    <ul className="grid gap-3 sm:grid-cols-2 list-none p-0 m-0" aria-label="Autonomous agents">
      {agents.map((agent) => {
        const st = STATUS_CFG[agent.status] ?? STATUS_CFG.disabled;
        const friendly = AGENT_NAMES[agent.name] ?? agent.name;
        return (
          <motion.li key={agent.name} variants={staggerItem}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${st.color}`}
                      role="img"
                      aria-label={`Status: ${st.label.toLowerCase()}`}
                    />
                    <h3 className="text-sm font-medium text-foreground">{friendly}</h3>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <div>
                        <Switch
                          checked={agent.enabled}
                          onCheckedChange={() => setPending({ name: agent.name, enabled: !agent.enabled })}
                          aria-label={`${agent.enabled ? "Pause" : "Enable"} agent: ${friendly}`}
                        />
                      </div>
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
                <Badge variant="secondary" className="mt-2 text-xs" aria-label={`Status: ${st.label}`}>{st.label}</Badge>
              </CardContent>
            </Card>
          </motion.li>
        );
      })}
    </ul>
  );
}

const Skel = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <Card className={className}><CardContent className="p-5">{children}</CardContent></Card>
);

export default function FounderHome() {
  useDocumentTitle("Founder home");
  const metrics = useMetrics();
  const actions = useActionQueue();
  const agents = useAgents();
  const autonomy = useAutonomyHealth();
  const todo = useFounderTodo();

  const isAnyError = metrics.isError || actions.isError || agents.isError;
  const allLoading = metrics.isLoading && actions.isLoading && agents.isLoading;

  if (isAnyError) {
    return (
      <PageShell label="Founder home">
        <QueryErrorState
          error={metrics.error || actions.error || agents.error}
          onRetry={() => { metrics.refetch(); actions.refetch(); agents.refetch(); }}
          title="Could not load your dashboard"
          description="Couldn't load your data. Try again, or reload the page."
        />
      </PageShell>
    );
  }

  const greeting = getGreeting();
  const actionCount = actions.data?.items.length ?? 0;
  const totalDeals = metrics.data?.activeOrganizations ?? 0;
  return (
    <FounderPageShell
      eyebrow="Founder · home"
      title={greeting.text}
      titleSoft={
        actionCount > 0
          ? `${actionCount} item${actionCount !== 1 ? "s" : ""} need attention.`
          : `${totalDeals.toLocaleString()} active customers · all green.`
      }
      pageTitle="Founder home"
    >
      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8 max-w-5xl mx-auto">
        {!metrics.isLoading && (
          <HeroStatus metrics={metrics.data} actionCount={actionCount} />
        )}

        {autonomy.isLoading ? (
          <Skel><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-72" /></Skel>
        ) : autonomy.data ? (
          <AutonomyHealthCard report={autonomy.data} />
        ) : null}

        {todo.isLoading ? (
          <Skel><Skeleton className="h-5 w-32 mb-3" /><Skeleton className="h-12 w-full" /></Skel>
        ) : (
          <WhatNeedsYouCard data={todo.data} />
        )}

        <section aria-labelledby="business-today-heading">
          <h2 id="business-today-heading" className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Your business today
          </h2>
          {metrics.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading business metrics">
              {[1, 2, 3, 4].map((i) => <Skel key={i}><Skeleton className="h-4 w-4 mb-3 rounded" /><Skeleton className="h-3 w-24 mb-2" /><Skeleton className="h-7 w-16" /></Skel>)}
            </div>
          ) : metrics.data ? <MetricCards metrics={metrics.data} /> : null}
        </section>

        <section aria-labelledby="automation-team-heading">
          <h2 id="automation-team-heading" className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Your automation team
          </h2>
          {agents.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Loading agents">
              {[1, 2, 3, 4].map((i) => <Skel key={i}><div className="flex items-center justify-between"><div className="space-y-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div><Skeleton className="h-5 w-9 rounded-full" /></div></Skel>)}
            </div>
          ) : agents.data ? <AgentCards agents={agents.data} /> : null}
        </section>
      </motion.div>
    </FounderPageShell>
  );
}
