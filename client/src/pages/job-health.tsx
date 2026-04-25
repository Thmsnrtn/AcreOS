import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  HeartPulse, CheckCircle, AlertTriangle, Clock,
  Search, Play, SkipForward, RefreshCw,
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

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  skipped_lock: "Skipped (locked)",
  running: "Running",
  unknown: "Unknown",
};

function StatusIcon({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
  switch (status) {
    case "success":
      return <CheckCircle className="w-3.5 h-3.5 text-green-500" aria-label={label} />;
    case "failed":
      return <AlertTriangle className="w-3.5 h-3.5 text-red-500" aria-label={label} />;
    case "skipped_lock":
      return <SkipForward className="w-3.5 h-3.5 text-muted-foreground" aria-label={label} />;
    case "running":
      return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" aria-label={label} />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" aria-label={label} />;
  }
}

export default function JobHealth() {
  useDocumentTitle("Job health");
  const filterId = useId();
  const { toast } = useToast();
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
    onSuccess: (_, jobName) => {
      toast({ title: "Job triggered", description: `${jobName} will run on the next worker tick.` });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/job-health"] });
    },
    onError: (_, jobName) =>
      toast({
        title: "Couldn't trigger job",
        description: `${jobName} did not run — its regular schedule continues unaffected. Try again in a moment.`,
        variant: "destructive",
      }),
  });

  const filteredJobs = Array.isArray(jobs) ? jobs.filter((j: any) => {
    if (searchFilter && !j.jobName?.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    return true;
  }) : [];

  const allJobs = Array.isArray(jobs) ? jobs : [];
  const successCount = allJobs.filter((j: any) => j.status === "success").length;
  const failedCount = allJobs.filter((j: any) => j.status === "failed").length;
  const skippedCount = allJobs.filter((j: any) => j.status === "skipped_lock").length;

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
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-primary" aria-hidden="true" />
            Job health
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor background job execution — status, duration, failures, and manual triggers.
          </p>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground">Unique jobs</dt>
              <dd className="text-xl font-bold tabular-nums">{uniqueJobs.length}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground">Successful runs</dt>
              <dd className="text-xl font-bold text-green-600 tabular-nums">{successCount}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground">Failed runs</dt>
              <dd className="text-xl font-bold text-red-600 tabular-nums">{failedCount}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground">Lock skips</dt>
              <dd className="text-xl font-bold text-muted-foreground tabular-nums">{skippedCount}</dd>
            </CardContent>
          </Card>
        </dl>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Job status (latest run)</CardTitle>
          </CardHeader>
          <CardContent>
            {uniqueJobs.length > 0 ? (
              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Latest run per job">
                {uniqueJobs.map((job: any) => (
                  <li key={job.jobName} className="flex items-center justify-between p-3 border rounded-lg gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={job.status} />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium truncate">{job.jobName}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {job.durationMs != null ? `${job.durationMs}ms` : "N/A"} ·{" "}
                          {job.runCompletedAt && relative(job.runCompletedAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 min-h-9 min-w-9"
                      onClick={() => setPendingJobTrigger(job.jobName)}
                      disabled={triggerJobMutation.isPending}
                      aria-label={`Manually run ${job.jobName}`}
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No job health logs available yet.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Label htmlFor={filterId} className="sr-only">Filter by job name</Label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id={filterId}
              type="search"
              placeholder="Filter by job name…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-10"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-1" role="group" aria-label="Status filter">
            {["all", "success", "failed", "skipped_lock"].map((s) => {
              const label = s === "all" ? "All" : s === "skipped_lock" ? "Skipped" : s.charAt(0).toUpperCase() + s.slice(1);
              const isActive = statusFilter === s;
              return (
                <Button
                  key={s}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={isActive}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              Run history
              <Badge variant="secondary"><span className="tabular-nums">{filteredJobs.length}</span> runs</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredJobs.length > 0 ? (
              <ol className="max-h-[500px] overflow-y-auto space-y-1" aria-label="Recent job runs, newest first">
                {filteredJobs.slice(0, 100).map((job: any, i: number) => (
                  <li key={job.id ?? i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0 gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={job.status} />
                      <span className="font-mono text-xs truncate">{job.jobName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 flex-wrap justify-end">
                      {job.durationMs != null && <span className="tabular-nums">{job.durationMs}ms</span>}
                      {job.runCompletedAt && (
                        <span className="tabular-nums">{format(new Date(job.runCompletedAt), "MMM d HH:mm:ss")}</span>
                      )}
                      {job.errorMessage && (
                        <span className="text-red-500 truncate max-w-48" title={job.errorMessage} role="alert">
                          {job.errorMessage}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
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
              Run <span className="font-medium font-mono">{pendingJobTrigger}</span> immediately?
              This job is normally on a schedule. Running it manually executes it once now,
              in addition to its regular schedule — be careful with jobs that have side effects
              like sending emails or calling paid APIs.
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
