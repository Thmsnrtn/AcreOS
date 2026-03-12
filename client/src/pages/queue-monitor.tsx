/**
 * T3 — BullMQ Queue Monitoring Dashboard
 * Mounted at /admin/queues — founder-only
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Trash2, RotateCcw, AlertCircle, CheckCircle2, Clock, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    },
  });

  const retryFailed = useMutation({
    mutationFn: (queueName: string) =>
      apiRequest("POST", `/api/admin/queues/${queueName}/retry-failed`),
    onSuccess: (data: any) => {
      toast({ title: `Retried ${data?.retried ?? 0} failed jobs` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Queue Monitoring Disabled</h2>
            <p className="text-muted-foreground">{data?.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Queue Monitor</h1>
          <p className="text-muted-foreground text-sm">
            Last updated: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "—"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {data?.queues.map((queue) => (
        <Card key={queue.name}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-base">{queue.name}</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retryFailed.mutate(queue.name)}
                  disabled={queue.counts.failed === 0 || retryFailed.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Retry Failed
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearFailed.mutate(queue.name)}
                  disabled={queue.counts.failed === 0 || clearFailed.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear Failed
                </Button>
              </div>
            </div>

            {/* Count badges */}
            <div className="flex gap-3 flex-wrap pt-2">
              <StatBadge icon={<Clock className="h-3 w-3" />} label="Waiting" value={queue.counts.waiting} color="amber" />
              <StatBadge icon={<Zap className="h-3 w-3" />} label="Active" value={queue.counts.active} color="blue" />
              <StatBadge icon={<CheckCircle2 className="h-3 w-3" />} label="Completed" value={queue.counts.completed} color="green" />
              <StatBadge icon={<AlertCircle className="h-3 w-3" />} label="Failed" value={queue.counts.failed} color="red" />
              <StatBadge icon={<Clock className="h-3 w-3" />} label="Delayed" value={queue.counts.delayed} color="purple" />
            </div>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue="active">
              <TabsList>
                <TabsTrigger value="active">Active ({queue.counts.active})</TabsTrigger>
                <TabsTrigger value="waiting">Waiting ({queue.counts.waiting})</TabsTrigger>
                <TabsTrigger value="failed">Failed ({queue.counts.failed})</TabsTrigger>
                <TabsTrigger value="delayed">Delayed ({queue.counts.delayed})</TabsTrigger>
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
      ))}
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
      {label}: <strong>{value.toLocaleString()}</strong>
    </span>
  );
}

function JobList({ jobs, type }: { jobs: JobEntry[]; type: string }) {
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No {type} jobs
      </p>
    );
  }
  return (
    <div className="space-y-2 mt-3">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-start justify-between p-3 rounded-lg border bg-muted/30 text-sm"
        >
          <div className="space-y-0.5">
            <div className="font-mono font-medium">{job.name}</div>
            <div className="text-xs text-muted-foreground font-mono">ID: {job.id}</div>
            {job.failedReason && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                {job.failedReason.slice(0, 120)}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap ml-4">
            {job.timestamp
              ? new Date(job.timestamp).toLocaleTimeString()
              : job.processedOn
              ? new Date(job.processedOn).toLocaleTimeString()
              : job.finishedOn
              ? new Date(job.finishedOn).toLocaleTimeString()
              : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
