import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

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
  healthy: "bg-green-500",
  warning: "bg-yellow-500",
  failing: "bg-red-500",
  overdue: "bg-orange-500",
  unknown: "bg-gray-400",
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
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function JobQueueHealth() {
  const { data, isLoading, refetch } = useQuery<JobHealthResponse>({
    queryKey: ["/api/founder/intelligence/job-health"],
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const restartMutation = useMutation({
    mutationFn: (jobName: string) =>
      apiRequest("POST", `/api/founder/intelligence/job-health/${jobName}/restart`, {}),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Job Queue Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 animate-pulse">
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
  const overallStatus = data?.overallStatus ?? "unknown";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Job Queue Health
            <span className={`ml-2 text-sm font-normal ${unhealthy === 0 ? "text-green-600" : "text-orange-600"}`}>
              {unhealthy === 0 ? `${total}/${total} healthy` : `${total - unhealthy}/${total} healthy — ${unhealthy} need attention`}
            </span>
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {jobs.map(job => (
            <div
              key={job.jobName}
              className={`rounded border p-2 space-y-1 text-xs ${
                job.status === "healthy"
                  ? "border-border bg-card"
                  : job.status === "failing"
                  ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                  : "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[job.status]}`} />
                <span className="font-medium truncate leading-tight">{job.displayName}</span>
              </div>
              <div className="text-muted-foreground">
                <span>Every {formatInterval(job.expectedIntervalMs)}</span>
                {" · "}
                {job.overdue && job.minutesSinceLastRun !== null ? (
                  <span className="text-orange-600 dark:text-orange-400 font-medium">OVERDUE</span>
                ) : (
                  <span>{formatMinutes(job.minutesSinceLastRun)}</span>
                )}
              </div>
              {job.consecutiveFailures > 0 && (
                <div className="text-red-600 dark:text-red-400">{job.consecutiveFailures} fail(s)</div>
              )}
              {job.status !== "healthy" && job.status !== "unknown" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs w-full mt-1"
                  disabled={restartMutation.isPending}
                  onClick={() => restartMutation.mutate(job.jobName)}
                >
                  Restart
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
