/**
 * Phase 8 Months 11 — Founder ETL operator UI (Wenzeslaus).
 *
 * Lists every etl_jobs row with its last-run summary, error counts, and
 * pending DLQ count. Clicking a job expands a recent-runs panel; the
 * "Replay" button next to each DLQ row re-enqueues the failed record
 * via the orchestrator's `replayDlqRecord()` path.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { Database, Play, RefreshCw, AlertTriangle } from "lucide-react";

interface EtlJobSummary {
  id: number;
  jobName: string;
  providerName: string;
  sourceUrl: string | null;
  watermarkValue: string | null;
  schedule: string;
  isActive: boolean;
  softDeleteOnMissing: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  dlqCount: number;
  lastRun: {
    id: number;
    status: "running" | "success" | "failure";
    startedAt: string;
    completedAt: string | null;
    recordsRead: number;
    recordsInserted: number;
    recordsUpdated: number;
    recordsDeleted: number;
    recordsFailed: number;
    errorMessage: string | null;
  } | null;
}

interface DlqRow {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  failedAt: string;
  failureReason: string;
}

const STATUS_VARIANT: Record<
  "running" | "success" | "failure",
  "default" | "destructive" | "outline"
> = {
  running: "outline",
  success: "default",
  failure: "destructive",
};

export default function FounderEtlPage() {
  useDocumentTitle("ETL orchestrator");
  const { toast } = useToast();
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  const jobsQuery = useQuery<{ jobs: EtlJobSummary[] }>({
    queryKey: ["/api/founder/etl/jobs"],
    queryFn: async () => {
      const r = await fetch("/api/founder/etl/jobs", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load ETL jobs");
      return r.json();
    },
  });

  const dlqQuery = useQuery<{ dlq: DlqRow[] }>({
    queryKey: ["/api/founder/etl/dlq"],
    queryFn: async () => {
      const r = await fetch("/api/founder/etl/dlq", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load DLQ");
      return r.json();
    },
  });

  const runJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const r = await fetch(`/api/founder/etl/jobs/${jobId}/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Run failed: ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { status: string; stats: Record<string, number> }) => {
      toast({
        title: `Run ${data.status}`,
        description: `read=${data.stats.read} inserted=${data.stats.inserted} updated=${data.stats.updated} failed=${data.stats.failed}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/etl/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/etl/dlq"] });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Run failed",
        description: String(err),
      });
    },
  });

  const replayMutation = useMutation({
    mutationFn: async (dlqId: number) => {
      const r = await fetch(`/api/founder/etl/dlq/${dlqId}/replay`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Replay failed: ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { ok: boolean; error?: string }) => {
      if (data.ok) {
        toast({ title: "Replayed", description: "Record reprocessed." });
      } else {
        toast({
          variant: "destructive",
          title: "Replay failed",
          description: data.error ?? "Unknown error",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/founder/etl/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/etl/dlq"] });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <PageShell label="ETL orchestrator">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" aria-hidden />
            Jobs
          </CardTitle>
          <CardDescription>
            Each row is one etl_jobs entry. Watermark is the high-water mark of the
            last successful pull; the next run only fetches records updated since.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : jobsQuery.error ? (
            <p className="text-sm text-destructive">Failed to load jobs.</p>
          ) : jobsQuery.data?.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ETL jobs registered yet. Insert rows into etl_jobs to start
              pulling.
            </p>
          ) : (
            <div className="space-y-2">
              {jobsQuery.data?.jobs.map((j) => (
                <div
                  key={j.id}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-medium">
                          {j.jobName}
                        </p>
                        <Badge variant="outline">{j.providerName}</Badge>
                        {!j.isActive && <Badge variant="outline">paused</Badge>}
                        {j.lastRun && (
                          <Badge variant={STATUS_VARIANT[j.lastRun.status]}>
                            {j.lastRun.status}
                          </Badge>
                        )}
                        {j.dlqCount > 0 && (
                          <Badge
                            variant="destructive"
                            className="flex items-center gap-1"
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {j.dlqCount} DLQ
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        schedule {j.schedule} · watermark{" "}
                        {j.watermarkValue ?? "—"} · last success{" "}
                        {j.lastSuccessAt
                          ? new Date(j.lastSuccessAt).toLocaleString()
                          : "never"}
                      </p>
                      {j.lastError && (
                        <p className="mt-1 text-xs text-destructive">
                          last error: {j.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpandedJob(expandedJob === j.id ? null : j.id)
                        }
                        aria-label={`Toggle runs for ${j.jobName}`}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => runJobMutation.mutate(j.id)}
                        disabled={runJobMutation.isPending}
                        aria-label={`Run ${j.jobName} now`}
                      >
                        <Play className="h-4 w-4" aria-hidden />
                        <span className="ml-1">Run now</span>
                      </Button>
                    </div>
                  </div>

                  {expandedJob === j.id && (
                    <RecentRunsPanel jobId={j.id} />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Dead-letter queue</CardTitle>
          <CardDescription>
            Per-record failures from any ETL job. Replay re-runs the original
            handler against the captured payload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dlqQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : dlqQuery.error ? (
            <p className="text-sm text-destructive">Failed to load DLQ.</p>
          ) : dlqQuery.data?.dlq.length === 0 ? (
            <p className="text-sm text-muted-foreground">DLQ is empty.</p>
          ) : (
            <div className="space-y-2">
              {dlqQuery.data?.dlq.map((row) => (
                <div
                  key={row.id}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs">{row.eventType}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        externalId{" "}
                        {(row.payload as { externalId?: string }).externalId ??
                          "?"}{" "}
                        · attempts {row.attempts} · failed{" "}
                        {new Date(row.failedAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-destructive">
                        {row.failureReason}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => replayMutation.mutate(row.id)}
                      disabled={replayMutation.isPending}
                      aria-label="Replay record"
                    >
                      Replay
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

interface RunRow {
  id: number;
  status: "running" | "success" | "failure";
  startedAt: string;
  completedAt: string | null;
  recordsRead: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsDeleted: number;
  recordsFailed: number;
  errorMessage: string | null;
  watermarkBefore: string | null;
  watermarkAfter: string | null;
}

function RecentRunsPanel({ jobId }: { jobId: number }) {
  const runs = useQuery<{ runs: RunRow[] }>({
    queryKey: ["/api/founder/etl/jobs", jobId, "runs"],
    queryFn: async () => {
      const r = await fetch(`/api/founder/etl/jobs/${jobId}/runs`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load runs");
      return r.json();
    },
  });

  if (runs.isLoading) {
    return <Skeleton className="mt-3 h-16 w-full" />;
  }
  if (!runs.data || runs.data.runs.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">No runs yet.</p>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      {runs.data.runs.map((r) => (
        <div
          key={r.id}
          className="rounded border border-border/50 px-2 py-1 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              <Badge variant={STATUS_VARIANT[r.status]} className="mr-1">
                {r.status}
              </Badge>
              {new Date(r.startedAt).toLocaleString()}
            </span>
            <span className="font-mono text-muted-foreground">
              read={r.recordsRead} ins={r.recordsInserted} upd=
              {r.recordsUpdated} del={r.recordsDeleted} fail=
              {r.recordsFailed}
            </span>
          </div>
          {r.errorMessage && (
            <p className="mt-1 text-destructive">{r.errorMessage}</p>
          )}
        </div>
      ))}
    </div>
  );
}
