// PaxTasksSettingsTab — manage scheduled Pax tasks from Settings
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Clock, Trash2, History, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ScheduledTask {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
}

interface TaskRun {
  id: number;
  runAt: string;
  status: string;
  summary: string | null;
  conversationId: number | null;
  durationMs: number | null;
}

const SCHEDULE_LABELS: Record<string, string> = {
  daily_8am: "Daily at 8 AM",
  daily_6pm: "Daily at 6 PM",
  weekly_monday_9am: "Mon at 9 AM",
  weekly_friday_5pm: "Fri at 5 PM",
  hourly: "Every hour",
};

export function PaxTasksSettingsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [historyTaskId, setHistoryTaskId] = useState<number | null>(null);
  const [historyTaskName, setHistoryTaskName] = useState("");

  const { data: tasks = [], isLoading } = useQuery<ScheduledTask[]>({
    queryKey: ["/api/ai/scheduled-tasks"],
    queryFn: async () => {
      const r = await fetch("/api/ai/scheduled-tasks", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 30_000,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<TaskRun[]>({
    queryKey: ["/api/ai/scheduled-tasks", historyTaskId, "runs"],
    queryFn: async () => {
      if (!historyTaskId) return [];
      const r = await fetch(`/api/ai/scheduled-tasks/${historyTaskId}/runs`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: historyTaskId !== null,
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/ai/scheduled-tasks/${id}/toggle`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/scheduled-tasks"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/ai/scheduled-tasks/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/scheduled-tasks"] });
      toast({ title: "Task deleted" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Scheduled AI Tasks</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pax runs these prompts automatically on your chosen schedule.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : tasks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No scheduled tasks yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use the <span className="font-mono text-[11px] bg-muted px-1 rounded">⏱</span> button in the Pax chat input to schedule a prompt.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <Card key={task.id} className={task.isActive ? "" : "opacity-60"}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{task.name}</span>
                      {!task.isActive && (
                        <Badge variant="secondary" className="text-[10px] h-4">Paused</Badge>
                      )}
                      {task.lastRunStatus && (
                        <Badge
                          variant={task.lastRunStatus === "success" ? "outline" : "destructive"}
                          className="text-[10px] h-4"
                        >
                          {task.lastRunStatus === "success" ? "OK" : "Error"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {SCHEDULE_LABELS[task.schedule] ?? task.schedule}
                      {task.lastRunAt && (
                        <span className="ml-2 text-muted-foreground/60">
                          · last run {new Date(task.lastRunAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                    {task.lastRunSummary && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1 italic">"{task.lastRunSummary}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="View run history"
                      aria-label="View run history"
                      onClick={() => { setHistoryTaskId(task.id); setHistoryTaskName(task.name); }}
                    >
                      <History className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMut.mutate(task.id)}
                      aria-label={`Delete scheduled task ${task.name ?? ""}`.trim()}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Run History Drawer */}
      <Sheet open={historyTaskId !== null} onOpenChange={(v) => !v && setHistoryTaskId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <History className="w-4 h-4 text-primary" />
              Run History — {historyTaskName}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">Last 20 executions for this task.</p>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {runsLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : runs.length === 0 ? (
              <div className="text-center py-10">
                <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No runs recorded yet for this task.</p>
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="rounded-md border px-3 py-2 space-y-0.5">
                  <div className="flex items-center gap-2">
                    {run.status === "success" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                    )}
                    <span className="text-xs font-medium">
                      {new Date(run.runAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className={cn(
                      "ml-auto text-[10px] font-medium",
                      run.status === "success" ? "text-green-600" : "text-destructive"
                    )}>
                      {run.status}
                    </span>
                    {run.durationMs && (
                      <span className="text-[10px] text-muted-foreground">{(run.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  {run.summary && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 pl-5">{run.summary}</p>
                  )}
                  {run.conversationId && (
                    <a
                      href="#"
                      className="text-[10px] text-primary hover:underline flex items-center gap-0.5 pl-5"
                      onClick={(e) => { e.preventDefault(); setHistoryTaskId(null); }}
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      View conversation
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
