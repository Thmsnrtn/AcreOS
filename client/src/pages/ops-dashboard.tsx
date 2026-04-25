import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  CheckSquare, FileText, UserX, TrendingUp,
  Loader2, AlertCircle, ChevronRight, Clock,
} from "lucide-react";
import { format, isAfter, subDays, addDays } from "date-fns";
import { relative } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";

interface Task {
  id: number;
  title: string;
  dueDate?: string;
  assignedTo?: string;
  status: string;
}

interface Deal {
  id: number;
  status: string;
  offerDate?: string;
  offerAmount?: string;
  propertyId: number;
}

interface Lead {
  id: number;
  firstName?: string;
  lastName?: string;
  propertyAddress?: string;
  lastContactedAt?: string;
  status: string;
}

interface DashboardStats {
  totalLeads?: number;
  activeDeals?: number;
  totalRevenue?: number;
  conversionRate?: number;
  pipelineStages?: Record<string, number>;
}

function StatPanel({
  title,
  icon,
  children,
  linkTo,
  isLoading,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  linkTo?: string;
  isLoading?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">{icon}{title}</span>
          {linkTo && (
            <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Link href={linkTo} aria-label={`View all ${title.toLowerCase()}`}>
                View all <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export default function OpsDashboardPage() {
  useDocumentTitle("Ops dashboard");
  const qc = useQueryClient();
  const { toast } = useToast();

  const unwrapArr = async <T,>(url: string): Promise<T[]> => {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
  };

  const { data: tasks, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: () => unwrapArr<Task>("/api/tasks"),
  });

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => unwrapArr<Deal>("/api/deals"),
  });

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => unwrapArr<Lead>("/api/leads"),
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: () => fetch("/api/dashboard/stats").then(r => r.json()),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: number) =>
      fetch(`/api/tasks/${taskId}/complete`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }),
    onError: () =>
      toast({
        title: "Couldn't mark task done",
        description: "The task is still open. Try again, or open the task to complete it manually.",
        variant: "destructive",
      }),
  });

  const now = new Date();
  const todayTasks = (tasks ?? []).filter(t => {
    if (t.status === "completed") return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return due <= addDays(now, 1) && isAfter(due, subDays(now, 1));
  });

  const expiringOffers = (deals ?? []).filter(d => {
    if (d.status !== "offer_sent") return false;
    if (!d.offerDate) return false;
    const offerDt = new Date(d.offerDate);
    const expiresAt = addDays(offerDt, 7);
    return isAfter(expiresAt, now) && expiresAt <= addDays(now, 7);
  }).sort((a, b) =>
    new Date(a.offerDate!).getTime() - new Date(b.offerDate!).getTime()
  );

  const staleLeads = (leads ?? []).filter(l => {
    if (l.status === "closed" || l.status === "dead") return false;
    if (!l.lastContactedAt) return true;
    return new Date(l.lastContactedAt) < subDays(now, 14);
  });

  const stageOrder = ["new", "contacted", "offer_sent", "countered", "accepted", "in_escrow", "closed"];
  const pipelineStages = stats?.pipelineStages ?? {};
  const dealsTotal = Math.max(1, (deals ?? []).length);

  return (
    <PageShell label="Ops dashboard">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Ops dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1 tabular-nums">Operational overview — {format(now, "EEEE, MMMM d")}.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatPanel
            title="Tasks due today"
            icon={<CheckSquare className="w-4 h-4 text-blue-500" aria-hidden="true" />}
            linkTo="/tasks"
            isLoading={tasksLoading}
          >
            {todayTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks due today.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold tabular-nums">{todayTasks.length}</p>
                <ul className="space-y-1" aria-label="Tasks due today">
                  {todayTasks.slice(0, 5).map(t => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                      <span className="truncate">{t.title}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-xs shrink-0 text-green-600"
                        onClick={() => completeTask.mutate(t.id)}
                        disabled={completeTask.isPending}
                        aria-label={`Mark "${t.title}" as done`}
                      >
                        Done
                      </Button>
                    </li>
                  ))}
                  {todayTasks.length > 5 && (
                    <li className="text-xs text-muted-foreground">+<span className="tabular-nums">{todayTasks.length - 5}</span> more</li>
                  )}
                </ul>
              </div>
            )}
          </StatPanel>

          <StatPanel
            title="Offers expiring this week"
            icon={<FileText className="w-4 h-4 text-orange-500" aria-hidden="true" />}
            linkTo="/pipeline"
            isLoading={dealsLoading}
          >
            {expiringOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offers expiring soon.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold tabular-nums">{expiringOffers.length}</p>
                <ul className="space-y-1" aria-label="Offers expiring within 7 days">
                  {expiringOffers.slice(0, 5).map(d => {
                    const expires = addDays(new Date(d.offerDate!), 7);
                    return (
                      <li key={d.id} className="flex items-center justify-between text-sm gap-2">
                        <span className="truncate">Deal #<span className="tabular-nums">{d.id}</span></span>
                        <Badge variant="outline" className="text-xs shrink-0 tabular-nums">
                          <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                          {relative(expires)}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </StatPanel>

          <StatPanel
            title="Overdue follow-ups"
            icon={<UserX className="w-4 h-4 text-red-500" aria-hidden="true" />}
            linkTo="/leads"
            isLoading={leadsLoading}
          >
            {staleLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">All leads are current.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold text-red-600 tabular-nums">{staleLeads.length}</p>
                <ul className="space-y-1" aria-label="Leads needing follow-up">
                  {staleLeads.slice(0, 5).map(l => (
                    <li key={l.id} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate">
                        {l.firstName} {l.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {l.lastContactedAt
                          ? relative(l.lastContactedAt)
                          : "Never contacted"}
                      </span>
                    </li>
                  ))}
                  {staleLeads.length > 5 && (
                    <li className="text-xs text-muted-foreground">+<span className="tabular-nums">{staleLeads.length - 5}</span> more</li>
                  )}
                </ul>
              </div>
            )}
          </StatPanel>

          <StatPanel
            title="Pipeline health"
            icon={<TrendingUp className="w-4 h-4 text-green-500" aria-hidden="true" />}
            linkTo="/pipeline"
            isLoading={statsLoading}
          >
            {Object.keys(pipelineStages).length === 0 && !statsLoading ? (
              <p className="text-sm text-muted-foreground">No pipeline data yet.</p>
            ) : (
              <ul className="space-y-2" aria-label="Deal counts per pipeline stage">
                {stageOrder.map(stage => {
                  const count = pipelineStages[stage] ?? 0;
                  const pct = Math.min(100, (count / dealsTotal) * 100);
                  const stageLabel = stage.replace(/_/g, " ");
                  return (
                    <li key={stage} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24 capitalize shrink-0">
                        {stageLabel}
                      </span>
                      <div
                        className="flex-1 bg-muted rounded-full h-1.5"
                        role="progressbar"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${stageLabel}: ${count} deals, ${Math.round(pct)}% of total`}
                      >
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-4 text-right tabular-nums">{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </StatPanel>
        </div>

        {(expiringOffers.length > 0 || staleLeads.length > 0) && (
          <div
            className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3"
            role="status"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {[
              expiringOffers.length > 0 && `${expiringOffers.length} offer${expiringOffers.length > 1 ? "s" : ""} expiring`,
              staleLeads.length > 0 && `${staleLeads.length} overdue follow-up${staleLeads.length > 1 ? "s" : ""}`,
            ].filter(Boolean).join(" · ")} need attention.
          </div>
        )}
      </div>
    </PageShell>
  );
}
