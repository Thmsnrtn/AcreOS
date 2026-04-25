/**
 * T3 — BullMQ Queue Monitoring Dashboard
 * Mounted at /admin/queues — founder-only
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Trash2, RotateCcw, AlertCircle, CheckCircle2, Clock, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";

interface JobEntry {
  id: string;
  name: string;
  data?: any;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  delay?: number;
}

interface QueueStats {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  recentWaiting: JobEntry[];
  recentActive: JobEntry[];
  recentFailed: JobEntry[];
  recentDelayed: JobEntry[];
}

interface QueueResponse {
  enabled: boolean;
  message?: string;
  queues: QueueStats[];
  timestamp?: string;
}

export default function QueueMonitor() {
  useDocumentTitle("Queue monitor");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingClear, setPendingClear] = useState<{ queue: string; failedCount: number } | null>(null);

  const { data, isLoading, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/admin/queues"],
    refetchInterval: 10_000,
  });

  const clearFailed = useMutation({
    mutationFn: (queueName: string) =>
      apiRequest("DELETE", `/api/admin/queues/${queueName}/failed`),
    onSuccess: () => {
      toast({ title: "Failed jobs cleared" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues"] });
      setPendingClear(null);
    },
    onError: () =>
      toast({
        title: "Couldn't clear failed jobs",
        description: "The failed-job log is unchanged — try again.",
        variant: "destructive",
      }),
  });

  const retryFailed = useMutation({
    mutationFn: (queueName: string) =>
      apiRequest("POST", `/api/admin/queues/${queueName}/retry-failed`),
    onSuccess: (data: any) => {
      toast({ title: `Retried ${data?.retried ?? 0} failed jobs` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues"] });
    },
    onError: () =>
      toast({
        title: "Couldn't retry failed jobs",
        description: "Failed jobs stayed in the failed state — try again.",
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <span className="sr-only">Loading queue monitor…</span>
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-semibold mb-2">Queue monitoring disabled</h2>
            <p className="text-muted-foreground">{data?.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Queue monitor</h1>
          <p className="text-muted-foreground text-sm">
            Last updated: <span className="tabular-nums">{data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "—"}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} aria-label="Refresh queue stats">
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <ul className="space-y-6" aria-label="Job queues">
        {data?.queues.map((queue) => (
          <li key={queue.name}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="font-mono text-base">{queue.name}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryFailed.mutate(queue.name)}
                      disabled={queue.counts.failed === 0 || retryFailed.isPending}
                      aria-label={`Retry failed jobs in ${queue.name}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Retry failed
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingClear({ queue: queue.name, failedCount: queue.counts.failed })}
                      disabled={queue.counts.failed === 0 || clearFailed.isPending}
                      aria-label={`Clear failed jobs in ${queue.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Clear failed
                    </Button>
                  </div>
                </div>

                <ul className="flex gap-3 flex-wrap pt-2" aria-label={`${queue.name} counts`}>
                  <li><StatBadge icon={<Clock className="h-3 w-3" aria-hidden="true" />} label="Waiting" value={queue.counts.waiting} color="amber" /></li>
                  <li><StatBadge icon={<Zap className="h-3 w-3" aria-hidden="true" />} label="Active" value={queue.counts.active} color="blue" /></li>
                  <li><StatBadge icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />} label="Completed" value={queue.counts.completed} color="green" /></li>
                  <li><StatBadge icon={<AlertCircle className="h-3 w-3" aria-hidden="true" />} label="Failed" value={queue.counts.failed} color="red" /></li>
                  <li><StatBadge icon={<Clock className="h-3 w-3" aria-hidden="true" />} label="Delayed" value={queue.counts.delayed} color="purple" /></li>
                </ul>
              </CardHeader>

              <CardContent>
                <Tabs defaultValue="active">
                  <TabsList>
                    <TabsTrigger value="active">Active (<span className="tabular-nums">{queue.counts.active}</span>)</TabsTrigger>
                    <TabsTrigger value="waiting">Waiting (<span className="tabular-nums">{queue.counts.waiting}</span>)</TabsTrigger>
                    <TabsTrigger value="failed">Failed (<span className="tabular-nums">{queue.counts.failed}</span>)</TabsTrigger>
                    <TabsTrigger value="delayed">Delayed (<span className="tabular-nums">{queue.counts.delayed}</span>)</TabsTrigger>
                  </TabsList>

                  <TabsContent value="active">
                    <JobList jobs={queue.recentActive} type="active" />
                  </TabsContent>
                  <TabsContent value="waiting">
                    <JobList jobs={queue.recentWaiting} type="waiting" />
                  </TabsContent>
                  <TabsContent value="failed">
                    <JobList jobs={queue.recentFailed} type="failed" />
                  </TabsContent>
                  <TabsContent value="delayed">
                    <JobList jobs={queue.recentDelayed} type="delayed" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!pendingClear}
        onOpenChange={(open) => { if (!open) setPendingClear(null); }}
        title={`Clear failed jobs in ${pendingClear?.queue ?? ""}?`}
        description={
          pendingClear
            ? `Permanently removes ${pendingClear.failedCount} failed job${pendingClear.failedCount === 1 ? "" : "s"} from the ${pendingClear.queue} queue. The jobs themselves are deleted — you can't retry them later. If you might want to retry, use "Retry failed" instead.`
            : ""
        }
        confirmLabel="Yes, clear"
        variant="destructive"
        isLoading={clearFailed.isPending}
        onConfirm={() => pendingClear && clearFailed.mutate(pendingClear.queue)}
      />
    </div>
  );
}

function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "amber" | "blue" | "green" | "red" | "purple";
}) {
  const colorMap = {
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300",
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300",
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300",
    purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorMap[color]}`}>
      {icon}
      {label}: <strong className="tabular-nums">{value.toLocaleString()}</strong>
    </span>
  );
}

function JobList({ jobs, type }: { jobs: JobEntry[]; type: string }) {
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No {type} jobs.
      </p>
    );
  }
  return (
    <ol className="space-y-2 mt-3" aria-label={`Recent ${type} jobs`}>
      {jobs.map((job) => (
        <li
          key={job.id}
          className="flex items-start justify-between p-3 rounded-lg border bg-muted/30 text-sm gap-3"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="font-mono font-medium truncate">{job.name}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">ID: {job.id}</div>
            {job.failedReason && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-1" role="alert">
                {job.failedReason.slice(0, 120)}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap ml-4 tabular-nums shrink-0">
            {job.timestamp
              ? new Date(job.timestamp).toLocaleTimeString()
              : job.processedOn
              ? new Date(job.processedOn).toLocaleTimeString()
              : job.finishedOn
              ? new Date(job.finishedOn).toLocaleTimeString()
              : "—"}
          </div>
        </li>
      ))}
    </ol>
  );
}
