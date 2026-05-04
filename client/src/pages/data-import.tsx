/**
 * Phase 4 Week 15-16 — Migration In/Out Parity (Magdalena §1)
 *
 * /import lets users run three migration flows:
 *   1. Lead/property/deal/notes CSV import (up to 50K rows, job-backed)
 *   2. Communications history CSV import
 *   3. Document ZIP import
 *
 * The UI polls /api/import/jobs every 2s while there are non-terminal jobs so
 * the progress bar stays current.
 */
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Upload, FileSpreadsheet, MessageSquare, Folder, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type ImportKind = "leads" | "properties" | "deals" | "notes" | "communications" | "documents";

interface ImportJob {
  id: number;
  kind: ImportKind;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  filename: string | null;
  totalRows: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
  errorMessage: string | null;
  errors?: Array<{ row: number; error: string }>;
  createdAt: string;
}

const FLOWS: Array<{
  kind: ImportKind;
  endpoint: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accept: string;
}> = [
  {
    kind: "leads",
    endpoint: "/api/import/leads",
    title: "Leads CSV",
    description:
      "Up to 50,000 rows. Maps name, email, phone, address. Optional columns: tags (comma-separated), assignedTo (team-member email), createdAt (preserves original date).",
    icon: FileSpreadsheet,
    accept: ".csv,text/csv",
  },
  {
    kind: "communications",
    endpoint: "/api/import/communications",
    title: "Communications history",
    description:
      "CSV with columns leadEmail, channel, body, sentAt, direction. Replays prior CRM email/SMS history into the matching lead's timeline.",
    icon: MessageSquare,
    accept: ".csv,text/csv",
  },
  {
    kind: "documents",
    endpoint: "/api/import/documents",
    title: "Documents ZIP",
    description:
      "ZIP archive whose entries are matched to leads or properties by filename pattern: lead_{email}.pdf or property_{apn}.pdf.",
    icon: Folder,
    accept: ".zip,application/zip",
  },
];

function StatusBadge({ status }: { status: ImportJob["status"] }) {
  const variants: Record<ImportJob["status"], { label: string; cls: string; icon: React.ReactNode }> = {
    queued: { label: "Queued", cls: "bg-muted text-muted-foreground", icon: <Loader2 className="size-3 animate-spin" /> },
    running: { label: "Running", cls: "bg-acr-primary/10 text-acr-primary", icon: <Loader2 className="size-3 animate-spin" /> },
    completed: { label: "Done", cls: "bg-acr-success/10 text-acr-success", icon: <CheckCircle2 className="size-3" /> },
    failed: { label: "Failed", cls: "bg-acr-error/10 text-acr-error", icon: <XCircle className="size-3" /> },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground", icon: <XCircle className="size-3" /> },
  };
  const v = variants[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5", v.cls)} aria-label={`Status: ${v.label}`}>
      {v.icon}
      {v.label}
    </Badge>
  );
}

export default function DataImportPage() {
  useDocumentTitle("Import Data — AcreOS");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyKind, setBusyKind] = useState<ImportKind | null>(null);

  const jobsQuery = useQuery<{ jobs: ImportJob[] }>({
    queryKey: ["import-jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/import/jobs?limit=25");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as { jobs: ImportJob[] } | undefined;
      const hasInflight = data?.jobs?.some((j) => j.status === "queued" || j.status === "running");
      return hasInflight ? 2000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ endpoint, file }: { endpoint: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import queued", description: "Tracking progress below." });
      void queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setBusyKind(null),
  });

  const inflightJobs = useMemo(
    () => jobsQuery.data?.jobs?.filter((j) => j.status === "running" || j.status === "queued") ?? [],
    [jobsQuery.data?.jobs]
  );

  return (
    <PageShell label="Import data">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Import data</h1>
          <p className="text-sm text-muted-foreground">
            Migrate leads, communications history, and documents from another CRM.
          </p>
        </header>
        <Alert>
          <Upload className="size-4" />
          <AlertTitle>50,000-row CSV cap</AlertTitle>
          <AlertDescription>
            Lead/property/deal CSVs above 50,000 rows are rejected with a clear error. For larger migrations, split by source or
            date range. Communications and document imports run in chunks of 500 with a live progress bar.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FLOWS.map((flow) => {
            const Icon = flow.icon;
            return (
              <Card key={flow.kind}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-acr-primary" aria-hidden="true" />
                    <h3 className="text-base font-semibold">{flow.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{flow.description}</p>
                  <div>
                    <input
                      id={`upload-${flow.kind}`}
                      type="file"
                      accept={flow.accept}
                      className="sr-only"
                      aria-label={`Upload ${flow.title}`}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusyKind(flow.kind);
                        uploadMutation.mutate({ endpoint: flow.endpoint, file });
                        e.target.value = "";
                      }}
                    />
                    <Button
                      asChild
                      variant="outline"
                      className="w-full"
                      disabled={busyKind === flow.kind}
                    >
                      <label htmlFor={`upload-${flow.kind}`} className="cursor-pointer">
                        {busyKind === flow.kind ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                            Queuing…
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 size-4" aria-hidden="true" />
                            Choose file
                          </>
                        )}
                      </label>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Recent imports</h3>
              {inflightJobs.length > 0 && (
                <Badge className="gap-1.5">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {inflightJobs.length} in flight
                </Badge>
              )}
            </div>

            {jobsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading jobs…</p>
            ) : (jobsQuery.data?.jobs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No imports yet. Choose a file above to begin.
              </p>
            ) : (
              <ul className="space-y-3">
                {jobsQuery.data!.jobs.map((job) => {
                  const pct =
                    job.totalRows > 0 ? Math.round((job.processedCount / job.totalRows) * 100) : 0;
                  return (
                    <li
                      key={job.id}
                      className="rounded-md border border-border p-3 text-sm"
                      aria-live="polite"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{job.filename || `Job #${job.id}`}</span>
                          <Badge variant="secondary">{job.kind}</Badge>
                          <StatusBadge status={job.status} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {(job.status === "running" || job.status === "queued") && job.totalRows > 0 && (
                        <div className="mt-2">
                          <Progress value={pct} aria-label={`Progress: ${pct}%`} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {job.processedCount.toLocaleString()} / {job.totalRows.toLocaleString()} rows
                          </p>
                        </div>
                      )}
                      {job.status === "completed" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {job.successCount.toLocaleString()} imported · {job.errorCount.toLocaleString()} errors ·{" "}
                          {job.duplicatesSkipped.toLocaleString()} duplicates skipped
                        </p>
                      )}
                      {job.status === "failed" && job.errorMessage && (
                        <p className="mt-2 text-xs text-acr-error">{job.errorMessage}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
