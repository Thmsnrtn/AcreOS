import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatRelative } from "@/lib/format";

interface JobStatus {
  jobName: string;
  displayName: string;
  status: "healthy" | "warning" | "failing" | "overdue" | "unknown";
  lastSuccessAt: string | null;
  minutesSinceLastRun: number | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  expectedIntervalMs: number;
  overdue: boolean;
}

interface JobHealthResponse {
  jobs: JobStatus[];
  overallStatus: "healthy" | "degraded" | "critical";
  unhealthyCount: number;
  totalJobs: number;
}

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-acr-pos",
  warning: "bg-acr-warn",
  failing: "bg-acr-neg",
  overdue: "bg-acr-warn",
  unknown: "bg-muted",
};

const STATUS_LABEL: Record<string, string> = {
  healthy: "Healthy",
  warning: "Warning",
  failing: "Failing",
  overdue: "Overdue",
  unknown: "Unknown",
};

function formatInterval(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`;
  return `${ms / 86400000}d`;
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return "Never run";
  // API reports minutes-since-run; reconstruct the timestamp for the house helper.
  return formatRelative(Date.now() - mins * 60_000);
}

export function JobQueueHealth() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery<JobHealthResponse>({
    queryKey: ["/api/founder/intelligence/job-health"],
    // 2026-05-26: dropped 60s polling — refresh on focus only. Founder
    // hits this during incident response; explicit refresh available
    // via the refetch fn surfaced below.
    refetchOnWindowFocus: true,
    staleTime: 120_000,
  });

  const restartMutation = useMutation({
    mutationFn: (jobName: string) =>
      apiRequest("POST", `/api/founder/intelligence/job-health/${jobName}/restart`, {}),
    onSuccess: () => {
      // The restarted job's status is exactly what this card displays —
      // previously nothing refreshed, so a restart looked like a no-op.
      queryClient.invalidateQueries({ queryKey: ["/api/founder/intelligence/job-health"] });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Job queue health</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-busy="true" aria-label="Loading job health" className="grid grid-cols-2 sm:grid-cols-3 gap-2 animate-pulse">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="h-16 rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const jobs = data?.jobs ?? [];
  const unhealthy = data?.unhealthyCount ?? 0;
  const total = data?.totalJobs ?? jobs.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Job queue health
            <span className={`ml-2 text-sm font-normal tabular-nums ${unhealthy === 0 ? "text-acr-pos" : "text-acr-warn"}`}>
              {unhealthy === 0 ? `${total}/${total} healthy` : `${total - unhealthy}/${total} healthy — ${unhealthy} need attention`}
            </span>
          </CardTitle>
          <Button type="button" size="sm" variant="ghost" onClick={() => refetch()} aria-label="Refresh job health">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul aria-label="Background jobs" className="grid grid-cols-2 sm:grid-cols-3 gap-2 list-none p-0 m-0">
          {jobs.map(job => (
            <li
              key={job.jobName}
              className={`rounded border p-2 space-y-1 text-xs ${
                job.status === "healthy"
                  ? "border-border bg-card"
                  : job.status === "failing"
                  ? "border-acr-neg-soft bg-acr-neg-soft dark:border-acr-neg-soft dark:bg-acr-neg-soft/20"
                  : "border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft dark:bg-acr-warn-soft/20"
              }`}
              aria-label={`${job.displayName}: ${STATUS_LABEL[job.status]}${job.consecutiveFailures > 0 ? `, ${job.consecutiveFailures} consecutive failures` : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[job.status]}`} />
                <span className="font-medium truncate leading-tight">{job.displayName}</span>
              </div>
              <div className="text-muted-foreground tabular-nums">
                <span>Every {formatInterval(job.expectedIntervalMs)}</span>
                {" · "}
                {job.overdue && job.minutesSinceLastRun !== null ? (
                  <span className="text-acr-warn dark:text-acr-warn font-medium">Overdue</span>
                ) : (
                  <span>{formatMinutes(job.minutesSinceLastRun)}</span>
                )}
              </div>
              {job.consecutiveFailures > 0 && (
                <div className="text-acr-neg dark:text-acr-neg tabular-nums">{job.consecutiveFailures} fail{job.consecutiveFailures === 1 ? "" : "s"}</div>
              )}
              {job.status !== "healthy" && job.status !== "unknown" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs w-full mt-1"
                  disabled={restartMutation.isPending}
                  aria-busy={restartMutation.isPending}
                  aria-label={`Restart ${job.displayName}`}
                  onClick={() => restartMutation.mutate(job.jobName)}
                >
                  Restart
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
