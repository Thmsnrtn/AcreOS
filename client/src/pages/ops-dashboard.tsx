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
import { formatDistanceToNow, format, isAfter, subDays, addDays } from "date-fns";

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
            <Link href={linkTo}>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                View all <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export default function OpsDashboardPage() {
  const qc = useQueryClient();

  const { data: tasks, isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: () => fetch("/api/tasks").then(r => r.json()),
  });

  const { data: deals, isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then(r => r.json()),
  });

  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => fetch("/api/leads").then(r => r.json()),
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: () => fetch("/api/dashboard/stats").then(r => r.json()),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: number) =>
      fetch(`/api/tasks/${taskId}/complete`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/tasks"] }),
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

  return (
    <PageShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Ops Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Operational overview — {format(now, "EEEE, MMMM d")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tasks Due Today */}
          <StatPanel
            title="Tasks Due Today"
            icon={<CheckSquare className="w-4 h-4 text-blue-500" />}
            linkTo="/tasks"
            isLoading={tasksLoading}
          >
            {todayTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks due today.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold">{todayTasks.length}</p>
                <ul className="space-y-1">
                  {todayTasks.slice(0, 5).map(t => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                      <span className="truncate">{t.title}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-xs shrink-0 text-green-600"
                        onClick={() => completeTask.mutate(t.id)}
                        disabled={completeTask.isPending}
                      >
                        Done
                      </Button>
                    </li>
                  ))}
                  {todayTasks.length > 5 && (
                    <li className="text-xs text-muted-foreground">+{todayTasks.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </StatPanel>

          {/* Offers Expiring */}
          <StatPanel
            title="Offers Expiring This Week"
            icon={<FileText className="w-4 h-4 text-orange-500" />}
            linkTo="/pipeline"
            isLoading={dealsLoading}
          >
            {expiringOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offers expiring soon.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold">{expiringOffers.length}</p>
                <ul className="space-y-1">
                  {expiringOffers.slice(0, 5).map(d => {
                    const expires = addDays(new Date(d.offerDate!), 7);
                    return (
                      <li key={d.id} className="flex items-center justify-between text-sm gap-2">
                        <span className="truncate">Deal #{d.id}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          <Clock className="w-3 h-3 mr-1" />
                          {formatDistanceToNow(expires, { addSuffix: true })}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </StatPanel>

          {/* Overdue Follow-ups */}
          <StatPanel
            title="Overdue Follow-ups"
            icon={<UserX className="w-4 h-4 text-red-500" />}
            linkTo="/leads"
            isLoading={leadsLoading}
          >
            {staleLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">All leads are current.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-bold text-red-600">{staleLeads.length}</p>
                <ul className="space-y-1">
                  {staleLeads.slice(0, 5).map(l => (
                    <li key={l.id} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate">
                        {l.firstName} {l.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {l.lastContactedAt
                          ? formatDistanceToNow(new Date(l.lastContactedAt), { addSuffix: true })
                          : "never contacted"}
                      </span>
                    </li>
                  ))}
                  {staleLeads.length > 5 && (
                    <li className="text-xs text-muted-foreground">+{staleLeads.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </StatPanel>

          {/* Pipeline Health */}
          <StatPanel
            title="Pipeline Health"
            icon={<TrendingUp className="w-4 h-4 text-green-500" />}
            linkTo="/pipeline"
            isLoading={statsLoading}
          >
            {Object.keys(pipelineStages).length === 0 && !statsLoading ? (
              <p className="text-sm text-muted-foreground">No pipeline data yet.</p>
            ) : (
              <div className="space-y-2">
                {stageOrder.map(stage => {
                  const count = pipelineStages[stage] ?? 0;
                  return (
                    <div key={stage} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24 capitalize shrink-0">
                        {stage.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{
                            width: `${Math.min(100, (count / Math.max(1, (deals ?? []).length)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium w-4 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </StatPanel>
        </div>

        {(expiringOffers.length > 0 || staleLeads.length > 0) && (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
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
