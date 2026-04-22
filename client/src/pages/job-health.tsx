import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HeartPulse, CheckCircle, AlertTriangle, Clock,
  Search, Play, XCircle, SkipForward, RefreshCw,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { relative } from "@/lib/format";
import { useJobHealthLogs } from "@/hooks/use-sovereign-dashboard";

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
    case "failed":
      return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
    case "skipped_lock":
      return <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />;
    case "running":
      return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

export default function JobHealth() {
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pendingJobTrigger, setPendingJobTrigger] = useState<string | null>(null);
  const { data: jobs = [], isLoading } = useJobHealthLogs();
  const queryClient = useQueryClient();

  const triggerJobMutation = useMutation({
    mutationFn: async (jobName: string) => {
      const res = await fetch("/api/founder/job-health/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobName }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to trigger job");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/job-health"] });
    },
  });

  const filteredJobs = Array.isArray(jobs) ? jobs.filter((j: any) => {
    if (searchFilter && !j.jobName?.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    return true;
  }) : [];

  // Aggregate stats
  const allJobs = Array.isArray(jobs) ? jobs : [];
  const successCount = allJobs.filter((j: any) => j.status === "success").length;
  const failedCount = allJobs.filter((j: any) => j.status === "failed").length;
  const skippedCount = allJobs.filter((j: any) => j.status === "skipped_lock").length;

  // Group by job name for "latest run" view
  const latestByJob = new Map<string, any>();
  for (const job of allJobs) {
    if (!latestByJob.has(job.jobName) || new Date(job.runCompletedAt) > new Date(latestByJob.get(job.jobName).runCompletedAt)) {
      latestByJob.set(job.jobName, job);
    }
  }
  const uniqueJobs = Array.from(latestByJob.values()).sort((a, b) => a.jobName.localeCompare(b.jobName));

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-primary" />
            Job Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor background job execution — status, duration, failures, and manual triggers
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Unique Jobs</p>
              <p className="text-xl font-bold">{uniqueJobs.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Successful Runs</p>
              <p className="text-xl font-bold text-green-600">{successCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Failed Runs</p>
              <p className="text-xl font-bold text-red-600">{failedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Lock Skips</p>
              <p className="text-xl font-bold text-muted-foreground">{skippedCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Job Status Grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Job Status (Latest Run)</CardTitle>
          </CardHeader>
          <CardContent>
            {uniqueJobs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {uniqueJobs.map((job: any) => (
                  <div key={job.jobName} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={job.status} />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium truncate">{job.jobName}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.durationMs != null ? `${job.durationMs}ms` : "N/A"} ·{" "}
                          {job.runCompletedAt && relative(job.runCompletedAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setPendingJobTrigger(job.jobName)}
                      disabled={triggerJobMutation.isPending}
                      aria-label={`Manually run ${job.jobName}`}
                    >
                      <Play className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No job health logs available yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by job name..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-1">
            {["all", "success", "failed", "skipped_lock"].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "All" : s === "skipped_lock" ? "Skipped" : s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Full Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              Run History
              <Badge variant="secondary">{filteredJobs.length} runs</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredJobs.length > 0 ? (
              <div className="max-h-[500px] overflow-y-auto space-y-1">
                {filteredJobs.slice(0, 100).map((job: any, i: number) => (
                  <div key={job.id ?? i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={job.status} />
                      <span className="font-mono text-xs truncate">{job.jobName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      {job.durationMs != null && <span>{job.durationMs}ms</span>}
                      {job.runCompletedAt && (
                        <span>{format(new Date(job.runCompletedAt), "MMM d HH:mm:ss")}</span>
                      )}
                      {job.errorMessage && (
                        <span className="text-red-500 truncate max-w-48" title={job.errorMessage}>
                          {job.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No runs match your filters.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pendingJobTrigger} onOpenChange={(open) => { if (!open) setPendingJobTrigger(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Manually run this job?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to manually run <span className="font-medium">{pendingJobTrigger}</span>?
              This job is normally scheduled to run automatically. Running it manually will execute it immediately
              in addition to its regular schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingJobTrigger) {
                triggerJobMutation.mutate(pendingJobTrigger);
                setPendingJobTrigger(null);
              }
            }}>
              Yes, run it now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
