/**
 * T116 — Data Export Center
 *
 * Lets users export their data in bulk:
 *   - Leads (CSV, JSON)
 *   - Properties (CSV, JSON)
 *   - Deals (CSV)
 *   - Finance/Notes (CSV)
 *   - Full account archive (ZIP) — the async POST /api/export/everything
 *     job: create the job, poll its status, download when completed.
 *
 * All exports go through the existing /api/export/* endpoints.
 *
 * There are deliberately NO Campaigns or Activity log cards (EL-P1
 * A16-03): the generic GET /api/export/:entityType route only accepts
 * leads/properties/deals/notes and 400s everything else, so those two
 * cards could only ever refuse. The old archive card also refused — it
 * GET /api/export/archive?format=zip, which is not a route; the real
 * archive is the everything-job flow below.
 */
import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Download,
  Users,
  Map,
  Briefcase,
  Banknote,
  Package,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Link } from "wouter";

interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  endpoint: string;
  formats: string[];
  estimatedRows?: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: "leads",
    label: "Leads",
    description: "All lead records with contact info, status, and scores",
    icon: Users,
    endpoint: "/api/export/leads",
    formats: ["csv", "json"],
  },
  {
    id: "properties",
    label: "Properties",
    description: "All property/parcel records with APN, address, valuation",
    icon: Map,
    endpoint: "/api/export/properties",
    formats: ["csv", "json"],
  },
  {
    id: "deals",
    label: "Deals",
    description: "All deal records with offer amounts, status, and dates",
    icon: Briefcase,
    endpoint: "/api/export/deals",
    formats: ["csv"],
  },
  {
    id: "notes",
    label: "Seller-financed notes",
    description: "All note records with payment schedules and balances",
    icon: Banknote,
    endpoint: "/api/export/notes",
    formats: ["csv"],
  },
  {
    id: "acquired-notes",
    label: "Acquired notes",
    description: "Notes you bought, in the note-tape column set — re-import through the note-tape import",
    icon: Banknote,
    endpoint: "/api/export/acquired-notes",
    formats: ["csv", "json"],
  },
];

export default function DataExportPage() {
  useDocumentTitle("Data export");
  const { toast } = useToast();
  const [formats, setFormats] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const getFormat = (id: string, opts: string[]) => formats[id] ?? opts[0];

  const handleExport = async (option: ExportOption) => {
    const fmt = getFormat(option.id, option.formats);
    const url = `${option.endpoint}?format=${fmt}`;

    setDownloading(prev => new Set(prev).add(option.id));
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${option.id}-export.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setDownloaded(prev => new Set(prev).add(option.id));
      toast({ title: `${option.label} exported as ${fmt.toUpperCase()}` });
    } catch (err: any) {
      toast({
        title: "Couldn't export data",
        description: `${err.message}. Your data is unchanged — try again, or contact support if the issue persists.`,
        variant: "destructive",
      });
    } finally {
      setDownloading(prev => {
        const next = new Set(prev);
        next.delete(option.id);
        return next;
      });
    }
  };

  // Full account archive — the async everything-job flow (EL-P1 A16-03):
  // POST /api/export/everything creates the job (202 {jobId, status}),
  // GET /api/export/jobs/:id reports queued/running/completed/failed,
  // and GET /api/export/jobs/:id/download streams the ZIP once completed.
  // The card states mirror the job's real states — no fake progress bar.
  const [archiveState, setArchiveState] = useState<
    "idle" | "creating" | "running" | "downloading" | "done" | "error"
  >("idle");
  const [archiveJobStatus, setArchiveJobStatus] = useState<string>("");
  const archiveBusy =
    archiveState === "creating" || archiveState === "running" || archiveState === "downloading";

  const handleArchive = async () => {
    setArchiveState("creating");
    setArchiveJobStatus("");
    try {
      const res = await fetch("/api/export/everything", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message);
      }
      const { jobId } = (await res.json()) as { jobId: number };
      setArchiveState("running");

      // Poll the job: 90 × 2s ≈ 3 minutes of headroom for a full-org build.
      let completed = false;
      for (let i = 0; i < 90 && !completed; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const jobRes = await fetch(`/api/export/jobs/${jobId}`, { credentials: "include" });
        if (!jobRes.ok) throw new Error("Lost track of the archive job — reload the page and try again");
        const job = await jobRes.json();
        setArchiveJobStatus(typeof job.status === "string" ? job.status : "");
        if (job.status === "completed") {
          completed = true;
        } else if (job.status === "failed") {
          throw new Error(job.error ?? job.errorMessage ?? "The archive job failed on the server");
        }
      }
      if (!completed) {
        throw new Error("The archive is taking longer than a few minutes to build. Wait a bit and try again — each attempt starts a fresh job.");
      }

      setArchiveState("downloading");
      const dlRes = await fetch(`/api/export/jobs/${jobId}/download`, { credentials: "include" });
      if (!dlRes.ok) {
        const err = await dlRes.json().catch(() => ({ message: "Archive download failed" }));
        throw new Error(err.message);
      }
      const blob = await dlRes.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = "acreos-account-archive.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setArchiveState("done");
      toast({ title: "Account archive downloaded" });
    } catch (err: any) {
      setArchiveState("error");
      toast({
        title: "Couldn't build your archive",
        description: `${err.message}. Your data is unchanged — try again, or contact support if the issue persists.`,
        variant: "destructive",
      });
    }
  };

  return (
    <PageShell label="Data export">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Data export</h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Download your AcreOS data in bulk. All exports are scoped to your organization.
        </p>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Available data exports">
        {EXPORT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const fmt = getFormat(option.id, option.formats);
          const isDownloading = downloading.has(option.id);
          const isDone = downloaded.has(option.id);

          return (
            <li key={option.id}>
              <ExportOptionCard
                option={option}
                Icon={Icon}
                fmt={fmt}
                isDownloading={isDownloading}
                isDone={isDone}
                onFormatChange={(v) => setFormats(prev => ({ ...prev, [option.id]: v }))}
                onExport={() => handleExport(option)}
              />
            </li>
          );
        })}
      </ul>

      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4 flex items-center gap-4 flex-wrap">
          <div className="p-3 rounded-card bg-muted shrink-0">
            <Package className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="font-medium text-sm">Full account archive</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              All your data as a single ZIP file: leads, properties, deals, communications,
              notes, payments, and an audit log. The archive is built as a background job —
              the download starts automatically when it's ready.
            </p>
            {archiveState === "running" && (
              <p className="text-xs text-muted-foreground mt-1" role="status">
                Building your archive{archiveJobStatus ? ` — job ${archiveJobStatus}` : ""}…
              </p>
            )}
            {archiveState === "done" && (
              <p className="text-xs text-acr-pos mt-1 inline-flex items-center gap-1" role="status">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Archive downloaded.
              </p>
            )}
            {archiveState === "error" && (
              <p className="text-xs text-destructive mt-1" role="status">
                The last archive attempt didn't finish — you can try again.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleArchive}
            disabled={archiveBusy}
            aria-label="Build and download full account archive as ZIP"
            data-testid="button-download-archive"
          >
            {archiveState === "creating" ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Requesting…</>
            ) : archiveState === "running" ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Building…</>
            ) : archiveState === "downloading" ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Downloading…</>
            ) : (
              <><Download className="w-4 h-4 mr-2" aria-hidden="true" /> {archiveState === "done" ? "Build a fresh archive" : "Download archive"}</>
            )}
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Exports are limited to your organization's data. The per-type exports above download immediately; the full archive is built as a background job and may take a few minutes for large organizations.
        For GDPR data deletion requests, use the{" "}
        <Link
          href="/settings/privacy"
          className="underline-offset-2 hover:underline text-primary"
          data-testid="data-export-dsar-link"
        >
          data-subject requests page
        </Link>
        {" "}— it submits, tracks, and fulfils the request end-to-end.
      </p>
    </PageShell>
  );
}

function ExportOptionCard({
  option,
  Icon,
  fmt,
  isDownloading,
  isDone,
  onFormatChange,
  onExport,
}: {
  option: ExportOption;
  Icon: ExportOption["icon"];
  fmt: string;
  isDownloading: boolean;
  isDone: boolean;
  onFormatChange: (v: string) => void;
  onExport: () => void;
}) {
  const formatId = useId();
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-start gap-3">
        <div className="p-2 rounded-card bg-muted shrink-0">
          <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{option.label}</span>
            {option.formats.map(f => (
              <Badge key={f} variant="outline" className="text-xs uppercase">{f}</Badge>
            ))}
            {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos" aria-label="Exported" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{option.description}.</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {option.formats.length > 1 && (
              <>
                <Label htmlFor={formatId} className="sr-only">Export format for {option.label}</Label>
                <Select value={fmt} onValueChange={onFormatChange}>
                  <SelectTrigger id={formatId} className="h-7 w-20 text-xs" aria-label={`Format for ${option.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {option.formats.map(f => (
                      <SelectItem key={f} value={f} className="text-xs uppercase">{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs min-h-9"
              onClick={onExport}
              disabled={isDownloading}
              aria-label={`Export ${option.label} as ${fmt.toUpperCase()}`}
            >
              {isDownloading ? (
                <><Loader2 className="w-3 h-3 animate-spin mr-1" aria-hidden="true" /> Exporting</>
              ) : (
                <><Download className="w-3 h-3 mr-1" aria-hidden="true" /> Export {fmt.toUpperCase()}</>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
